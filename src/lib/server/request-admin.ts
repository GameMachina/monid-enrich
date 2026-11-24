import 'server-only';
import { currentAccount } from './auth';
import { requireWorkspaceAdmin } from './api-route';
import { jsonError } from './credentials';
import { WorkspaceError } from '../workspace';

/** For hand-written route handlers that do not use apiRoute's authenticated context. */
export async function workspaceAdminResponse(): Promise<Response | null> {
	try {
		const account = await currentAccount();
		if (!account) throw new WorkspaceError('Sign in required.', 401);
		requireWorkspaceAdmin(account);
		return null;
	} catch (error) {
		return jsonError(error instanceof Error ? error.message : 'Workspace owner or admin access is required.', error instanceof WorkspaceError ? error.status : 503);
	}
}
