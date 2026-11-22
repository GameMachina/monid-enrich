import 'server-only';
import { createHash } from 'node:crypto';
import type { Account } from '../auth-identity';
import type { Spend } from './enrich-failure';
import { withDatabase } from './database';

const API = 'https://api.monid.ai/v1';
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'BLOCKED', 'TIMED_OUT', 'STOPPED']);

export type MonidInput = { body?: Record<string, unknown>; queryParams?: Record<string, unknown>; pathParams?: Record<string, unknown> };
type JsonInput = Record<string, unknown>;
type CompanySearchBody = { query: string; mode?: 'fast' | 'ultra'; filters?: { countries?: string[]; employees_min?: number; employees_max?: number }; cursor?: string } & JsonInput;
type PeopleSearchBody = { query: string; mode?: 'fast' | 'ultra'; filters?: { countries?: string[]; years_of_experience_min?: number; years_of_experience_max?: number }; cursor?: string } & JsonInput;
type PeopleEnrichBody = {
	social_urls?: string[];
	name?: { first: string; last: string };
	email?: string;
	company?: { name?: string; domain?: string };
	education?: Array<{ institution?: { name?: string; domain?: string }; degree?: string; field_of_study?: string; graduation_year?: number }>;
	location?: { city?: string; region?: string; country?: string };
	timeoutMS?: number;
} & JsonInput;
type WebSearchBody = {
	query: string;
	numResults?: number;
	includeDomains?: string[];
	excludeDomains?: string[];
	freshness?: 'last_24_hours' | 'last_week' | 'last_month' | 'last_year';
	country?: string;
	languages?: 'all' | string[];
	descriptionMaxCharacters?: number;
	queryFanout?: boolean;
	markdownOptions?: JsonInput;
	timeoutMS?: number;
} & JsonInput;
type WebScrapeBody = {
	url: string;
	formats: JsonInput;
	markdownParams?: JsonInput;
	screenshotParams?: JsonInput;
	imageParams?: JsonInput;
	parseParams?: JsonInput;
	highlightsParams?: JsonInput;
	jsonParams?: JsonInput;
	productParams?: JsonInput;
	sharedParams?: JsonInput;
	maxAgeMs?: number;
	timeoutOpts?: { milliseconds: number; behavior?: 'fail' | 'return-partial' };
} & JsonInput;
type WebUrlsQuery = {
	domain: string;
	includeSubdomains?: boolean;
	maxLinks?: number;
	sitemapUrl?: string;
	urlRegex?: string;
	excludeUrlRegex?: string;
	search?: string;
	timeoutMS?: number;
} & JsonInput;
type BrandLookup = { domain: string } | { name: string } | { ticker: string } | { email: string } | { direct_url: string };

/** Operations allowed by this app, each tied to a catalog-inspected Monid endpoint and input placement. */
export interface MonidOperationInputs {
	'company.search': { body: CompanySearchBody };
	'company.brand': { queryParams: BrandLookup & JsonInput };
	'people.search': { body: PeopleSearchBody };
	'people.enrich': { body: PeopleEnrichBody };
	'people.mobilePhone': { body: { 'Social Profile URL': string; 'Full Name': string; 'Company Name': string; 'Company Domain'?: string; 'Work Email'?: string; 'Personal Email'?: string } };
	'people.mobilePhone.leadmagic': { body: { profileUrl?: string; workEmail?: string; personalEmail?: string; email?: string; route?: 'leadmagic' } };
	'web.search': { body: WebSearchBody };
	'web.scrape': { body: WebScrapeBody };
	'web.urls': { queryParams: WebUrlsQuery };
	'email.find': { queryParams: JsonInput & { domain: string; full_name?: string; first_name?: string; last_name?: string; linkedin_handle?: string; max_duration?: number } };
	'email.verify': { body: JsonInput & { email: string } };
}
export type MonidOperationName = keyof MonidOperationInputs;
const MONID_OPERATIONS = {
	'company.search': { provider: 'context.dev', endpoint: '/company/search' },
	'company.brand': { provider: 'context.dev', endpoint: '/brand/retrieve' },
	'people.search': { provider: 'context.dev', endpoint: '/people/search' },
	'people.enrich': { provider: 'context.dev', endpoint: '/people/enrich' },
	'people.mobilePhone': { provider: 'clay', endpoint: '/enrichment/mobile-phone' },
	'people.mobilePhone.leadmagic': { provider: 'anyapi', endpoint: '/mobile_phone.leadmagic' },
	'web.search': { provider: 'context.dev', endpoint: '/web/search' },
	'web.scrape': { provider: 'context.dev', endpoint: '/web/scrape' },
	'web.urls': { provider: 'context.dev', endpoint: '/web/urls' },
	'email.find': { provider: 'hunterio', endpoint: '/email-finder' },
	'email.verify': { provider: 'anyapi', endpoint: '/email.verify' },
} as const satisfies Record<MonidOperationName, { provider: string; endpoint: string }>;
export interface MonidRun {
	runId: string;
	provider: string;
	endpoint: string;
	status: string;
	output?: unknown;
	providerResponse?: { httpStatus?: number; error?: unknown };
	price?: { type?: string; amount?: number; currency?: string };
	cost?: { value?: number; currency?: string };
	billedUnits?: number;
	resultCount?: number | null;
	createdAt?: string;
	completedAt?: string;
	[key: string]: unknown;
}

