import { COMPANY_SEARCH_MIN_LENGTH } from '@/lib/company-search';
import { searchCompanySuggestions } from '@/lib/server/company-search';
import { CredentialError, jsonError, NO_STORE_HEADERS } from '@/lib/server/credentials';
import { browserAccess } from '@/lib/server/provider-access';
import { runTregEndpoint, tregOutput } from '@/lib/server/treg';
import { logoDomain } from '@/lib/organization-logo';

/** Name/domain autocomplete, rather than the natural-language company discovery endpoint. */
export async function POST(request: Request) {
	try {
		const body = await request.json();
		if (typeof body?.query !== 'string' || body.query.trim().length < COMPANY_SEARCH_MIN_LENGTH || body.query.trim().length > 200) {
			return jsonError('Enter between 3 and 200 characters to search companies.', 400);
		}
		if (body?.dataProvider !== undefined && body.dataProvider !== 'monid' && body.dataProvider !== 'treg') return jsonError('Choose Monid or Treg as the company search provider.', 400);
		const provider = body?.dataProvider ?? 'monid';
		const access = await browserAccess(request);
		if (!access.key(provider)) return jsonError(`Connect ${provider === 'treg' ? 'Treg' : 'Monid'} in Configuration to search companies.`, 401);
		let companies;
		if (provider === 'treg') {
			const { data } = await runTregEndpoint(access, { operation: 'companyenrich.companies.autocomplete', endpoint: 'companyenrich.companies.autocomplete', method: 'GET', query: { query: body.query.trim() } }, { signal: request.signal });
			const output = tregOutput(data);
			const payload = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>).output ?? (data as Record<string, unknown>).result ?? output : data;
			const entries = Array.isArray(payload) ? payload : Array.isArray(output.companies) ? output.companies : Array.isArray(output.results) ? output.results : typeof output.domain === 'string' ? [output] : [];
			const seen = new Set<string>();
			companies = entries.flatMap((entry) => {
				if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
				const item = entry as Record<string, unknown>;
				const domain = logoDomain(typeof (item.domain ?? item.website) === 'string' ? String(item.domain ?? item.website) : undefined);
				if (!domain || seen.has(domain)) return [];
				seen.add(domain);
				return [{ name: typeof item.name === 'string' && item.name.trim() ? item.name.trim() : domain, domain }];
			}).slice(0, 10);
		} else {
			companies = await searchCompanySuggestions(access.context(), body.query, request.signal);
		}
		return Response.json({ companies }, { headers: NO_STORE_HEADERS });
	} catch (error) {
		if (error instanceof CredentialError) return jsonError(error.message, error.status);
		if (error instanceof SyntaxError) return jsonError('Provide a company search query.', 400);
		const status = (error as { status?: number }).status;
		return jsonError(status === 401 ? 'The selected provider rejected this key. Check its connection in Configuration.' : status === 429 ? 'The selected provider rate limited the search. Wait a moment and try again.' : 'Company search is unavailable. You can still enter a company manually.', status === 401 ? 401 : status === 429 ? 429 : 502);
	}
}
