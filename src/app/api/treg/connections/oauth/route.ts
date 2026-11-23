import { z } from 'zod';
import { NO_STORE_HEADERS, jsonError } from '@/lib/server/credentials';
import { routeAccess } from '@/lib/server/provider-access';
import { normalizeTregOAuthStart, normalizeTregOAuthStatus, tregConnectionRequest } from '@/lib/server/treg-connections';

export const maxDuration = 30;

const startInput = z.object({ service: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,79}$/), capability: z.string().trim().max(160).optional(), name: z.string().trim().max(100).optional() }).strict();

export async function POST(request: Request) {
	const access = await routeAccess(request);
	if (access instanceof Response) return access;
	const parsed = startInput.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return jsonError(`Invalid Treg OAuth request: ${parsed.error.issues[0]?.message ?? 'check the provider.'}`, 400);
	try {
		const value = await tregConnectionRequest(access.requireKey('treg'), '/oauth/start', { method: 'POST', body: JSON.stringify({ provider: parsed.data.service, ...(parsed.data.capability ? { capability: parsed.data.capability } : {}), ...(parsed.data.name ? { name: parsed.data.name } : {}) }) });
		return Response.json(normalizeTregOAuthStart(value), { headers: NO_STORE_HEADERS });
	} catch (error) {
		const status = (error as { status?: number }).status ?? 502;
		return jsonError(error instanceof Error ? error.message : 'Could not start Treg account authorization.', status);
	}
}

export async function GET(request: Request) {
	const access = await routeAccess(request);
	if (access instanceof Response) return access;
	const state = new URL(request.url).searchParams.get('state')?.trim() ?? '';
	if (!/^[A-Za-z0-9._:-]{8,256}$/.test(state)) return jsonError('Enter a valid Treg authorization state.', 400);
	try {
		const value = await tregConnectionRequest(access.requireKey('treg'), `/oauth/status/${encodeURIComponent(state)}`);
		return Response.json(normalizeTregOAuthStatus(value), { headers: NO_STORE_HEADERS });
	} catch (error) {
		const status = (error as { status?: number }).status ?? 502;
		return jsonError(error instanceof Error ? error.message : 'Could not check Treg authorization status.', status);
	}
}
