import { apiRoute, readJson } from '@/lib/server/api-route';
import { platformAdminMutationsEnabled, requirePlatformAdmin, requirePlatformAdminMutation } from '@/lib/server/platform-admin';
import { workspaceId as currentWorkspaceId } from '@/lib/server/database';
import { WorkspaceError } from '@/lib/workspace';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

type Params = { workspaceId: string };

export const GET = apiRoute<Params>('admin.organizations.get', async ({ account, database, params }) => {
	requirePlatformAdmin(account);
	const [organizationResult, members, sheets, purchases, jobs, audit] = await Promise.all([
		database.read(`SELECT w.id AS workspace_id,w.issuer,w.organization_id,w.name,w.deleted_at,
			(SELECT count(*)::int FROM enrichable.signed_in_memberships m WHERE m.workspace_id=w.id) AS member_count,
			(SELECT count(*)::int FROM enrichable.sheets s WHERE s.workspace_id=w.id) AS sheet_count,
			(SELECT count(*)::int FROM enrichable.sheet_rows r WHERE r.workspace_id=w.id) AS row_count,
			(SELECT count(*)::int FROM enrichable.enrichment_jobs j WHERE j.workspace_id=w.id AND j.status IN ('queued','running')) AS active_jobs,
			(SELECT t.trial_eligible FROM enrichable.workspace_trial_usage t WHERE t.workspace_id=w.id) AS trial_eligible,
			(SELECT t.admin_exempt FROM enrichable.workspace_trial_usage t WHERE t.workspace_id=w.id) AS admin_exempt,
			(SELECT t.sheets_used FROM enrichable.workspace_trial_usage t WHERE t.workspace_id=w.id) AS trial_sheets_used,
			(SELECT t.rows_used FROM enrichable.workspace_trial_usage t WHERE t.workspace_id=w.id) AS trial_rows_used,
			(SELECT s.status FROM enrichable.workspace_subscriptions s WHERE s.workspace_id=w.id) AS subscription_status
			FROM enrichable.workspaces w WHERE w.id=$1`, [params.workspaceId]),
		database.read(`SELECT m.issuer,m.user_id,m.first_signed_in_at,m.last_signed_in_at FROM enrichable.signed_in_memberships m WHERE m.workspace_id=$1 ORDER BY m.first_signed_in_at LIMIT 100`, [params.workspaceId]),
		database.read(`SELECT s.id,s.data->>'name' AS name,(SELECT count(*)::int FROM enrichable.sheet_rows r WHERE r.workspace_id=s.workspace_id AND r.sheet_id=s.id) AS row_count,
			CASE WHEN s.data->>'updatedAt' ~ '^[0-9]+$' THEN to_timestamp((s.data->>'updatedAt')::double precision / 1000) ELSE NULL END AS updated_at
			FROM enrichable.sheets s WHERE s.workspace_id=$1 ORDER BY updated_at DESC NULLS LAST,s.id LIMIT 100`, [params.workspaceId]),
		database.read(`SELECT session_id,status,amount_total,currency,created_at FROM enrichable.stripe_one_time_purchases WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 20`, [params.workspaceId]),
		database.read(`SELECT status,count(*)::int AS count FROM enrichable.enrichment_jobs WHERE workspace_id=$1 GROUP BY status ORDER BY status`, [params.workspaceId]),
		database.read(`SELECT action,actor_id,details,created_at FROM enrichable.workspace_audit_events WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 20`, [params.workspaceId]),
	]);
	const organization = organizationResult.rows[0];
	if (!organization) throw new WorkspaceError('Organization not found.', 404);
	return { organization, members: members.rows, sheets: sheets.rows, purchases: purchases.rows, jobs: jobs.rows, recentActivity: audit.rows, canClose: platformAdminMutationsEnabled() && organization.workspace_id !== currentWorkspaceId(account) && !organization.deleted_at };
});

const closeSchema = z.object({ confirmWorkspaceName: z.string().trim().min(1).max(256) }).strict();

export const DELETE = apiRoute<Params>('admin.organizations.close', async ({ account, database, params, request }) => {
	requirePlatformAdminMutation(account);
	const input = closeSchema.safeParse(await readJson(request));
	if (!input.success) throw new WorkspaceError('Enter the exact organization name to confirm closure.', 400);
	if (params.workspaceId === currentWorkspaceId(account)) throw new WorkspaceError('Switch to another organization before closing this one.', 409);
	return database.transaction(async (sql) => {
		const target = (await sql.query('SELECT id,name,deleted_at FROM enrichable.workspaces WHERE id=$1 FOR UPDATE', [params.workspaceId])).rows[0];
		if (!target) throw new WorkspaceError('Organization not found.', 404);
		if (input.data.confirmWorkspaceName !== target.name) throw new WorkspaceError('The organization name does not match.', 400);
		if (target.deleted_at) throw new WorkspaceError('This organization is already closed.', 409);
		const subscription = (await sql.query('SELECT status FROM enrichable.workspace_subscriptions WHERE workspace_id=$1 FOR UPDATE', [params.workspaceId])).rows[0];
		if (subscription && String(subscription.status) !== 'canceled') throw new WorkspaceError('Cancel the legacy recurring subscription first, then wait for Stripe to confirm it is canceled.', 409);
		const running = await sql.query(`SELECT
			(SELECT count(*)::int FROM enrichable.enrichment_jobs WHERE workspace_id=$1 AND status='running') +
			(SELECT count(*)::int FROM enrichable.populate_jobs WHERE workspace_id=$1 AND status='running') AS count`, [params.workspaceId]);
		if (Number(running.rows[0]?.count ?? 0) > 0) throw new WorkspaceError('Wait for active enrichment and search jobs to finish before closing this organization.', 409);
		await sql.query("INSERT INTO enrichable.workspace_audit_events (workspace_id,id,actor_id,action,details) VALUES ($1,$2,$3,'workspace.close',$4::jsonb)", [params.workspaceId, randomUUID(), account.user.id, JSON.stringify({ source: 'platform-admin' })]);
		await sql.query("UPDATE enrichable.enrichment_jobs SET status='cancelled',error='Workspace closed by platform admin.',updated_at=now() WHERE workspace_id=$1 AND status='queued'", [params.workspaceId]);
		await sql.query("UPDATE enrichable.populate_jobs SET status='cancelled',error='Workspace closed by platform admin.',progress='Cancelled',updated_at=now() WHERE workspace_id=$1 AND status='queued'", [params.workspaceId]);
		await sql.query('UPDATE enrichable.durable_worker_slots SET workspace_id=NULL,job_id=NULL,lease_owner=NULL,lease_expires_at=NULL WHERE workspace_id=$1', [params.workspaceId]);
		for (const table of ['enrichment_jobs','populate_jobs','workspace_request_limits','mcp_keys','mcp_attempts','organization_settings_audit','organization_providers','organization_settings','company_context','company_research','member_settings','signed_in_memberships','sheets','sheet_folders']) {
			await sql.query(`DELETE FROM enrichable.${table} WHERE workspace_id=$1`, [params.workspaceId]);
		}
		await sql.query('UPDATE enrichable.workspaces SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL', [params.workspaceId]);
		return { closed: true, providerReceiptsRetained: true, productBillingRetained: true };
	});
});
