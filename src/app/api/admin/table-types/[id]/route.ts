import { apiRoute, readJson } from '@/lib/server/api-route';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { TableTypeStore } from '@/lib/server/table-type-store';

type Params = { id: string };

export const PATCH = apiRoute<Params>('admin.table-types.update', async ({ account, database, request, params }) => {
	requirePlatformAdmin(account);
	return { definition: await new TableTypeStore(database).update(params.id, await readJson(request)) };
});

export const DELETE = apiRoute<Params>('admin.table-types.delete', async ({ account, database, params }) => {
	requirePlatformAdmin(account);
	return await new TableTypeStore(database).deleteDraft(params.id);
});
