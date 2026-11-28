import { after } from 'next/server';
import { FindRowsRequestSchema } from '@/lib/types';
import { jsonError } from '@/lib/server/credentials';
import { failure } from '@/lib/server/enrich-failure';
import { routeInput } from '@/lib/server/provider-access';
import { populateStream } from '@/lib/server/populate';
import { enqueuePopulate, processOnePopulateJob } from '@/lib/server/populate-jobs';
import { durableEnrichmentEnabled, managedAuthEnabled } from '@/lib/server/deployment';
import { billingSnapshot } from '@/lib/server/stripe-billing';
import { withDatabase } from '@/lib/server/database';
import { MAX_POPULATE_LIMIT } from '@/lib/populate-limit';
import { WorkspaceError } from '@/lib/workspace';

export const maxDuration = 300;

export async function POST(request: Request) {
	const prepared = await routeInput(request, FindRowsRequestSchema, { requirePurchase: false });
	if (prepared instanceof Response) return prepared;
	const { access } = prepared;
	const requestedTarget = prepared.input.target;
	if (requestedTarget > MAX_POPULATE_LIMIT) return jsonError(`A single Find rows request can return up to ${MAX_POPULATE_LIMIT.toLocaleString()} rows.`, 400, failure('input_invalid'));
	let input: typeof prepared.input = { ...prepared.input, target: requestedTarget, availableRows: undefined };
	if (access.account) {
		try {
			const billing = await withDatabase((database) => billingSnapshot(access.account!, database));
			if (billing.trial) {
				if (requestedTarget > billing.trial.rowLimit) return jsonError(`The free trial includes up to ${billing.trial.rowLimit} rows. Unlock larger searches with lifetime access for $37 once.`, 402, failure('provider_error', input.dataProvider, false));
				const remaining = Math.max(0, billing.trial.rowLimit - billing.trial.rowsUsed);
				if (!remaining) return jsonError(`The free trial is complete. Unlock more rows with lifetime access for $37 once.`, 402, failure('provider_error', input.dataProvider, false));
				input = { ...input, target: Math.min(requestedTarget, remaining), availableRows: remaining };
			}
		} catch (error) {
			return jsonError(error instanceof Error ? error.message : 'Could not check trial access.', error instanceof WorkspaceError ? error.status : 503);
		}
	}
	if (!access.key('monid')) return jsonError('Connect Monid in Configuration to find rows.', 401, failure('credential_missing', 'monid'));
	if (managedAuthEnabled()) {
		if (!durableEnrichmentEnabled()) return jsonError('Managed Find rows needs the durable worker enabled. Configure DATABASE_URL, ENRICHABLE_DURABLE_ENRICHMENT=true, and CRON_SECRET before running provider searches.', 503, failure('provider_error', input.dataProvider, true));
		if (!input.sheetId || !input.idempotencyKey || !access.account) return jsonError('A saved sheet and stable retry key are required for managed Find rows.', 400, failure('input_invalid'));
		try {
			const job = await enqueuePopulate(access.account, input.sheetId, input);
			if (job.status === 'queued') after(async () => { await processOnePopulateJob().catch(() => {}); });
			return Response.json(job, { status: 202, headers: { 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
		} catch (error) {
			return jsonError(error instanceof Error ? error.message : 'Could not queue Find rows.', error instanceof WorkspaceError ? error.status : 503);
		}
	}
	return new Response(populateStream(access, input), {
		status: 200,
		headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
	});
}
