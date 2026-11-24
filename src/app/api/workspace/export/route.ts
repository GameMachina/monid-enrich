import { apiRoute, requireWorkspaceAdmin } from '@/lib/server/api-route';
import { workspaceId } from '@/lib/server/database';
import { OrganizationStore } from '@/lib/server/organization-store';
import { WorkspaceStore } from '@/lib/server/workspace-store';
import { WorkspaceError } from '@/lib/workspace';
import { randomUUID } from 'node:crypto';

export const GET = apiRoute('workspace.export', async ({ account, database }) => {
	requireWorkspaceAdmin(account);
	const workspace = workspaceId(account);
	const summaries = await new WorkspaceStore(database).list(account);
	const sheets = [];
	for (const summary of summaries) sheets.push(await new WorkspaceStore(database).snapshot(account, summary.sheet.id));
	const [settings, monid, treg, companyContext, companyResearch] = await Promise.all([
		new OrganizationStore(database).get(account),
		database.read(`SELECT run_id,provider,endpoint,status,cost_usd,billed_units,created_at,updated_at FROM enrichable.monid_runs WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 10000`, [workspace]),
		database.read(`SELECT call_id,operation,endpoint,status,cost_usd,cost_micro_usd,served_via,created_at,updated_at FROM enrichable.treg_runs WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 10000`, [workspace]),
		database.read('SELECT lookup_status,brand,lookup_at,profile,researched_at FROM enrichable.company_context WHERE workspace_id=$1', [workspace]),
		database.read('SELECT domain,profile,researched_at FROM enrichable.company_research WHERE workspace_id=$1 ORDER BY domain', [workspace]),
	]);
	const result = {
		format: 'monid-enrich-workspace-export', version: 1, exportedAt: new Date().toISOString(),
		workspace: { name: account.organization.name, issuer: account.issuer, organizationId: account.organization.id },
		sheets,
		settings: { revision: settings.revision, preferences: settings.preferences, providers: settings.providers },
		companyContext: companyContext.rows[0] ?? null,
		companyResearch: companyResearch.rows,
		usage: { monid: monid.rows, treg: treg.rows },
		credentialsIncluded: false,
	};
	const encoded = JSON.stringify(result);
	if (Buffer.byteLength(encoded) > 50_000_000) throw new WorkspaceError('This workspace export is over 50 MB. Export individual sheets from the grid.', 413);
	await database.transaction(async (sql) => {
		await sql.query("INSERT INTO enrichable.workspace_audit_events (workspace_id,id,actor_id,action,details) VALUES ($1,$2,$3,'workspace.export',$4::jsonb)", [workspace, randomUUID(), account.user.id, JSON.stringify({ sheets: sheets.length, bytes: Buffer.byteLength(encoded) })]);
	}, { workspace: account });
	return result;
});
