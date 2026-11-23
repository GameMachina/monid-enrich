import { NO_STORE_HEADERS, jsonError } from '@/lib/server/credentials';
import { normalizeTregProviderDirectory } from '@/lib/server/treg-connections';

export const maxDuration = 30;

export async function GET() {
	try {
		const response = await fetch('https://treg.to/oauth/providers', { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
		const value = await response.json().catch(() => null);
		if (!response.ok) {
			const body = value && typeof value === 'object' ? value as Record<string, unknown> : {};
			const message = typeof body.detail === 'string' ? body.detail : typeof body.error === 'string' ? body.error : `Treg provider directory failed (${response.status}).`;
			return jsonError(message, 502);
		}
		const providers = normalizeTregProviderDirectory(value);
		return Response.json({ providers }, { headers: NO_STORE_HEADERS });
	} catch (error) {
		return jsonError(error instanceof Error ? error.message : 'Could not load Treg providers.', 502);
	}
}
