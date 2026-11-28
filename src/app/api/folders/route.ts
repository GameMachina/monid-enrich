import { apiRoute, readJson } from '@/lib/server/api-route';
import { WorkspaceStore } from '@/lib/server/workspace-store';

export const GET = apiRoute('folders.list', ({ account, database }) => new WorkspaceStore(database).listFolders(account));
export const POST = apiRoute('folders.create', async ({ account, database, request }) => new WorkspaceStore(database).createFolder(account, await readJson(request)));
