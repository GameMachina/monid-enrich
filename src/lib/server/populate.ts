import { lookupPerson } from './person-lookup';
import { profileUrl } from '../profile-photo';
import { planPeopleInput, populatePeopleList } from './populate-people-list';
import { companyContextForQuery } from './company-context';
import 'server-only';
import { populateLimitError } from '../populate-limit';
import { fundingLabel } from '../funding';

import { generateText, isStepCount, type StopCondition, tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { foundRowKey, foundRowKeyField } from '../found-rows';
import type { CellValue, FoundRow, PopulateEvent, PopulateRequest, TableTypeDefinition } from '../types';
import { companySearch, webSearchCountries } from './context';
import type { ProviderAccess } from './provider-access';
import { createPopulateSearchQueue } from './populate-search-queue';
import { mapConcurrent } from './map-concurrent';
import { classifyFailure } from './enrich-failure';
import { defaultTableTypeForEntity, tableTypeRunnableError } from '../table-types';
import { runMonidTableSearch } from './monid-table-runner';

/* The populate agent: OpenAI plans and paginates Context.dev searches; results stream straight to the sheet.
   The model only sees compact summaries (counts, cursors, a few names), never the full records, so a 1,000-row
   list costs a few thousand tokens of orchestration rather than copying every record through the model. */

const MAX_STEPS = 60;
/** Profile photos are a per-row extra lookup; a few in flight keeps a page of results fast without bursting Context.dev. */
const PHOTO_CONCURRENCY = 4;
const objectValue = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const textValue = (value: unknown): string | null => typeof value === 'string' ? value : null;
const cellValue = (value: unknown): CellValue => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null ? value : null;
const stringList = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
export function populateStream(access: ProviderAccess, request: PopulateRequest): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let closed = false;
	const abort = new AbortController();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			const emit = (event: PopulateEvent) => {
				if (closed) return;
				controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
			};
			const finish = () => {
				if (closed) return;
				closed = true;
				controller.close();
			};
			runPopulate(access, request, emit, abort.signal)
				.catch((error) => {
					if (!abort.signal.aborted) emit({ type: 'error', message: access.redact(error), failure: classifyFailure(error) });
				})
				.finally(finish);
		},
		// The client cancelled the stream: stop the agent so no further searches are billed.
		cancel() {
			closed = true;
			abort.abort();
		},
	});
}

/** Shared execution path for request streams and durable workspace jobs. The durable worker persists each emitted batch
 * before it reports progress, and treats a lost lease as uncertain because Find rows can make multiple paid calls. */
