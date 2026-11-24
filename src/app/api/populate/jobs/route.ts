import { apiRoute } from '@/lib/server/api-route';
import { findPopulateJob } from '@/lib/server/populate-jobs';
import { WorkspaceError } from '@/lib/workspace';

export const GET = apiRoute('populate.job.lookup', async ({ account, request }) => {
	const url = new URL(request.url), sheetId = url.searchParams.get('sheetId'), idempotencyKey = url.searchParams.get('idempotencyKey');
	if (!sheetId || !idempotencyKey || sheetId.length > 128 || idempotencyKey.length > 128) throw new WorkspaceError('A sheet and Find rows retry key are required.', 400);
	return { job: await findPopulateJob(account, sheetId, idempotencyKey) };
});
