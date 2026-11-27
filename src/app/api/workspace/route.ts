import { apiRoute, readJson, requireWorkspaceAdmin } from '@/lib/server/api-route';
import { workspaceId } from '@/lib/server/database';
import { WorkspaceError } from '@/lib/workspace';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

const confirmation = z.object({ confirmWorkspaceName: z.string().trim().min(1).max(256) }).strict();

export const DELETE = apiRoute('workspace.close', async ({ account, database, request }) => {
	requireWorkspaceAdmin(account);
	const input = confirmation.safeParse(await readJson(request));
	if (!input.success || input.data.confirmWorkspaceName !== account.organization.name) throw new WorkspaceError('Enter the exact workspace name to confirm deletion.', 400);
	const workspace = workspaceId(account);
	return database.transaction(async (sql) => {
		const subscription = (await sql.query('SELECT status FROM enrichable.workspace_subscriptions WHERE workspace_id=$1 FOR UPDATE', [workspace])).rows[0];
		if (subscription && String(subscription.status) !== 'canceled') throw new WorkspaceError('Cancel the legacy Monid Enrich subscription in Configuration first, then wait for Stripe to confirm it is canceled before closing this workspace.', 409);
		const active = await sql.query("SELECT count(*)::int AS count FROM enrichable.enrichment_jobs WHERE workspace_id=$1 AND status='running'", [workspace]);
		if (Number(active.rows[0]?.count ?? 0) > 0) throw new WorkspaceError('Wait for active enrichment jobs to finish before closing this workspace.', 409);
		await sql.query("INSERT INTO enrichable.workspace_audit_events (workspace_id,id,actor_id,action,details) VALUES ($1,$2,$3,'workspace.close','{}'::jsonb)", [workspace, randomUUID(), account.user.id]);
		await sql.query("UPDATE enrichable.enrichment_jobs SET status='cancelled',error='Workspace closed.',updated_at=now() WHERE workspace_id=$1 AND status='queued'", [workspace]);
		for (const table of ['enrichment_jobs','workspace_request_limits','mcp_keys','mcp_attempts','organization_settings_audit','organization_providers','organization_settings','company_context','company_research','member_settings','signed_in_memberships','sheets']) {
			await sql.query(`DELETE FROM enrichable.${table} WHERE workspace_id=$1`, [workspace]);
		}
		await sql.query('UPDATE enrichable.workspaces SET deleted_at=now() WHERE id=$1 AND deleted_at IS NULL', [workspace]);
		return { closed: true, providerReceiptsRetained: true, productBillingRetained: true };
	}, { workspace: account });
});
