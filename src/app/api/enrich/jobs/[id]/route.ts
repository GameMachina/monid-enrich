import { apiRoute } from '@/lib/server/api-route';
import { cancelEnrichmentJob, getEnrichmentJob } from '@/lib/server/enrichment-jobs';
import { WorkspaceError } from '@/lib/workspace';

export const GET = apiRoute<{ id: string }>('enrichment.job.get', async ({ account, params }) => {
	if (!/^[0-9a-f-]{36}$/i.test(params.id)) throw new WorkspaceError('Enrichment run not found.', 404);
	return getEnrichmentJob(account, params.id);
});

export const POST = apiRoute<{ id: string }>('enrichment.job.cancel', async ({ account, params }) => {
	if (!/^[0-9a-f-]{36}$/i.test(params.id)) throw new WorkspaceError('Enrichment run not found.', 404);
	return cancelEnrichmentJob(account, params.id);
});
