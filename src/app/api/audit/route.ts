import { apiRoute, requireWorkspaceAdmin } from '@/lib/server/api-route';
import { workspaceAuditReport } from '@/lib/server/workspace-audit';

export const GET = apiRoute('workspace.audit.read', async ({ account, database }) => {
	requireWorkspaceAdmin(account);
	return { events: await workspaceAuditReport(database, account) };
});
