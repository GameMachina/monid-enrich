import { NO_STORE_HEADERS, jsonError } from '@/lib/server/credentials';
import { tregProviderDirectory } from '@/lib/server/treg';
import { normalizeTregProviderDirectory } from '@/lib/server/treg-connections';

export const maxDuration = 30;

export async function GET() {
	try {
		const value = await tregProviderDirectory();
		const providers = normalizeTregProviderDirectory(value);
		return Response.json({ providers }, { headers: NO_STORE_HEADERS });
	} catch (error) {
		const status = (error as { status?: number }).status ?? 502;
		return jsonError(error instanceof Error ? error.message : 'Could not load Treg providers.', status);
	}
}
