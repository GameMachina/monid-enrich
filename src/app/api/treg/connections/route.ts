import { z } from 'zod';
import { NO_STORE_HEADERS, jsonError } from '@/lib/server/credentials';
import { routeAccess } from '@/lib/server/provider-access';
import { normalizeTregConnectResult, normalizeTregConnections, tregConnectionRequest } from '@/lib/server/treg-connections';

export const maxDuration = 30;

export async function GET(request: Request) {
	const access = await routeAccess(request);
	if (access instanceof Response) return access;
	try {
		const value = await tregConnectionRequest(access.requireKey('treg'), '/connections');
		return Response.json({ connections: normalizeTregConnections(value) }, { headers: NO_STORE_HEADERS });
	} catch (error) {
		const status = (error as { status?: number }).status ?? 502;
		return jsonError(error instanceof Error ? error.message : 'Could not load Treg connections.', status);
	}
}

const tokenInput = z.object({ service: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,79}$/), token: z.string().trim().min(1).max(12_000) }).strict();

export async function POST(request: Request) {
	const access = await routeAccess(request);
	if (access instanceof Response) return access;
	const parsed = tokenInput.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return jsonError(`Invalid Treg connection: ${parsed.error.issues[0]?.message ?? 'check the provider and credential.'}`, 400);
	try {
		const value = await tregConnectionRequest(access.requireKey('treg'), '/connections/token', { method: 'POST', body: JSON.stringify({ provider: parsed.data.service, token: parsed.data.token }) });
		return Response.json({ connection: normalizeTregConnectResult(value) }, { headers: NO_STORE_HEADERS });
	} catch (error) {
		const status = (error as { status?: number }).status ?? 502;
		return jsonError(error instanceof Error ? error.message : 'Treg could not verify this provider credential.', status);
	}
}
