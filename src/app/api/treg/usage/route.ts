import { NO_STORE_HEADERS, jsonError } from '@/lib/server/credentials';
import { routeAccess } from '@/lib/server/provider-access';
import { withDatabase, type Sql, type WorkspaceActor } from '@/lib/server/database';

export async function GET(request: Request) {
	const access = await routeAccess(request);
	if (access instanceof Response) return access;
	const actor: WorkspaceActor | undefined = access.account ? { issuer: access.account.issuer, organization: access.account.organization } : undefined;
	try {
		access.requireKey('treg');
		if (!actor) return Response.json({ provider: 'treg', runs: [], localOnly: true }, { headers: NO_STORE_HEADERS });
		const runs = await withDatabase((database) => database.transaction(async (sql: Sql, workspace: string) => {
			const result = await sql.query(`SELECT call_id,operation,endpoint,status,cost_usd,cost_micro_usd,served_via,created_at,updated_at
				FROM enrichable.treg_runs WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT 20`, [workspace]);
			return result.rows.map((row: Record<string, unknown>) => ({ callId: String(row.call_id), operation: String(row.operation), endpoint: String(row.endpoint), status: String(row.status), costUsd: row.cost_usd === null ? null : Number(row.cost_usd), costMicroUsd: row.cost_micro_usd === null ? null : Number(row.cost_micro_usd), servedVia: row.served_via === null ? null : String(row.served_via), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }));
		}, { workspace: actor, readOnly: true }));
		return Response.json({ provider: 'treg', runs }, { headers: NO_STORE_HEADERS });
	} catch (error) {
		const status = (error as { status?: number }).status ?? 503;
		return jsonError(error instanceof Error ? error.message : 'Could not load Treg usage.', status);
	}
}
