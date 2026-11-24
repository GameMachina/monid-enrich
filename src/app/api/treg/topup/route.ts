import { z } from 'zod';
import { NO_STORE_HEADERS, jsonError } from '@/lib/server/credentials';
import { routeAccess } from '@/lib/server/provider-access';
import { tregCheckoutUrl, tregRequest } from '@/lib/server/treg';
import { workspaceAdminResponse } from '@/lib/server/request-admin';

export const maxDuration = 30;
const topupInput = z.object({ amountUsd: z.number().finite().positive() });

export async function POST(request: Request) {
	const denied = await workspaceAdminResponse();
	if (denied) return denied;
	const access = await routeAccess(request);
	if (access instanceof Response) return access;
	const parsed = topupInput.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return jsonError('Enter a positive top-up amount in USD.', 400);
	try {
		const result = await tregRequest(access.requireKey('treg'), '/billing/topup', { method: 'POST', body: JSON.stringify({ amount_usd: parsed.data.amountUsd }) });
		const checkoutUrl = tregCheckoutUrl(result);
		if (!checkoutUrl) return jsonError('Treg did not return a valid Stripe checkout link.', 502);
		return Response.json({ checkoutUrl }, { headers: NO_STORE_HEADERS });
	} catch (error) {
		const status = (error as { status?: number }).status ?? 502;
		return jsonError(error instanceof Error ? error.message : 'Could not start Treg top-up.', status);
	}
}
