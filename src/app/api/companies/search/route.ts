import { COMPANY_SEARCH_MIN_LENGTH } from '@/lib/company-search';
import { searchCompanySuggestions } from '@/lib/server/company-search';
import { CredentialError, jsonError, NO_STORE_HEADERS } from '@/lib/server/credentials';
import { browserAccess } from '@/lib/server/provider-access';
import { subscriptionGate } from '@/lib/server/stripe-billing';
import { reservePaidRequest } from '@/lib/server/provider-access';

/** Name/domain autocomplete, rather than the natural-language company discovery endpoint. */
export async function POST(request: Request) {
	try {
		const body = await request.json();
		if (typeof body?.query !== 'string' || body.query.trim().length < COMPANY_SEARCH_MIN_LENGTH || body.query.trim().length > 200) {
			return jsonError('Enter between 3 and 200 characters to search companies.', 400);
		}
		if (body?.dataProvider !== undefined && body.dataProvider !== 'monid') return jsonError('Choose Monid as the company search provider.', 400);
		const access = await browserAccess(request);
		const billingBlock = await subscriptionGate(access.account);
		if (billingBlock) return billingBlock;
		if (access.account && !await reservePaidRequest(access.account)) return new Response(JSON.stringify({ error: 'This workspace reached its enrichment request limit. Wait a minute and try again.' }), { status: 429, headers: { ...NO_STORE_HEADERS, 'retry-after': '60' } });
		if (!access.key('monid')) return jsonError('Connect Monid in Configuration to search companies.', 401);
		const companies = await searchCompanySuggestions(access.context(), body.query, request.signal);
		return Response.json({ companies }, { headers: NO_STORE_HEADERS });
	} catch (error) {
		if (error instanceof CredentialError) return jsonError(error.message, error.status);
		if (error instanceof SyntaxError) return jsonError('Provide a company search query.', 400);
		const status = (error as { status?: number }).status;
		return jsonError(status === 401 ? 'The selected provider rejected this key. Check its connection in Configuration.' : status === 429 ? 'The selected provider rate limited the search. Wait a moment and try again.' : 'Company search is unavailable. You can still enter a company manually.', status === 401 ? 401 : status === 429 ? 429 : 502);
	}
}