export async function runPopulate(access: ProviderAccess, request: PopulateRequest, emit: (event: PopulateEvent) => void, signal: AbortSignal) {
	const tableType = request.tableType ?? defaultTableTypeForEntity(request.entity);
	const readinessError = tableTypeRunnableError(tableType);
	if (tableType.status !== 'published' || readinessError || tableType.entity !== request.entity) throw new Error(readinessError ?? 'The selected table type is not published for this search.');
	request = { ...request, tableTypeId: tableType.id, tableType };
	const requestedTarget = request.target;
	const limitError = populateLimitError(requestedTarget);
	if (limitError) throw new Error(limitError);
	request = { ...request, target: Math.min(requestedTarget, request.availableRows ?? 1000) };
	if (request.entity === 'records') {
		await runMonidTableSearch(access, { ...request, tableType }, emit, signal);
		return;
	}
	if (!access.key('openai')) {
		if (!access.key('monid')) throw new Error('Connect Monid to find rows.');
		await populateDirectMonid(access, { ...request, tableType }, emit, signal);
		return;
	}
	const model = access.openai();
	if (request.entity === 'people') {
		await emit({ type: 'status', message: 'Checking for a supplied list of people…' });
		const plan = await planPeopleInput(access, request.query, signal);
		if (plan.mode === 'list') {
			if (plan.people.length > 1000) throw new Error('A single Find rows request can include up to 1,000 people.');
			await populatePeopleList(access, request, plan.people, emit, signal);
			return;
		}
	}
	const companyContext = await companyContextForQuery(access, request.query);
	const client = access.context();
	const seen = new Set((request.existingKeys ?? []).map(foundRowKey).filter(Boolean));
	const state = { added: 0, emptyStreak: 0, calls: 0 };
	const target = request.target;
	const countries = request.countries?.length ? request.countries.map((c) => c.toUpperCase()) : undefined;
	const searchInOrder = createPopulateSearchQueue(signal);
	const maxCalls = Math.min(tableType.pagination.maxCalls, 20);

	let runCursor = access.spend.monidRuns.length;
	const nextRunMeta = () => {
		const monidRuns = access.spend.monidRuns.slice(runCursor);
		runCursor = access.spend.monidRuns.length;
		return monidRuns.length ? { monidRuns } : undefined;
	};
	const push = async (rows: FoundRow[]) => {
		const accepted = rows.slice(0, Math.max(0, target - state.added));
		if (accepted.length) {
			state.added += accepted.length;
			await emit({ type: 'rows', rows: accepted, key: foundRowKeyField(request.entity), meta: nextRunMeta() });
		}
		return accepted;
	};
	const summarise = async (added: number, names: string[], nextCursor: string | null, total: number) => {
		state.calls += 1;
		state.emptyStreak = added === 0 ? state.emptyStreak + 1 : 0;
		await emit({ type: 'status', message: added ? `Added ${added} (${state.added} of ${target})` : `No new results (${state.added} of ${target})` });
		return { added_this_call: added, returned_this_call: total, total_added: state.added, target, remaining: Math.max(0, target - state.added), next_cursor: nextCursor, sample: names.slice(0, 5), hint: nextCursor ? 'Call again with next_cursor to continue this query.' : 'This query is exhausted; try a different angle.' };
	};
	const callsExhausted = () => state.calls >= maxCalls;

	const tools: ToolSet = {};
	if (request.entity === 'companies') {
		tools.searchCompanies = tool({
			description: 'Find companies matching a plain-language description. Results are added to the sheet automatically. Pass next_cursor from a previous call to get the next page of the same query (keep query and filters identical).',
			inputSchema: z.object({
				query: z.string().max(400).describe('What kind of companies: industry, location, size, business model. Natural language.'),
				employees_min: z.number().int().min(0).optional(),
				employees_max: z.number().int().min(0).optional(),
				cursor: z.string().max(64).optional().describe('next_cursor from the previous call of the same query'),
			}),
			execute: async ({ query, employees_min, employees_max, cursor }) => searchInOrder(async () => {
				if (callsExhausted()) return { error: 'The configured search-call limit has been reached.' };
				if (state.added >= target) return summarise(0, [], null, 0);
				const result = await companySearch(client, { query, filters: { countries, employees_min, employees_max }, cursor });
				const rows: FoundRow[] = [];
				for (const hit of result.results) {
					const key = foundRowKey(hit.domain);
					if (!key || seen.has(key)) continue;
					seen.add(key);
					rows.push(companyRow(hit));
				}
				const accepted = await push(rows);
				return summarise(accepted.length, accepted.map((row) => String(row.Company ?? '')), result.next_cursor, result.results.length);
			}),
		});
	}
	if (request.entity === 'people') {
		tools.searchPeople = tool({
			description: 'Find people matching a description of role, employer, industry, location, skills, or background. Results are added to the sheet automatically. Pass next_cursor to continue the same query.',
			inputSchema: z.object({
				query: z.string().max(2000),
				mode: z.enum(['fast', 'ultra']).default('fast').describe('ultra judges each candidate against every criterion; slower and 5x the cost. Use it only for multi-criteria queries.'),
				years_of_experience_min: z.number().int().min(0).optional(),
				years_of_experience_max: z.number().int().min(0).optional(),
				cursor: z.string().optional(),
			}),
			execute: async ({ query, mode, years_of_experience_min, years_of_experience_max, cursor }) => searchInOrder(async () => {
				if (callsExhausted()) return { error: 'The configured search-call limit has been reached.' };
				if (state.added >= target) return summarise(0, [], null, 0);
				const response = await client.people.search({ query, mode, filters: { countries, years_of_experience_min, years_of_experience_max }, cursor }, { signal });
				const hits: Array<{ hit: (typeof response.results)[number]; linkedin?: string }> = [];
				for (const hit of response.results) {
					if (hits.length >= target - state.added) break;
					const linkedin = hit.profiles.find((url) => url.includes('linkedin.com')) ?? hit.profiles[0];
					const key = foundRowKey(linkedin);
					if (!key || seen.has(key)) continue;
					seen.add(key);
					hits.push({ hit, linkedin });
				}
				const photo = async (hit: (typeof response.results)[number]) => {
					if (!tableType.chaining.enabled || !tableType.chaining.operations.includes('people.enrich')) return null;
					const profiles = hit.profiles.flatMap((url) => { const safe = profileUrl(url); return safe ? [safe] : []; });
					if (!profiles.length) return null;
					try {
						const enriched = await lookupPerson(client, { social_urls: profiles, timeoutOpts: { milliseconds: 60_000, behavior: 'return-partial' } }, hit.name ?? '', { signal });
						return enriched.match.status === 'candidate' ? profileUrl(enriched.match.person?.avatar_url) : null;
					} catch { signal.throwIfAborted(); return null; /* Keep the search result if photo enrichment is unavailable. */ }
				};
				const rows: FoundRow[] = await mapConcurrent(hits, PHOTO_CONCURRENCY, async ({ hit, linkedin }) => ({
					Name: hit.name,
					'Profile photo': await photo(hit),
					Title: hit.role.title,
					Company: hit.role.company?.name ?? null,
					'Company domain': hit.role.company?.domain ?? null,
					Location: [hit.location.city, hit.location.region, hit.location.country_code].filter(Boolean).join(', ') || null,
					LinkedIn: linkedin ?? null,
					Schools: hit.schools,
					Skills: hit.skills.slice(0, 15),
					'Years of experience': hit.years_of_experience,
					Summary: hit.description,
				}));
				const accepted = await push(rows);
				return summarise(accepted.length, accepted.map((row) => String(row.Name ?? '')), response.next_cursor ?? null, response.results.length);
			}),
		});
	}
	if (request.entity === 'websites') {
		tools.searchWeb = tool({
			description: 'Search the web. Each result page becomes a row (URL, title, description). Vary the query to find more.',
			inputSchema: z.object({ query: z.string().max(400), numResults: z.number().int().min(1).max(50).default(20), includeDomains: z.array(z.string()).max(20).optional(), excludeDomains: z.array(z.string()).max(20).optional() }),
			execute: async ({ query, numResults, includeDomains }) => searchInOrder(async () => {
				if (callsExhausted()) return { error: 'The configured search-call limit has been reached.' };
				if (state.added >= target) return summarise(0, [], null, 0);
				const result = await webSearchCountries(client, query, countries, { numResults: Math.min(numResults, target - state.added), includeDomains }, signal);
				const rows: FoundRow[] = [];
				for (const hit of result.results) {
					const key = foundRowKey(hit.url);
					if (!key || seen.has(key)) continue;
					seen.add(key);
					rows.push({ URL: hit.url, Title: hit.title, Description: hit.description });
				}
				const accepted = await push(rows);
				return summarise(accepted.length, accepted.map((row) => String(row.Title ?? '')), null, result.results.length);
			}),
		});
	}

	const reachedTarget: StopCondition<ToolSet> = () => state.added >= target;
	const stalled: StopCondition<ToolSet> = () => state.emptyStreak >= 4;
	const maxCallsReached: StopCondition<ToolSet> = () => callsExhausted();

	await emit({ type: 'status', message: `Searching for ${request.entity}…` });
	const entityGuide = {
		companies: 'Write queries the way a market analyst would describe the segment (industry + geography + size + business model). To reach large targets, split the market into sub-segments (sub-industries, states or regions, company sizes, customer types) and run each as its own query; always follow next_cursor until it is null before moving on.',
		people: 'Describe the role, seniority, employer type, industry, location and background. Split large targets by geography, seniority, or employer segment. Use fast mode unless the query has several hard criteria.',
		websites: 'Use many distinct search phrasings, site: operators for directories, and synonyms. Each query returns at most 50 results, so vary queries to reach the target.',
	}[request.entity];
	const result = await generateText({
		model,
		system: [
			`You populate a spreadsheet with ${request.entity}. Goal: find up to ${target} ${request.entity} matching the request. The search tool adds matches to the sheet by itself; you only plan and run queries.`,
			entityGuide,
			`Table-type interpretation guidance (admin-editable text; this does not change the available operations, validation, result mapping, or safety limits):\n${tableType.instructions}`,
			`Keep the selected table type's result fields and stable identity intact. The only enabled operations are: ${tableType.operations.join(', ')}. Never invent an operation or alter endpoint selection. Stop after ${maxCalls} Monid search calls.`,
			`Rules: keep calling tools until total_added reaches the target, next_cursor is null for every reasonable query, or four consecutive calls add nothing. Do not repeat a query that returned nothing new. Do not write out the results; when finished, reply with one short sentence summarising what you found.`,
			countries ? (request.entity === 'websites' ? `Web searches are localized to ${countries.join(', ')}; localization is not a strict website headquarters filter.` : `Hard filter already applied: headquarters/location in ${countries.join(', ')}.`) : '',
		]
				.filter(Boolean)
			.join('\n'),
		prompt: `Request: ${request.query}${companyContext}\nTarget: ${target} ${request.entity}.${seen.size ? ` The sheet already has ${seen.size} rows; duplicates are skipped automatically.` : ''}`,
		tools,
		stopWhen: [isStepCount(MAX_STEPS), reachedTarget, stalled, maxCallsReached],
		// Each step is billed once processed; the transport resends a rate-limited request (see `openaiModel`).
		maxRetries: 0,
		abortSignal: signal,
	});
	const summary = result.text?.trim();
	await emit({ type: 'done', total: state.added, message: summary && summary.length < 400 ? summary : undefined });
}

