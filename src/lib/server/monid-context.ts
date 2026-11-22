import 'server-only';
import type ContextDev from 'context.dev';
import type { Spend } from './enrich-failure';
import type { Account } from '../auth-identity';
import { MonidError, runMonidOperation, type MonidOperationInputs, type MonidOperationName } from './monid';

type AnyRecord = Record<string, unknown>;
type RequestOptions = { signal?: AbortSignal; timeout?: number; timeoutOpts?: { milliseconds?: number } };

function timeoutSignal(options?: RequestOptions) {
	if (options?.signal) return options.signal;
	const ms = options?.timeout ?? options?.timeoutOpts?.milliseconds;
	return ms ? AbortSignal.timeout(ms) : undefined;
}

function object(value: unknown): AnyRecord { return value && typeof value === 'object' && !Array.isArray(value) ? value as AnyRecord : {}; }

/** Small compatibility surface for existing Enrichable operations; every call is POSTed to Monid's /v1/run. */
export function monidContextClient(apiKey: string, spend?: Spend, actor?: Account): ContextDev {
	const call = async <K extends MonidOperationName>(operation: K, input: MonidOperationInputs[K], options?: RequestOptions) => {
		const run = await runMonidOperation(apiKey, operation, input, { signal: timeoutSignal(options), spend, actor, timeoutMs: options?.timeout ?? options?.timeoutOpts?.milliseconds });
		return object(run.output);
	};
	const client = {
		withOptions() { return client; },
		async post(path: string, options: AnyRecord = {}) {
			if (path !== '/company/search') throw new MonidError(`Monid operation not supported: ${path}`);
			return call('company.search', { body: object(options.body) as MonidOperationInputs['company.search']['body'] }, options);
		},
		brand: {
			async retrieve(input: AnyRecord, options?: RequestOptions) {
				const lookup = input.type === 'by_domain' ? { domain: input.domain } : input.type === 'by_email' ? { email: input.email } : input.type === 'by_name' ? { name: input.name } : {};
				const response = await call('company.brand', { queryParams: lookup as MonidOperationInputs['company.brand']['queryParams'] }, options);
				return response.brand ? response : { ...response, brand: response };
			},
			async search(input: AnyRecord, options?: RequestOptions) {
				const response = await call('company.search', { body: { query: String(input.query), mode: 'fast' } }, options);
				const results = Array.isArray(response.results) ? response.results : [];
				return { ...response, results: results.map((entry: unknown) => { const company = object(entry); return { name: String(company.name ?? ''), domain: String(company.domain ?? '') }; }) };
			},
		},
		people: {
			async enrich(input: AnyRecord, options?: RequestOptions) {
				const body: AnyRecord = {};
				for (const field of ['social_urls', 'name', 'email', 'company', 'education', 'location']) if (input[field] !== undefined) body[field] = input[field];
				return call('people.enrich', { body: body as MonidOperationInputs['people.enrich']['body'] }, options);
			},
			async search(input: AnyRecord, options?: RequestOptions) {
				const body: AnyRecord = { query: input.query, mode: input.mode ?? 'fast' };
				for (const field of ['filters', 'cursor']) if (input[field] !== undefined) body[field] = input[field];
				return call('people.search', { body: body as MonidOperationInputs['people.search']['body'] }, options);
			},
		},
		web: {
			async scrape(input: AnyRecord, options?: RequestOptions) {
				const body: AnyRecord = { url: input.url, formats: input.formats ?? { markdown: true } };
				for (const field of ['markdownParams', 'screenshotParams', 'imageParams', 'parseParams', 'highlightsParams', 'productParams', 'sharedParams', 'maxAgeMs', 'timeoutOpts']) if (input[field] !== undefined) body[field] = input[field];
			const response = await call('web.scrape', { body: body as MonidOperationInputs['web.scrape']['body'] }, options);
			return response;
			},
			async search(input: AnyRecord, options?: RequestOptions) {
				const body: MonidOperationInputs['web.search']['body'] = { query: String(input.query).slice(0, 500), numResults: typeof input.numResults === 'number' ? input.numResults : 10 };
				for (const field of ['includeDomains', 'excludeDomains', 'freshness', 'country', 'languages', 'descriptionMaxCharacters']) if (input[field] !== undefined) body[field] = input[field];
				return call('web.search', { body }, options);
			},
			async mapUrls(input: AnyRecord, options?: RequestOptions) {
				const queryParams: MonidOperationInputs['web.urls']['queryParams'] = { domain: String(input.domain), maxLinks: typeof input.maxLinks === 'number' ? input.maxLinks : 100 };
				if (typeof input.search === 'string') queryParams.search = input.search;
				const response = await call('web.urls', { queryParams }, options);
				const urls = Array.isArray(response.urls) ? response.urls : Array.isArray(response.results) ? response.results : [];
				return { ...response, urls: urls.map((entry: unknown) => typeof entry === 'string' ? { url: entry } : entry) };
			},
		},
	};
	return client as unknown as ContextDev;
}
