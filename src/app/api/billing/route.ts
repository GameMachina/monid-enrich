import { apiRoute, requireWorkspaceAdmin } from '@/lib/server/api-route';
import { billingSnapshot, createCheckout } from '@/lib/server/stripe-billing';
import { WorkspaceError } from '@/lib/workspace';

export const GET = apiRoute('billing.get', async ({ account, database }) => ({
	...await billingSnapshot(account, database),
	canManage: account.role === 'owner' || account.role === 'admin',
}));

export const POST = apiRoute('billing.checkout', async ({ account, database, request }) => {
	requireWorkspaceAdmin(account);
	const idempotencyKey = request.headers.get('idempotency-key')?.trim() ?? '';
	if (!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey)) throw new WorkspaceError('Provide a valid checkout idempotency key.', 400);
	return createCheckout(account, database, `checkout-${idempotencyKey}`);
});