/** Direct Monid discovery keeps natural-language row search available when the user has not connected OpenAI. */
async function populateDirectMonid(access: ProviderAccess, request: PopulateRequest & { tableType: TableTypeDefinition }, emit: (event: PopulateEvent) => void, signal: AbortSignal) {
	const client = access.context();
	const target = request.target;
	const query = normalizeDiscoveryQuery(request.query);
	const countries = request.countries?.length ? request.countries.map((country) => country.toUpperCase()) : undefined;
	const seen = new Set((request.existingKeys ?? []).map(foundRowKey).filter(Boolean));
	let added = 0, cursor: string | undefined, calls = 0;
	let runCursor = access.spend.monidRuns.length;
	await emit({ type: 'status', message: `Searching Monid for ${request.entity}…` });
	const maxCalls = Math.min(request.tableType.pagination.maxCalls, 20);
	while (added < target && calls < maxCalls) {
		signal.throwIfAborted();
		calls++;
		let rows: FoundRow[] = [], nextCursor: string | null = null;
		if (request.entity === 'companies') {
			const result = await companySearch(client, { query, filters: { countries }, cursor });
			nextCursor = result.next_cursor;
			rows = result.results.map(companyRow);
		} else if (request.entity === 'people') {
			const response = await client.people.search({ query, mode: query.length > 500 ? 'ultra' : 'fast', filters: { countries }, cursor }, { signal });
			nextCursor = response.next_cursor ?? null;
			rows = response.results.map((entry: unknown) => {
				const hit = objectValue(entry), role = objectValue(hit.role), company = objectValue(role.company), location = objectValue(hit.location);
				const profiles = stringList(hit.profiles);
				return {
					Name: textValue(hit.name),
					Title: textValue(role.title),
					Company: textValue(company.name),
					'Company domain': textValue(company.domain),
					Location: [location.city, location.region, location.country_code].filter((part): part is string => typeof part === 'string' && Boolean(part)).join(', ') || null,
					LinkedIn: profiles.find((url) => url.includes('linkedin.com')) ?? profiles[0] ?? null,
					Schools: stringList(hit.schools), Skills: stringList(hit.skills).slice(0, 15),
					'Years of experience': cellValue(hit.years_of_experience), Summary: textValue(hit.description),
				};
			});
		} else {
			const result = await webSearchCountries(client, query.slice(0, 500), countries, { numResults: Math.min(50, target - added) }, signal);
			rows = result.results.map((hit) => ({ URL: hit.url, Title: hit.title, Description: hit.description }));
		}
		const keyField = foundRowKeyField(request.entity, request.tableType);
		const unique = rows.filter((row) => { const key = foundRowKey(row[keyField]); if (!key || seen.has(key)) return false; seen.add(key); return true; }).slice(0, target - added);
		if (unique.length) {
			added += unique.length;
			const monidRuns = access.spend.monidRuns.slice(runCursor);
			runCursor = access.spend.monidRuns.length;
			await emit({ type: 'rows', rows: unique, key: foundRowKeyField(request.entity), meta: monidRuns.length ? { monidRuns } : undefined });
		}
		await emit({ type: 'status', message: `Added ${added} of ${target}` });
		if (request.entity === 'websites' || !nextCursor || unique.length === 0) break;
		cursor = nextCursor;
	}
	await emit({ type: 'done', total: added, message: added ? `Found ${added} ${request.entity} with Monid.` : 'No results found. Try a more specific query.' });
}

