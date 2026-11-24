import { after } from 'next/server';
import { FindRowsRequestSchema } from '@/lib/types';
import { jsonError } from '@/lib/server/credentials';
import { failure } from '@/lib/server/enrich-failure';
import { routeInput } from '@/lib/server/provider-access';
import { populateStream } from '@/lib/server/populate';
import { enqueuePopulate, processOnePopulateJob } from '@/lib/server/populate-jobs';
import { durableEnrichmentEnabled, managedAuthEnabled } from '@/lib/server/deployment';
import { WorkspaceError } from '@/lib/workspace';

export const maxDuration = 300;

export async function POST(request: Request) {
	const prepared = await routeInput(request, FindRowsRequestSchema);
	if (prepared instanceof Response) return prepared;
	const { input, access } = prepared;
	if (!access.key(input.dataProvider)) return jsonError(`Connect ${input.dataProvider === 'treg' ? 'Treg' : 'Monid'} in Configuration to find rows.`, 401, failure('credential_missing', input.dataProvider));
	if (input.dataProvider === 'treg' && input.entity === 'websites' && input.countries?.length) return jsonError('Treg web search does not expose a country filter for website discovery. Remove the country selection or choose Monid explicitly.', 400, failure('provider_error', 'treg'));
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
