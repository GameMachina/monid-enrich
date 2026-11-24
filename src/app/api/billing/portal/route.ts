import { apiRoute, requireWorkspaceAdmin } from '@/lib/server/api-route';
import { createPortal } from '@/lib/server/stripe-billing';

export const POST = apiRoute('billing.portal', ({ account, database }) => {
	requireWorkspaceAdmin(account);
	return createPortal(account, database);
});
