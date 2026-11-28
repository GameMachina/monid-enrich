import { apiRoute } from '@/lib/server/api-route';
import { platformAdminMutationsEnabled, requirePlatformAdmin } from '@/lib/server/platform-admin';

export const GET = apiRoute('admin.organizations.list', async ({ account, database, request }) => {
	requirePlatformAdmin(account);
	const params = new URL(request.url).searchParams;
	const query = params.get('q')?.trim().slice(0, 160) ?? '';
	const status = ['active', 'closed', 'all'].includes(params.get('status') ?? '') ? params.get('status')! : 'active';
	const result = await database.read(`
		SELECT w.id AS workspace_id, w.issuer, w.organization_id, w.name, w.deleted_at,
			(SELECT count(*)::int FROM enrichable.signed_in_memberships m WHERE m.workspace_id=w.id) AS member_count,
			(SELECT count(*)::int FROM enrichable.sheets s WHERE s.workspace_id=w.id) AS sheet_count,
			(SELECT count(*)::int FROM enrichable.sheet_rows r WHERE r.workspace_id=w.id) AS row_count,
			(SELECT count(*)::int FROM enrichable.enrichment_jobs j WHERE j.workspace_id=w.id AND j.status IN ('queued','running')) AS active_jobs,
			(SELECT max(m.last_signed_in_at) FROM enrichable.signed_in_memberships m WHERE m.workspace_id=w.id) AS last_member_activity,
			(SELECT max(to_timestamp((s.data->>'updatedAt')::double precision / 1000)) FROM enrichable.sheets s WHERE s.workspace_id=w.id AND s.data->>'updatedAt' ~ '^[0-9]+$') AS last_sheet_activity,
			(SELECT jsonb_build_object('eligible',t.trial_eligible,'adminExempt',t.admin_exempt,'sheetsUsed',t.sheets_used,'rowsUsed',t.rows_used) FROM enrichable.workspace_trial_usage t WHERE t.workspace_id=w.id) AS trial,
			(SELECT s.status FROM enrichable.workspace_subscriptions s WHERE s.workspace_id=w.id) AS subscription_status,
			(SELECT count(*)::int FROM enrichable.stripe_one_time_purchases p WHERE p.workspace_id=w.id AND p.status='paid') AS paid_purchase_count,
			(SELECT coalesce(sum(p.amount_total),0)::int FROM enrichable.stripe_one_time_purchases p WHERE p.workspace_id=w.id AND p.status='paid') AS paid_total_cents
		FROM enrichable.workspaces w
		WHERE ($1='' OR concat_ws(' ',w.name,w.id,w.organization_id,w.issuer) ILIKE '%' || $1 || '%')
			AND ($2='all' OR ($2='active' AND w.deleted_at IS NULL) OR ($2='closed' AND w.deleted_at IS NOT NULL))
		ORDER BY w.deleted_at NULLS FIRST, w.name, w.id
		LIMIT 200`, [query, status]);
	return { organizations: result.rows, mutationsEnabled: platformAdminMutationsEnabled() };
});
