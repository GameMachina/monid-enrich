import { apiRoute, readJson } from '@/lib/server/api-route';
import { WorkspaceStore } from '@/lib/server/workspace-store';

export const PATCH = apiRoute<{ id: string }>('folders.rename', async ({ account, database, request, params }) => new WorkspaceStore(database).renameFolder(account, params.id, await readJson(request)));
export const DELETE = apiRoute<{ id: string }>('folders.delete', ({ account, database, params }) => new WorkspaceStore(database).deleteFolder(account, params.id));
