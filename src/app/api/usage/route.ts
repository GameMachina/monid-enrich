import { apiRoute, requireWorkspaceAdmin } from '@/lib/server/api-route';
import { WorkspaceError } from '@/lib/workspace';
import type { Sql } from '@/lib/server/database';

const USAGE_CTE = `WITH provider_runs AS (
	SELECT 'monid'::text AS provider, run_id AS id, provider AS integration, endpoint AS operation, endpoint,
		status, cost_usd::numeric AS cost_usd, billed_units::numeric AS billed_units, NULL::numeric AS cost_micro_usd,
		price, actor_id, sheet_id, row_id, column_id, created_at::bigint AS created_at
	FROM enrichable.monid_runs WHERE workspace_id=$1
	UNION ALL
	SELECT 'treg'::text AS provider, call_id AS id, served_via AS integration, operation, endpoint,
		status, cost_usd::numeric AS cost_usd, NULL::numeric AS billed_units, cost_micro_usd::numeric AS cost_micro_usd,
		NULL::jsonb AS price, actor_id, sheet_id, row_id, column_id, created_at::bigint AS created_at
	FROM enrichable.treg_runs WHERE workspace_id=$1
), matched AS (
	SELECT r.*, s.data->>'name' AS sheet_name FROM provider_runs r
	LEFT JOIN enrichable.sheets s ON s.workspace_id=$1 AND s.id=r.sheet_id
	WHERE ($2::text IS NULL OR r.provider=$2)
		AND ($3::text IS NULL OR r.status ILIKE $3)
		AND ($4::text IS NULL OR r.actor_id=$4)
		AND ($5::text IS NULL OR r.sheet_id=$5)
		AND ($6::bigint IS NULL OR r.created_at >= $6)
		AND ($7::bigint IS NULL OR r.created_at < $7)
		AND ($8::text IS NULL OR concat_ws(' ',r.id,r.integration,r.operation,r.endpoint,r.status,r.actor_id,r.sheet_name) ILIKE $8)
)`;

const optionalText = (value: string | null) => value ? value.slice(0, 128) : null;

function epoch(value: string | null, label: string) {
	if (!value) return null;
	if (!/^\d{1,16}$/.test(value)) throw new WorkspaceError(`Invalid ${label} timestamp.`);
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed)) throw new WorkspaceError(`Invalid ${label} timestamp.`);
	return parsed;
}

export const GET = apiRoute('provider-usage', async ({ account, database, request }) => {
	requireWorkspaceAdmin(account);
	const params = new URL(request.url).searchParams;
	const provider = params.get('provider');
	if (provider && provider !== 'monid' && provider !== 'treg') throw new WorkspaceError('Choose Monid or Treg as the provider filter.');
	const statusValue = optionalText(params.get('status'));
	const actorId = optionalText(params.get('actorId'));
	const sheetId = optionalText(params.get('sheetId'));
	const from = epoch(params.get('from'), 'start');
	const until = epoch(params.get('until'), 'end');
	if (from !== null && until !== null && from >= until) throw new WorkspaceError('The end date must be after the start date.');
	const searchValue = optionalText(params.get('q'));
	const search = searchValue ? `%${searchValue}%` : null;
	const exporting = params.get('export') === '1';
	const requestedPage = Number(params.get('page') ?? 1);
	if (!exporting && (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > 20_000)) throw new WorkspaceError('Invalid usage page.');
	const page = exporting ? 1 : requestedPage;
	const pageSize = exporting ? 10_000 : 50;
	const offset = exporting ? 0 : (page - 1) * pageSize;
	const actor = { issuer: account.issuer, organization: account.organization };
	return database.transaction(async (sql: Sql, workspace: string) => {
		const values = [workspace, provider, statusValue, actorId, sheetId, from, until, search];
		const records = await sql.query(`${USAGE_CTE} SELECT * FROM matched ORDER BY created_at DESC, provider, id LIMIT $9 OFFSET $10`, [...values, pageSize, offset]);
		const aggregate = await sql.query(`${USAGE_CTE} SELECT provider,COUNT(*)::int AS count,COUNT(cost_usd)::int AS reported_cost_count,COUNT(*) FILTER (WHERE cost_usd IS NULL)::int AS unknown_cost_count,COALESCE(SUM(cost_usd),0)::text AS reported_cost_usd FROM matched GROUP BY provider ORDER BY provider`, values);
		const total = aggregate.rows.reduce((sum: number, row: Record<string, unknown>) => sum + Number(row.count), 0);
		const reportedCostUsd = aggregate.rows.reduce((sum: number, row: Record<string, unknown>) => sum + Number(row.reported_cost_usd), 0);
		const unknownCostCount = aggregate.rows.reduce((sum: number, row: Record<string, unknown>) => sum + Number(row.unknown_cost_count), 0);
		return {
			provider: provider ?? 'all', page, pageSize, total, reportedCostUsd, unknownCostCount,
			truncated: exporting && total > records.rows.length,
			byProvider: aggregate.rows.map((row) => ({ provider: String(row.provider), count: Number(row.count), reportedCostCount: Number(row.reported_cost_count), unknownCostCount: Number(row.unknown_cost_count), reportedCostUsd: Number(row.reported_cost_usd) })),
			records: records.rows.map((row) => ({
				provider: String(row.provider), id: String(row.id), integration: row.integration === null ? null : String(row.integration),
				operation: String(row.operation), endpoint: String(row.endpoint), status: String(row.status),
				costUsd: row.cost_usd === null ? null : Number(row.cost_usd), billedUnits: row.billed_units === null ? null : Number(row.billed_units),
				costMicroUsd: row.cost_micro_usd === null ? null : Number(row.cost_micro_usd), price: row.price ?? null,
				actorId: row.actor_id === null ? null : String(row.actor_id), sheetId: row.sheet_id === null ? null : String(row.sheet_id),
				sheetName: row.sheet_name === null ? null : String(row.sheet_name), rowId: row.row_id === null ? null : String(row.row_id),
				columnId: row.column_id === null ? null : String(row.column_id), createdAt: Number(row.created_at),
			})),
		};
	}, { workspace: actor, readOnly: true });
});