export class MonidError extends Error {
	constructor(message: string, readonly status?: number, readonly runId?: string, readonly uncertain = false, readonly detail?: unknown) { super(message); this.name = 'MonidError'; }
}

export function runMonidOperation<K extends MonidOperationName>(apiKey: string, operation: K, input: MonidOperationInputs[K], options: { signal?: AbortSignal; spend?: Spend; actor?: Account; timeoutMs?: number } = {}) {
	const endpoint = MONID_OPERATIONS[operation];
	return runMonid(apiKey, endpoint.provider, endpoint.endpoint, input, options);
}

/** Typed request contracts for provider routes inspected in Monid's live catalog. */
export interface MonidWaterfallInputs {
	'email.quickenrich': { body: { linkedinUrl?: string; companyDomain?: string; firstName?: string; lastName?: string } };
	'email.hunter': { queryParams: { domain: string; company?: string; full_name?: string; first_name?: string; last_name?: string; linkedin_handle?: string; max_duration?: number } };
	'email.apollo': { queryParams: { name?: string; first_name?: string; last_name?: string; domain?: string; organization_name?: string; linkedin_url?: string } };
	'email.prospeo': { body: { linkedinUrl?: string; fullName?: string; firstName?: string; lastName?: string; companyWebsite?: string; companyName?: string; onlyVerifiedEmail?: boolean } };
	'email.contactout': { queryParams: { profile: string; email_type?: 'work' | 'none' } };
	'phone.leadmagic': { body: { profileUrl?: string; workEmail?: string; personalEmail?: string; email?: string } };
	'phone.clay': { body: { 'Social Profile URL': string; 'Full Name': string; 'Company Name': string; 'Company Domain'?: string; 'Work Email'?: string; 'Personal Email'?: string } };
	'phone.aiArk': { body: { linkedinUrl?: string; domain?: string; fullName?: string } };
	'phone.reverseContact': { body: { url?: string; fullName?: string; firstName?: string; lastName?: string; companyDomain?: string } };
	'phone.prospeo': { body: { linkedinUrl?: string; email?: string; fullName?: string; firstName?: string; lastName?: string; companyWebsite?: string; companyName?: string; enrichMobile: true } };
	'social.linkedin.apify': { body: { profileScraperMode: 'Short'; firstName: string; lastName: string; strictSearch: true; maxPages: 1; maxItems: 5 } };
	'social.linkedin.ploid': { body: { filters: { keywords: string; currentCompany?: string }; limit: number } };
	'social.linkedin.anyapi': { body: { query: string } };
	'social.instagram.anyapi': { body: { query: string } };
	'social.instagram.tikhub': { queryParams: { query: string; select: 'users' } };
	'social.facebook.litescrape': { queryParams: { query: string; limit: number } };
	'social.x.anyapi': { body: { query: string } };
	'social.tiktok.anyapi': { body: { query: string } };
	'social.tiktok.tikhub': { queryParams: { keyword: string } };
	'social.youtube.tikhub': { queryParams: { keyword: string; need_format: true } };
	'social.youtube.litescrape': { queryParams: { q: string; type: 'channel' } };
}
type MonidWaterfallName = keyof MonidWaterfallInputs;
const MONID_WATERFALL_ROUTES = {
	'email.quickenrich': { provider: 'anyapi', endpoint: '/email_finding.quickenrich' },
	'email.hunter': { provider: 'hunterio', endpoint: '/email-finder' },
	'email.apollo': { provider: 'apollo', endpoint: '/people/match' },
	'email.prospeo': { provider: 'anyapi', endpoint: '/person_enrichment.prospeo' },
	'email.contactout': { provider: 'contactout', endpoint: '/v1/people/linkedin/work-email' },
	'phone.leadmagic': { provider: 'anyapi', endpoint: '/mobile_phone.leadmagic' },
	'phone.clay': { provider: 'clay', endpoint: '/enrichment/mobile-phone' },
	'phone.aiArk': { provider: 'anyapi', endpoint: '/mobile_phone.ai_ark' },
	'phone.reverseContact': { provider: 'reversecontact', endpoint: '/v2/contact/phone' },
	'phone.prospeo': { provider: 'anyapi', endpoint: '/person_enrichment.prospeo' },
	'social.linkedin.apify': { provider: 'apify', endpoint: '/harvestapi/linkedin-profile-search-by-name' },
	'social.linkedin.ploid': { provider: 'ploid', endpoint: '/linkedin/search' },
	'social.linkedin.anyapi': { provider: 'anyapi', endpoint: '/linkedin.search_profiles_thin' },
	'social.instagram.anyapi': { provider: 'anyapi', endpoint: '/instagram.search_profiles' },
	'social.instagram.tikhub': { provider: 'tikhub', endpoint: '/api/v1/instagram/v1/fetch_search' },
	'social.facebook.litescrape': { provider: 'litescrape', endpoint: '/facebook/search-profiles' },
	'social.x.anyapi': { provider: 'anyapi', endpoint: '/twitter.search_users' },
	'social.tiktok.anyapi': { provider: 'anyapi', endpoint: '/tiktok.search_users' },
	'social.tiktok.tikhub': { provider: 'tikhub', endpoint: '/api/v1/tiktok/web/fetch_search_user' },
	'social.youtube.tikhub': { provider: 'tikhub', endpoint: '/api/v1/youtube/web_v2/search_channels' },
	'social.youtube.litescrape': { provider: 'litescrape', endpoint: '/youtube/search' },
} as const satisfies Record<MonidWaterfallName, { provider: string; endpoint: string }>;