const DISCOVERY_LEAD = /^(?:please\s+)?(?:find|search(?:\s+for)?|look\s+for|show(?:\s+me)?|give(?:\s+me)?|return|list|get|discover)(?:\s+me)?\s+/i;
const DISCOVERY_COUNT = /^(?:(?:up\s+to|the|top|first|exactly|around|about|roughly|some)\s+)*\d[\d,]*\+?\s+/i;
const OUTPUT_REQUEST = /\b(?:i\s+need|i\s+want|please\s+include|include|provide|return|give\s+me)\s+(?:(?:their|the)\s+)?(?:linkedin\s+(?:urls?|profiles?|links?)|profile\s+(?:urls?|links?)|emails?(?:\s+addresses?)?|phone\s+numbers?|contact\s+(?:details?|information))\b/gi;

/** Monid accepts a plain search description; strip request counts and output-only instructions without dropping criteria. */
export function normalizeDiscoveryQuery(description: string) {
	const stripped = description.trim().replace(DISCOVERY_LEAD, '').replace(DISCOVERY_COUNT, '').replace(OUTPUT_REQUEST, ' ');
	const clauses = stripped.split(/(?<=[.!?])\s+/).map((part) => part.replace(/[.!?]+$/g, '').trim()).filter(Boolean);
	const query = clauses.map((part, index) => index ? part[0]!.toLowerCase() + part.slice(1) : part).join(' ').replace(/\s+/g, ' ').trim();
	return query || description.trim();
}

function companyRow(hit: Awaited<ReturnType<typeof companySearch>>['results'][number]): FoundRow {
	const hq = [hit.headquarters?.city, hit.headquarters?.region, hit.headquarters?.country_code].filter(Boolean).join(', ');
	const employees: CellValue = hit.employees?.count ?? hit.employees?.max ?? hit.employees?.min ?? null;
	return {
		Company: hit.name,
		Domain: hit.domain,
		Description: hit.description ?? null,
		Industry: hit.industries?.length ? hit.industries.slice(0, 3).join(', ') : null,
		Headquarters: hq || null,
		Employees: employees,
		Founded: hit.founded_year ?? null,
		Funding: hit.funding?.total_usd ?? null,
		Stage: fundingLabel(hit.funding?.stage ?? hit.funding?.latest_round?.type),
	};
}
