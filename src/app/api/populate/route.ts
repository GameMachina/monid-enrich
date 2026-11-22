import { PopulateRequestSchema } from '@/lib/types';
import { jsonError } from '@/lib/server/credentials';
import { failure } from '@/lib/server/enrich-failure';
import { routeInput } from '@/lib/server/provider-access';
import { populateStream } from '@/lib/server/populate';

export const maxDuration = 300;

export async function POST(request: Request) {
	const prepared = await routeInput(request, PopulateRequestSchema);
	if (prepared instanceof Response) return prepared;
	const { input, access } = prepared;
	if (!access.key('monid')) return jsonError('Connect Monid in Configuration to find rows.', 401, failure('credential_missing', 'monid'));
	return new Response(populateStream(access, input), {
		status: 200,
		headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
	});
}