/** Routes a typed waterfall operation through Monid's authenticated run and polling layer. */
export function runMonidWaterfall<K extends MonidWaterfallName>(apiKey: string, operation: K, input: MonidWaterfallInputs[K], options: { signal?: AbortSignal; spend?: Spend; actor?: Account; timeoutMs?: number } = {}) {
	const route = MONID_WATERFALL_ROUTES[operation];
	return runMonid(apiKey, route.provider, route.endpoint, input as MonidInput, options);
}

function jsonObject(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function costOf(run: MonidRun): number | undefined {
	if (typeof run.cost?.value === 'number') return run.cost.value;
	const billing = jsonObject(run.billing);
	const actual = jsonObject(billing.actualCost);
	const reported = jsonObject(billing.reportedCost);
	const selected = typeof actual.value === 'number' ? actual : reported;
	const value = selected.value;
	if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
	const unit = selected.unit;
	return unit === 'MICRO_DOLLAR' ? value / 1_000_000 : value;
}

function responseMessage(body: unknown, fallback: string): string {
	const visit = (value: unknown, depth: number): string | undefined => {
		if (depth > 4) return undefined;
		if (typeof value === 'string') return value.trim() || undefined;
		if (Array.isArray(value)) {
			const messages = value.map((entry) => visit(entry, depth + 1)).filter((entry): entry is string => Boolean(entry));
			return messages.length ? messages.join('; ') : undefined;
		}
		if (!value || typeof value !== 'object') return undefined;
		const object = value as Record<string, unknown>;
		for (const key of ['message', 'reason', 'error_description', 'description']) {
			const message = visit(object[key], depth + 1);
			if (message) return message;
		}
		for (const key of ['error', 'detail', 'details', 'errors', 'cause', 'data']) {
			const message = visit(object[key], depth + 1);
			if (message) return message;
		}
		const code = object.error_code ?? object.code;
		return typeof code === 'string' && code.trim() ? `Provider error: ${code.trim()}` : undefined;
	};
	return visit(body, 0)?.slice(0, 1000) ?? fallback;
}

function monidFailureMessage(status: number) {
	if (status === 504) return 'Monid timed out before returning a run receipt. Check Monid run history before retrying.';
	return status >= 500 ? 'Monid could not complete the request.' : 'Monid request failed.';
}

async function parseResponse(response: Response): Promise<MonidRun> {
	const body: unknown = await response.json().catch(() => ({}));
	if (!response.ok && response.status !== 202) {
		const message = response.status === 504 ? monidFailureMessage(response.status) : responseMessage(body, monidFailureMessage(response.status));
		throw new MonidError(message, response.status, undefined, response.status >= 500, body);
	}
	return body as MonidRun;
}

async function persistRun(actor: Account | undefined, run: MonidRun, input: MonidInput, apiKey: string, costUsd?: number) {
	if (!actor || !run.runId) return;
	const inputHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
	const now = Date.now();
	const reportedCreatedAt = run.createdAt ? Date.parse(run.createdAt) : NaN;
	const createdAt = Number.isFinite(reportedCreatedAt) ? reportedCreatedAt : now;
	const error = run.providerResponse?.error === undefined ? null : (JSON.stringify(run.providerResponse.error) ?? String(run.providerResponse.error)).replaceAll(apiKey, '[redacted]').slice(0, 2000);
	await withDatabase((database) => database.transaction(async (sql, workspace) => {
		await sql.query(`INSERT INTO enrichable.monid_runs (workspace_id,run_id,provider,endpoint,status,input_hash,cost_usd,billed_units,price,result_count,error,created_at,updated_at)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12,$13)
			ON CONFLICT (workspace_id,run_id) DO UPDATE SET status=excluded.status,cost_usd=excluded.cost_usd,billed_units=excluded.billed_units,price=excluded.price,result_count=excluded.result_count,error=excluded.error,updated_at=excluded.updated_at`,
		[workspace, run.runId, run.provider, run.endpoint, run.status, inputHash, costUsd ?? null, run.billedUnits ?? null, JSON.stringify(run.price ?? null), run.resultCount ?? null, JSON.stringify(error), createdAt, now]);
	}, { workspace: actor }));
}

export async function monidRequest(apiKey: string, path: string, init: RequestInit = {}) {
	if (!path.startsWith('/')) throw new Error('Invalid Monid API path.');
	const response = await fetch(`${API}${path}`, {
		...init,
		headers: { authorization: `Bearer ${apiKey}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
		cache: 'no-store',
		signal: init.signal ?? AbortSignal.timeout(30_000),
	});
	const body: unknown = await response.json().catch(() => ({}));
	if (!response.ok) throw new MonidError(responseMessage(body, monidFailureMessage(response.status)), response.status, undefined, response.status >= 500, body);
	return body;
}

/** Submit once and, when Monid returns 202, poll only the returned run ID. We never resubmit an uncertain run. */
export async function runMonid(apiKey: string, provider: string, endpoint: string, input: MonidInput, options: { signal?: AbortSignal; spend?: Spend; actor?: Account; timeoutMs?: number } = {}): Promise<MonidRun> {
	let response: Response;
	try {
		response = await fetch(`${API}/run`, { method: 'POST', headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ provider, endpoint, input }), cache: 'no-store', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 120_000)]) : AbortSignal.timeout(options.timeoutMs ?? 120_000) });
	} catch (cause) {
		options.spend?.recordMonid({ provider, endpoint, status: 'UNCERTAIN' });
		throw new MonidError('Monid did not return a run receipt. The operation was not retried; check Monid run history before trying again.', undefined, undefined, true, cause);
	}
	let run: MonidRun;
	try { run = await parseResponse(response); }
	catch (error) {
		if (error instanceof MonidError && error.uncertain) options.spend?.recordMonid({ provider, endpoint, status: 'UNCERTAIN' });
		throw error;
	}
	if (!run.runId) throw new MonidError('Monid returned no run ID. The result could not be confirmed; it was not retried.', response.status, undefined, true, run);
	options.spend?.recordMonid({ runId: run.runId, provider, endpoint, status: run.status, costUsd: costOf(run), billedUnits: run.billedUnits, price: run.price, resultCount: run.resultCount ?? undefined, completedAt: run.completedAt });
	try { await persistRun(options.actor, run, input, apiKey, costOf(run)); }
	catch (cause) { throw new MonidError(`Monid created run ${run.runId}, but its receipt could not be saved. It was not resubmitted; check this run in Monid before retrying.`, undefined, run.runId, true, cause); }
	const started = Date.now();
	while (response.status === 202 || !TERMINAL.has(run.status)) {
		if (options.signal?.aborted) throw new MonidError('The Monid run is still active. Resume by checking this run in Monid; it was not submitted again.', undefined, run.runId, true);
		if (Date.now() - started >= (options.timeoutMs ?? 120_000)) throw new MonidError('Monid is still processing this run. It was left running and was not resubmitted.', 408, run.runId, true);
		await new Promise((resolve) => setTimeout(resolve, 1500));
		let poll: Response;
		try {
			poll = await fetch(`${API}/runs/${encodeURIComponent(run.runId)}`, { headers: { authorization: `Bearer ${apiKey}` }, cache: 'no-store', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
			run = await parseResponse(poll);
		} catch (cause) {
			throw new MonidError(`Could not check Monid run ${run.runId}. Its status is uncertain; it was not submitted again.`, (cause as { status?: number }).status, run.runId, true, cause);
		}
		response = poll;
		options.spend?.recordMonid({ runId: run.runId, provider, endpoint, status: run.status, costUsd: costOf(run), billedUnits: run.billedUnits, price: run.price, resultCount: run.resultCount ?? undefined, completedAt: run.completedAt });
		await persistRun(options.actor, run, input, apiKey, costOf(run)).catch(() => {});
	}
	const costUsd = costOf(run);
	options.spend?.recordMonid({ runId: run.runId, provider, endpoint, status: run.status, costUsd, billedUnits: run.billedUnits, price: run.price, resultCount: run.resultCount ?? undefined, completedAt: run.completedAt });
	if (run.status === 'BLOCKED') throw new MonidError(responseMessage(run.providerResponse?.error ?? run, 'Monid blocked this run. Check the workspace wallet or controls.'), 402, run.runId, false, run);
	if (run.status === 'FAILED' || run.status === 'TIMED_OUT' || run.status === 'STOPPED') throw new MonidError(responseMessage(run.providerResponse?.error ?? run, `Monid run ${run.status.toLowerCase()}.`), run.status === 'TIMED_OUT' ? 408 : 502, run.runId, false, run);
	const providerStatus = run.providerResponse?.httpStatus;
	if (typeof providerStatus === 'number' && (providerStatus < 200 || providerStatus >= 300)) throw new MonidError(responseMessage(run.providerResponse?.error, `Monid provider endpoint returned ${providerStatus}.`), providerStatus, run.runId, false, run);
	return run;
}

export async function monidHealth(apiKey: string) {
	const data = jsonObject(await monidRequest(apiKey, '/wallet/balance'));
	const balance = jsonObject(data.balance);
	if (typeof balance.value !== 'number' || balance.currency !== 'USD') throw new MonidError('Monid returned an unexpected wallet balance response.');
	return { ok: true as const, balanceUsd: balance.value, currency: 'USD' as const };
}
