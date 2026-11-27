import { z } from 'zod';
import { apiRoute, readJson, requireWorkspaceAdmin } from '@/lib/server/api-route';
import { claimStripePurchase } from '@/lib/server/stripe-billing';
import { WorkspaceError } from '@/lib/workspace';

const inputSchema = z.object({ sessionId: z.string().regex(/^cs_(?:live|test)_[A-Za-z0-9]+$/).max(255) }).strict();

export const POST = apiRoute('billing.claim', async ({ account, database, request }) => {
	requireWorkspaceAdmin(account);
	const input = inputSchema.safeParse(await readJson(request));
	if (!input.success) throw new WorkspaceError('Provide the Stripe checkout session from the purchase confirmation page.', 400);
	return claimStripePurchase(account, database, input.data.sessionId);
});
