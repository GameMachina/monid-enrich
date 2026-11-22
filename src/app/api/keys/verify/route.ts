import type { KeyVerification } from '@/lib/types';
import { NO_STORE_HEADERS } from '@/lib/server/credentials';
import { monidHealth } from '@/lib/server/monid';
import { routeAccess, serverKeyAvailability } from '@/lib/server/provider-access';
import { verifyOpenAI } from '@/lib/server/verify-openai';
import { tregBalanceUsd, tregRequest } from '@/lib/server/treg';

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

async function verifyTreg(key: string): Promise<NonNullable<KeyVerification['treg']>> {
	try {
		await tregRequest(key, '/auth/me');
		const billing = await tregRequest(key, '/billing');
		const balanceUsd = tregBalanceUsd(billing);
		return { ok: true, ...(balanceUsd !== undefined ? { balanceUsd } : {}), message: balanceUsd === undefined ? 'Connected · Treg balance is reported separately in Configuration' : `Connected · $${balanceUsd.toFixed(2)} Treg team balance` };
	} catch (error) {
		const status = (error as { status?: number }).status;
		const issue = status === 401 || status === 403 ? 'key' : status === 402 ? 'balance' : 'connection';
		return { ok: false, issue, message: issue === 'key' ? 'Treg rejected this API key.' : issue === 'balance' ? 'Treg reported insufficient team balance.' : error instanceof Error ? error.message : 'Could not reach Treg.' };
	}
}

/** The connection check is read-only. The optional inference probe runs only when explicitly requested in Settings. */
export async function POST(request: Request) {
	const access = await routeAccess(request);
	if (access instanceof Response) return access;
	const query = new URL(request.url).searchParams;
	const only = query.get('openaiOnly') === 'true' ? ['openai'] : query.get('only')?.split(',');
	const check = (provider: string) => !only || only.includes(provider);
	const inference = query.get('inference') === 'true';
	const openaiKey = check('openai') ? access.key('openai') : null;
	const monidKey = check('monid') ? access.key('monid') : null;
	const tregKey = check('treg') ? access.key('treg') : null;
	const [openai, monid, treg] = await Promise.all([
		!check('openai') ? Promise.resolve({ ok: false, message: 'Not checked' })
			: openaiKey ? access.openaiEndpoint().then((endpoint) => verifyOpenAI(openaiKey, access.model, endpoint, inference))
			: Promise.resolve({ ok: false, message: 'No OpenAI key. AI reasoning is optional.' }),
		!check('monid') ? Promise.resolve({ ok: false, message: 'Not checked' })
			: monidKey ? verifyMonid(monidKey)
			: Promise.resolve({ ok: false, message: 'No Monid key' }),
		!check('treg') ? Promise.resolve({ ok: false, message: 'Not checked' })
			: tregKey ? verifyTreg(tregKey)
			: Promise.resolve({ ok: false, message: 'No Treg key' }),
	]);
	const checkedMonid = 'balanceUsd' in monid ? monid : undefined;
	const result: KeyVerification = { openai, monid, treg, context: { ok: monid.ok, message: monid.message, ...(checkedMonid?.balanceUsd !== undefined ? { credits: checkedMonid.balanceUsd } : {}) }, typesafe: { ok: false, configured: false, message: 'TypeSafe is not supported.' } };
	return new Response(JSON.stringify(result), { status: 200, headers: NO_STORE_HEADERS });
}

export async function GET(request: Request) {
	return new Response(JSON.stringify(await serverKeyAvailability(request)), { status: 200, headers: NO_STORE_HEADERS });
}
