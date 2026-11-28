import { apiRoute, readJson } from '@/lib/server/api-route';
import { requirePlatformAdmin } from '@/lib/server/platform-admin';
import { TableTypeStore } from '@/lib/server/table-type-store';
import { registeredMonidOperations } from '@/lib/server/monid';

export const GET = apiRoute('admin.table-types.list', async ({ account, database }) => {
	requirePlatformAdmin(account);
	return { items: await new TableTypeStore(database).listAll(), operations: registeredMonidOperations() };
});

export const POST = apiRoute('admin.table-types.create', async ({ account, database, request }) => {
	requirePlatformAdmin(account);
	return { definition: await new TableTypeStore(database).create(await readJson(request)) };
});
