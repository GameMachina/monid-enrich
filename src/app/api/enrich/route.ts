import { EnrichRequestSchema } from '@/lib/types';
import { NO_STORE_HEADERS } from '@/lib/server/credentials';
import { routeInput } from '@/lib/server/provider-access';
import { runOp } from '@/lib/server/enrich';
import { after } from 'next/server';
import { durableEnrichmentEnabled } from '@/lib/server/deployment';
import { enqueueEnrichment, processOneEnrichmentJob } from '@/lib/server/enrichment-jobs';
import { currentAccount } from '@/lib/server/auth';
import { WorkspaceError } from '@/lib/workspace';
import { jsonError } from '@/lib/server/credentials';

export const maxDuration = 300;

export async function POST(request: Request) {
	const prepared = await routeInput(request, EnrichRequestSchema);
	if (prepared instanceof Response) return prepared;
	if (durableEnrichmentEnabled() && prepared.input.runContext) {
		const actor = await currentAccount();
		if (!actor) return jsonError('Sign in required.', 401);
		if (!prepared.input.idempotencyKey) return jsonError('A durable run idempotency key is required.', 400);
		try {
			const job = await enqueueEnrichment(actor, { op: prepared.input.op, row: prepared.input.row, idempotencyKey: prepared.input.idempotencyKey, context: prepared.input.runContext });
			after(async () => { await processOneEnrichmentJob().catch(() => {}); });
			return Response.json(job, { status: 202, headers: NO_STORE_HEADERS });
		} catch (error) {
			return jsonError(error instanceof Error ? error.message : 'Could not queue this enrichment.', error instanceof WorkspaceError ? error.status : 503);
		}
	}
	const result = await runOp(prepared.access, prepared.input.op, prepared.input.row, { idempotencyKey: prepared.input.idempotencyKey, signal: request.signal, runContext: prepared.input.runContext });
	return new Response(JSON.stringify(result), { status: 200, headers: NO_STORE_HEADERS });
}
