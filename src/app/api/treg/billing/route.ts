import { NO_STORE_HEADERS, jsonError } from '@/lib/server/credentials';
import { routeAccess } from '@/lib/server/provider-access';
import { tregBalanceUsd, tregRequest, tregTopupDefaultUsd } from '@/lib/server/treg';
import { workspaceAdminResponse } from '@/lib/server/request-admin';

export const maxDuration = 30;

export async function GET(request: Request) {
	const access = await routeAccess(request);
	if (access instanceof Response) return access;
	const denied = await workspaceAdminResponse();
	if (denied) return denied;
	try {
		const token = access.requireKey('treg');
		const [identity, billing] = await Promise.all([tregRequest(token, '/auth/me'), tregRequest(token, '/billing')]);
		const user = identity && typeof identity === 'object' ? identity as Record<string, unknown> : {};
		const organization = user.organization && typeof user.organization === 'object' ? user.organization as Record<string, unknown> : {};
		return Response.json({ connected: true, balanceUsd: tregBalanceUsd(billing) ?? null, topupDefaultUsd: tregTopupDefaultUsd(billing) ?? null, teamName: typeof organization.name === 'string' ? organization.name : null }, { headers: NO_STORE_HEADERS });
	} catch (error) {
		const status = (error as { status?: number }).status ?? 502;
		return jsonError(error instanceof Error ? error.message : 'Could not check Treg billing.', status);
	}
}
