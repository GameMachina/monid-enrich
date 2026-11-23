import { FindRowsRequestSchema } from '@/lib/types';
import { jsonError } from '@/lib/server/credentials';
import { failure } from '@/lib/server/enrich-failure';
import { routeInput } from '@/lib/server/provider-access';
import { populateStream } from '@/lib/server/populate';

export const maxDuration = 300;

export async function POST(request: Request) {
	const prepared = await routeInput(request, FindRowsRequestSchema);
	if (prepared instanceof Response) return prepared;
	const { input, access } = prepared;
	if (!access.key(input.dataProvider)) return jsonError(`Connect ${input.dataProvider === 'treg' ? 'Treg' : 'Monid'} in Configuration to find rows.`, 401, failure('credential_missing', input.dataProvider));
	if (input.dataProvider === 'treg' && input.entity === 'websites' && input.countries?.length) return jsonError('Treg web search does not expose a country filter for website discovery. Remove the country selection or choose Monid explicitly.', 400, failure('provider_error', 'treg'));
	return new Response(populateStream(access, input), {
		status: 200,
		headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
	});
}
