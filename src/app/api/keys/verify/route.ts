import type { KeyVerification } from '@/lib/types';
import { NO_STORE_HEADERS } from '@/lib/server/credentials';
import { monidHealth } from '@/lib/server/monid';
import { routeAccess, serverKeyAvailability } from '@/lib/server/provider-access';
import { verifyOpenAI } from '@/lib/server/verify-openai';
import { WorkspaceError } from '@/lib/workspace';

export const maxDuration = 30;

async function verifyMonid(key: string): Promise<NonNullable<KeyVerification['monid']>> {
	try {
		const health = await monidHealth(key);
		return { ok: true, balanceUsd: health.balanceUsd, message: `Connected · $${health.balanceUsd.toFixed(2)} wallet balance` };
	} catch (error) {
		const status = (error as { status?: number }).status;
		const issue = status === 401 || status === 403 ? 'key' : status === 402 ? 'balance' : undefined;
		return { ok: false, issue, message: issue === 'key' ? 'Monid rejected this API key.' : issue === 'balance' ? 'The Monid workspace has insufficient balance.' : error instanceof Error ? error.message : 'Could not reach Monid.' };
	}
}

/** The connection check is read-only. The optional inference probe runs only when explicitly requested in Settings. */
export async function POST(request: Request) {
	const access = await routeAccess(request, { allowExplicitKeyOverrides: true });
	if (access instanceof Response) return access;
	const query = new URL(request.url).searchParams;
	const only = query.get('openaiOnly') === 'true' ? ['openai'] : query.get('only')?.split(',');
	const check = (provider: string) => !only || only.includes(provider);
	const inference = query.get('inference') === 'true';
	const openaiKey = check('openai') ? access.key('openai') : null;
	const monidKey = check('monid') ? access.key('monid') : null;
	const [openai, monid] = await Promise.all([
		!check('openai') ? Promise.resolve({ ok: false, message: 'Not checked' })
			: openaiKey ? access.openaiEndpoint().then((endpoint) => verifyOpenAI(openaiKey, access.model, endpoint, inference))
			: Promise.resolve({ ok: false, message: 'No OpenAI key. AI reasoning is optional.' }),
		!check('monid') ? Promise.resolve({ ok: false, message: 'Not checked' })
			: monidKey ? verifyMonid(monidKey)
			: Promise.resolve({ ok: false, message: 'No Monid key' }),
	]);
	const checkedMonid = 'balanceUsd' in monid ? monid : undefined;
	const result: KeyVerification = { openai, monid, context: { ok: monid.ok, message: monid.message, ...(checkedMonid?.balanceUsd !== undefined ? { credits: checkedMonid.balanceUsd } : {}) }, typesafe: { ok: false, configured: false, message: 'TypeSafe is not supported.' } };
	return new Response(JSON.stringify(result), { status: 200, headers: NO_STORE_HEADERS });
}

export async function GET(request: Request) {
	try {
		return new Response(JSON.stringify(await serverKeyAvailability(request)), { status: 200, headers: NO_STORE_HEADERS });
	} catch (error) {
		// This metadata endpoint is polled by the app shell. A missing local encryption
		// setting must be reported as a configuration problem, not leaked as a Next 500.
		const status = error instanceof WorkspaceError ? error.status : 503;
		const message = error instanceof WorkspaceError ? error.message : 'Workspace connection status is temporarily unavailable.';
		return new Response(JSON.stringify({ error: message }), { status, headers: NO_STORE_HEADERS });
	}
}
