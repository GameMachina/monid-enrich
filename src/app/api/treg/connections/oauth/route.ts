import { z } from 'zod';
import { NO_STORE_HEADERS, jsonError } from '@/lib/server/credentials';
import { routeAccess } from '@/lib/server/provider-access';
import { normalizeTregOAuthStart, normalizeTregOAuthStatus, tregConnectionRequest } from '@/lib/server/treg-connections';

export const maxDuration = 30;

const httpsUrl = z.string().trim().url().refine((value) => {
	try { return new URL(value).protocol === 'https:'; } catch { return false; }
}, 'must be an HTTPS URL');

const startInput = z.object({
	service: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
	capability: z.string().trim().max(160).optional(),
	clientId: z.string().trim().max(2000).optional(),
	clientSecret: z.string().max(12000).optional(),
	authUri: httpsUrl.optional(),
	tokenUri: httpsUrl.optional(),
	scopes: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
	redirectUri: httpsUrl.optional(),
}).strict().superRefine((input, context) => {
	const hasCustomOAuth = Boolean(input.clientId || input.clientSecret || input.authUri || input.tokenUri || input.scopes?.length || input.redirectUri);
	if (!hasCustomOAuth) return;
	for (const key of ['clientId', 'clientSecret', 'authUri', 'tokenUri'] as const) {
		if (!input[key]?.trim()) context.addIssue({ code: 'custom', path: [key], message: 'is required when using your own OAuth app' });
	}
	if (!input.scopes?.length) context.addIssue({ code: 'custom', path: ['scopes'], message: 'add at least one OAuth scope' });
});

export async function POST(request: Request) {
	const access = await routeAccess(request);
	if (access instanceof Response) return access;
	const parsed = startInput.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return jsonError(`Invalid Treg OAuth request: ${parsed.error.issues[0]?.message ?? 'check the provider.'}`, 400);
	try {
		const value = await tregConnectionRequest(access.requireKey('treg'), '/oauth/start', { method: 'POST', body: JSON.stringify({
			provider: parsed.data.service,
			...(parsed.data.capability ? { capability: parsed.data.capability } : {}),
			name: parsed.data.service,
			...(parsed.data.clientId ? {
				client_id: parsed.data.clientId,
				client_secret: parsed.data.clientSecret,
				auth_uri: parsed.data.authUri,
				token_uri: parsed.data.tokenUri,
				scopes: parsed.data.scopes,
				...(parsed.data.redirectUri ? { redirect_uri: parsed.data.redirectUri } : {}),
			} : {}),
		}) });
		return Response.json(normalizeTregOAuthStart(value), { headers: NO_STORE_HEADERS });
	} catch (error) {
		const status = (error as { status?: number }).status ?? 502;
		const message = error instanceof Error ? error.message : 'Could not start Treg account authorization.';
		const safeMessage = parsed.data.clientSecret ? message.split(parsed.data.clientSecret).join('[redacted]') : message;
		return jsonError(safeMessage, status);
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
