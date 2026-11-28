import { apiRoute, readJson } from '@/lib/server/api-route';
import { requirePlatformAdminMutation } from '@/lib/server/platform-admin';
import { WorkspaceError } from '@/lib/workspace';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

type Params = { workspaceId: string; sheetId: string };
const deleteSchema = z.object({ confirmSheetName: z.string().trim().min(1).max(300) }).strict();

export const DELETE = apiRoute<Params>('admin.organizations.delete-sheet', async ({ account, database, params, request }) => {
	requirePlatformAdminMutation(account);
	const input = deleteSchema.safeParse(await readJson(request));
	if (!input.success) throw new WorkspaceError('Enter the exact sheet name to confirm deletion.', 400);
	return database.transaction(async (sql) => {
		const workspace = (await sql.query('SELECT id,deleted_at FROM enrichable.workspaces WHERE id=$1 FOR UPDATE', [params.workspaceId])).rows[0];
		if (!workspace) throw new WorkspaceError('Organization not found.', 404);
		if (workspace.deleted_at) throw new WorkspaceError('This organization is already closed.', 409);
		const sheet = (await sql.query('SELECT data FROM enrichable.sheets WHERE workspace_id=$1 AND id=$2 FOR UPDATE', [params.workspaceId, params.sheetId])).rows[0];
		if (!sheet) throw new WorkspaceError('Sheet not found.', 404);
		const definition = sheet.data as { name?: unknown };
		const name = typeof definition.name === 'string' ? definition.name : '';
		if (name !== input.data.confirmSheetName) throw new WorkspaceError('The sheet name does not match.', 400);
		const active = await sql.query(`SELECT
			(SELECT count(*)::int FROM enrichable.enrichment_jobs WHERE workspace_id=$1 AND sheet_id=$2 AND status IN ('queued','running')) +
			(SELECT count(*)::int FROM enrichable.populate_jobs WHERE workspace_id=$1 AND sheet_id=$2 AND status IN ('queued','running')) AS count`, [params.workspaceId, params.sheetId]);
		if (Number(active.rows[0]?.count ?? 0) > 0) throw new WorkspaceError('Wait for this sheet’s active enrichment and search jobs to finish before deleting it.', 409);
		await sql.query("INSERT INTO enrichable.workspace_audit_events (workspace_id,id,actor_id,action,details) VALUES ($1,$2,$3,'workspace.sheet.delete',$4::jsonb)", [params.workspaceId, randomUUID(), account.user.id, JSON.stringify({ sheetId: params.sheetId, sheetName: name, source: 'platform-admin' })]);
		await sql.query('DELETE FROM enrichable.sheets WHERE workspace_id=$1 AND id=$2', [params.workspaceId, params.sheetId]);
		return { deleted: true };
	});
});
