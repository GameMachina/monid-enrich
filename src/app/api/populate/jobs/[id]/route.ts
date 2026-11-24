import { apiRoute } from '@/lib/server/api-route';
import { cancelPopulateJob, getPopulateJob } from '@/lib/server/populate-jobs';
import { WorkspaceError } from '@/lib/workspace';

export const GET = apiRoute<{ id: string }>('populate.job.get', async ({ account, params }) => {
	if (!/^[0-9a-f-]{36}$/i.test(params.id)) throw new WorkspaceError('Find rows run not found.', 404);
	return getPopulateJob(account, params.id);
});

export const POST = apiRoute<{ id: string }>('populate.job.cancel', async ({ account, params }) => {
	if (!/^[0-9a-f-]{36}$/i.test(params.id)) throw new WorkspaceError('Find rows run not found.', 404);
	return cancelPopulateJob(account, params.id);
});
