import { lookupPerson } from './person-lookup';
import { createHash } from 'node:crypto';
import { profileUrl } from '../profile-photo';
import { planPeopleInput, populatePeopleList } from './populate-people-list';
import { companyContextForQuery } from './company-context';
import 'server-only';
import { populateLimitError, promptResultCount } from '../populate-limit';
import { fundingLabel } from '../funding';

import { generateText, isStepCount, type StopCondition, tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { foundRowKey, foundRowKeyField } from '../found-rows';
import type { CellMeta, CellValue, FoundRow, PopulateEvent, PopulateRequest } from '../types';
import { companySearch, webSearchCountries } from './context';
import type { ProviderAccess } from './provider-access';
import { createPopulateSearchQueue } from './populate-search-queue';
import { mapConcurrent } from './map-concurrent';
import { classifyFailure } from './enrich-failure';
import { runTregEndpoint, TregCallError, tregOutput } from './treg';
import { isSocialProfileFor } from '../social-platform';

/* The populate agent: OpenAI plans and paginates Context.dev searches; results stream straight to the sheet.
   The model only sees compact summaries (counts, cursors, a few names), never the full records, so a 1,000-row
   list costs a few thousand tokens of orchestration rather than copying every record through the model. */

const MAX_STEPS = 60;
const TREG_LINKEDIN_PROFILE_ENDPOINT = 'anyapi.linkedin.user.profile.full';
const TREG_LINKEDIN_PROFILE_MAX_COST_USD = 0.0042;
const TREG_PERSON_DOMAIN_MAX_COST_USD = 0.03;
/** Profile photos are a per-row extra lookup; a few in flight keeps a page of results fast without bursting Context.dev. */
const PHOTO_CONCURRENCY = 4;
const objectValue = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const textValue = (value: unknown): string | null => typeof value === 'string' ? value : null;
const cellValue = (value: unknown): CellValue => typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null ? value : null;
const stringList = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
function textList(value: unknown, keys: readonly string[]): string[] {
	if (!Array.isArray(value)) return stringList(value);
	return value.flatMap((entry) => {
		if (typeof entry === 'string') return [entry];
		const record = objectValue(entry);
		const normalized = new Map(Object.entries(record).map(([key, child]) => [key.toLowerCase().replace(/[^a-z0-9]/g, ''), child]));
		for (const key of keys) {
			const child = normalized.get(key.toLowerCase().replace(/[^a-z0-9]/g, ''));
			const direct = textValue(child);
			if (direct) return [direct];
			const nested = objectValue(child);
			const name = textValue(nested.name ?? nested.school_name ?? nested.title);
			if (name) return [name];
		}
		return [];
	});
}

const profileKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');

function profileField(record: Record<string, unknown>, keys: readonly string[]): unknown {
	const normalized = new Map(Object.entries(record).map(([key, value]) => [profileKey(key), value]));
	for (const key of keys) {
		const value = normalized.get(profileKey(key));
		if (value !== undefined && value !== null && value !== '') return value;
	}
	return undefined;
}

function findProfileArray(root: unknown, names: readonly string[], depth = 0): unknown[] {
	if (depth > 8 || !root || typeof root !== 'object') return [];
	if (Array.isArray(root)) {
		for (const entry of root) { const found = findProfileArray(entry, names, depth + 1); if (found.length) return found; }
		return [];
	}
	const record = objectValue(root);
	for (const [key, value] of Object.entries(record)) if (names.some((name) => profileKey(name) === profileKey(key)) && Array.isArray(value)) return value;
	for (const value of Object.values(record)) { const found = findProfileArray(value, names, depth + 1); if (found.length) return found; }
	return [];
}

function findProfileRecord(root: unknown, depth = 0): Record<string, unknown> {
	if (depth > 8 || !root || typeof root !== 'object') return {};
	if (Array.isArray(root)) return findProfileRecord(root[0], depth + 1);
	const record = objectValue(root);
	if (['full_name', 'fullName', 'firstName', 'headline', 'about', 'education', 'experiences', 'skills', 'currentPosition'].some((key) => profileField(record, [key]) !== undefined)) return record;
	for (const value of Object.values(record)) {
		const found = findProfileRecord(value, depth + 1);
		if (Object.keys(found).length) return found;
	}
	return record;
}

function profileDateMonth(value: unknown): number | null {
	if (typeof value === 'number' && value >= 1900 && value <= 2200) return value * 12;
	if (typeof value === 'object' && value !== null) {
		const date = objectValue(value);
		const year = Number(date.year ?? date.y);
		const rawMonth = date.month ?? date.m ?? 1;
		const monthText = typeof rawMonth === 'string' ? rawMonth.toLowerCase().slice(0, 3) : '';
		const monthIndex = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(monthText);
		const month = Number.isFinite(Number(rawMonth)) ? Number(rawMonth) : monthIndex + 1;
		if (Number.isFinite(year) && year >= 1900 && year <= 2200) return year * 12 + Math.max(0, Math.min(11, month - 1));
		return null;
	}
	if (typeof value !== 'string') return null;
	const parsed = new Date(value);
	if (!Number.isNaN(parsed.getTime()) && /\d{4}/.test(value)) return parsed.getUTCFullYear() * 12 + parsed.getUTCMonth();
	const year = value.match(/\b(?:19|20|21)\d{2}\b/);
	if (!year) return null;
	const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
	const monthName = value.toLowerCase().match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/);
	const month = monthName ? months.findIndex((name) => name === monthName[1]!.slice(0, 3)) : 0;
	return Number(year[0]) * 12 + Math.max(0, month);
}

function approximateYearsOfExperience(positions: unknown[]): number | null {
	const now = new Date(), currentMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
	const ranges = positions.flatMap((value, index) => {
		const position = objectValue(value);
		const startValue = profileField(position, ['startDate', 'start_date', 'from', 'dateStart']);
		const endValue = profileField(position, ['endDate', 'end_date', 'to', 'dateEnd']);
		const range = profileField(position, ['dateRange', 'timePeriod', 'duration']);
		let start = profileDateMonth(startValue), end = profileDateMonth(endValue);
		if (typeof range === 'string') {
			const years = range.match(/(?:19|20|21)\d{2}/g) ?? [];
			if (start === null && years[0]) start = Number(years[0]) * 12;
			if (end === null && years[1]) end = Number(years[1]) * 12 + 11;
			if (end === null && /present|current|now/i.test(range)) end = currentMonth;
		}
		if (start === null) return [];
		if (end === null && (index === 0 || profileField(position, ['current', 'isCurrent', 'is_current']) === true)) end = currentMonth;
		return end !== null && end >= start ? [{ start, end }] : [];
	});
	if (!ranges.length) return null;
	ranges.sort((a, b) => a.start - b.start);
	let months = 0, start = ranges[0]!.start, end = ranges[0]!.end;
	for (const range of ranges.slice(1)) {
		if (range.start <= end + 1) end = Math.max(end, range.end);
		else { months += end - start + 1; start = range.start; end = range.end; }
	}
	months += end - start + 1;
	return Math.round(months / 12 * 10) / 10;
}

function enrichFoundPerson(row: FoundRow, data: unknown): { row: FoundRow; hasDetails: boolean; derivedYears: boolean } {
	const root = tregOutput(data);
	const profile = findProfileRecord(root);
	const education = findProfileArray(profile, ['education', 'educations', 'educationHistory', 'schools']);
	const skills = findProfileArray(profile, ['skills', 'skillSet']);
	const experience = findProfileArray(profile, ['experience', 'experiences', 'workExperience', 'work_experience', 'positions', 'positionHistory']);
	const currentRole = objectValue(profileField(profile, ['currentPosition', 'current_position', 'currentRole', 'current_role']));
	const company = objectValue(profileField(profile, ['currentCompany', 'current_company', 'company']) ?? profileField(currentRole, ['company', 'organization']));
	const schoolNames = textList(education, ['schoolName', 'school_name', 'school', 'institution', 'college', 'universityName', 'institutionName', 'name']);
	const skillNames = textList(skills, ['name', 'localizedName', 'skill', 'label', 'value', 'title']).slice(0, 50);
	const profileName = textValue(profileField(profile, ['fullName', 'full_name', 'name'])) ?? ([textValue(profileField(profile, ['firstName', 'first_name'])), textValue(profileField(profile, ['lastName', 'last_name']))].filter(Boolean).join(' ') || null);
	const about = textValue(profileField(profile, ['about', 'summary', 'description']));
	const yearsRaw = profileField(profile, ['yearsOfExperience', 'years_of_experience']);
	const explicitYears = Number(yearsRaw);
	const hasExplicitYears = yearsRaw !== undefined && Number.isFinite(explicitYears) && explicitYears >= 0;
	const years = hasExplicitYears ? explicitYears : approximateYearsOfExperience(experience);
	const locationValue = profileField(profile, ['location', 'locationName']);
	const profileLocation = textValue(locationValue) ?? ([objectValue(locationValue).city, objectValue(locationValue).region, objectValue(locationValue).country, objectValue(locationValue).name].filter((part): part is string => typeof part === 'string' && Boolean(part)).join(', ') || null);
	const derivedYears = !hasExplicitYears && years !== null;
	const merged: FoundRow = {
		...row,
		Name: profileName ?? row.Name ?? null,
		Title: textValue(profileField(profile, ['headline', 'title', 'jobTitle'])) ?? textValue(profileField(currentRole, ['title', 'jobTitle'])) ?? row.Title ?? null,
		Company: textValue(typeof profileField(profile, ['company', 'currentCompany', 'current_company']) === 'string' ? profileField(profile, ['company', 'currentCompany', 'current_company']) : undefined) ?? textValue(profileField(company, ['name', 'companyName', 'company_name'])) ?? row.Company ?? null,
		'Company domain': textValue(profileField(profile, ['companyDomain', 'company_domain', 'companyWebsite', 'company_website'])) ?? textValue(profileField(company, ['domain', 'website', 'url'])) ?? row['Company domain'] ?? null,
		Location: profileLocation ?? row.Location ?? null,
		LinkedIn: normalizedLinkedInUrl(profileField(profile, ['linkedinUrl', 'linkedin_url', 'profileUrl'])) ?? row.LinkedIn ?? null,
		Schools: schoolNames.length ? schoolNames : row.Schools ?? [],
		Skills: skillNames.length ? skillNames : row.Skills ?? [],
		'Years of experience': years ?? row['Years of experience'] ?? null,
		Summary: about ?? row.Summary ?? null,
	};
	const hasDetails = schoolNames.length + skillNames.length > 0 || Boolean(about) || experience.length > 0 || years !== null;
	return { row: merged, hasDetails, derivedYears };
}

function mergeTregProfileMeta(search: CellMeta, profile: CellMeta, reasoning?: string): CellMeta {
	const runs = [...(search.tregRuns ?? []), ...(profile.tregRuns ?? [])];
	const sources = [...new Set([...(search.sources ?? []), ...(profile.sources ?? [])])];
	return {
		...search,
		...profile,
		dataProvider: 'treg',
		tregRuns: runs,
		tregCostUsd: (search.tregCostUsd ?? 0) + (profile.tregCostUsd ?? 0),
		sources,
		raw: undefined,
		...(reasoning ? { reasoning } : {}),
	};
}

function tregPeopleSearchInput(query: string) {
	const roleAtCompany = query.match(/^(.+?)\s+at\s+(.+)$/i);
	if (!roleAtCompany) return { q: query };
	const title = roleAtCompany[1]!.trim().replace(/^heads of\b/i, 'Head of').replace(/^founders\b/i, 'Founder').replace(/^executives\b/i, 'Executive');
	const keyword = roleAtCompany[2]!.replace(/\b(?:companies|company|businesses|business)\b/gi, ' ').replace(/\bb2b\b/gi, 'B2B').replace(/\s+/g, ' ').trim();
	return title ? { title, ...(keyword ? { keywords: [keyword] } : {}) } : { q: query };
}

function normalizedLinkedInUrl(value: unknown, handle = false): string | null {
	if (typeof value !== 'string' || !value.trim()) return null;
	let candidate = value.trim();
	if (/^(?:www\.)?linkedin\.com\//i.test(candidate)) candidate = `https://${candidate}`;
	else if (handle && !/^https?:\/\//i.test(candidate)) candidate = `https://www.linkedin.com/in/${candidate.replace(/^@/, '')}`;
	return isSocialProfileFor(candidate, 'linkedin') ? candidate : null;
}

function tregPersonLinkedIn(person: Record<string, unknown>): string | null {
	for (const key of ['linkedin_url', 'linkedin_profile_url', 'linkedin', 'linkedin_handle', 'profile_url', 'profileUrl']) {
		const link = normalizedLinkedInUrl(person[key], key === 'linkedin_handle' || key === 'linkedin');
		if (link) return link;
	}
	const visit = (value: unknown, hint = false, depth = 0): string | null => {
		if (depth > 5 || value === null || value === undefined) return null;
		if (typeof value === 'string') return normalizedLinkedInUrl(value, hint);
		if (Array.isArray(value)) { for (const entry of value) { const found = visit(entry, hint, depth + 1); if (found) return found; } return null; }
		if (typeof value !== 'object') return null;
		const record = objectValue(value);
		const platform = String(record.platform ?? record.type ?? record.network ?? record.name ?? '').toLowerCase();
		const isLinkedIn = hint || platform.includes('linkedin');
		for (const [key, child] of Object.entries(record)) {
			if (/linkedin/i.test(key)) { const found = visit(child, true, depth + 1); if (found) return found; }
		}
		for (const key of ['url', 'profile_url', 'profileUrl', 'link', 'href']) {
			const found = normalizedLinkedInUrl(record[key], isLinkedIn && /handle/i.test(key));
			if (found) return found;
		}
		for (const child of Object.values(record)) { const found = visit(child, isLinkedIn, depth + 1); if (found) return found; }
		return null;
	};
	for (const key of ['linkedin', 'linkedin_profile', 'profiles', 'social_profiles', 'socialProfiles', 'social_links', 'socialLinks', 'socials', 'social_urls', 'links', 'profile', 'social']) {
		const found = visit(person[key], key === 'linkedin_profile');
		if (found) return found;
	}
	return null;
}

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

async function runPopulate(access: ProviderAccess, request: PopulateRequest, emit: (event: PopulateEvent) => void, signal: AbortSignal) {
	const requestedTarget = promptResultCount(request.query) ?? request.target;
	const limitError = populateLimitError(requestedTarget);
	if (limitError) throw new Error(limitError);
	request = { ...request, target: Math.min(requestedTarget, request.availableRows ?? 1000) };
	if (request.dataProvider === 'treg') {
		if (!access.key('treg')) throw new Error('Connect Treg in Configuration to find rows.');
		await populateDirectTreg(access, request, emit, signal);
		return;
	}
	if (!access.key('openai')) {
		if (!access.key('monid')) throw new Error('Connect Monid to find rows.');
		await populateDirectMonid(access, request, emit, signal);
		return;
	}
	const model = access.openai();
	if (request.entity === 'people') {
		emit({ type: 'status', message: 'Checking for a supplied list of people…' });
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

	let runCursor = access.spend.monidRuns.length;
	const nextRunMeta = () => {
		const monidRuns = access.spend.monidRuns.slice(runCursor);
		runCursor = access.spend.monidRuns.length;
		return monidRuns.length ? { monidRuns } : undefined;
	};
	const push = (rows: FoundRow[]) => {
		const accepted = rows.slice(0, Math.max(0, target - state.added));
		if (accepted.length) {
			state.added += accepted.length;
			emit({ type: 'rows', rows: accepted, key: foundRowKeyField(request.entity), meta: nextRunMeta() });
		}
		return accepted;
	};
	const summarise = (added: number, names: string[], nextCursor: string | null, total: number) => {
		state.calls += 1;
		state.emptyStreak = added === 0 ? state.emptyStreak + 1 : 0;
		emit({ type: 'status', message: added ? `Added ${added} (${state.added} of ${target})` : `No new results (${state.added} of ${target})` });
		return { added_this_call: added, returned_this_call: total, total_added: state.added, target, remaining: Math.max(0, target - state.added), next_cursor: nextCursor, sample: names.slice(0, 5), hint: nextCursor ? 'Call again with next_cursor to continue this query.' : 'This query is exhausted; try a different angle.' };
	};

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
				if (state.added >= target) return summarise(0, [], null, 0);
				const result = await companySearch(client, { query, filters: { countries, employees_min, employees_max }, cursor });
				const rows: FoundRow[] = [];
				for (const hit of result.results) {
					const key = foundRowKey(hit.domain || hit.name);
					if (!key || seen.has(key)) continue;
					seen.add(key);
					rows.push(companyRow(hit));
				}
				const accepted = push(rows);
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
				if (state.added >= target) return summarise(0, [], null, 0);
				const response = await client.people.search({ query, mode, filters: { countries, years_of_experience_min, years_of_experience_max }, cursor }, { signal });
				const hits: Array<{ hit: (typeof response.results)[number]; linkedin?: string }> = [];
				for (const hit of response.results) {
					if (hits.length >= target - state.added) break;
					const linkedin = hit.profiles.find((url) => url.includes('linkedin.com')) ?? hit.profiles[0];
					const key = foundRowKey(linkedin || `${hit.name}|${hit.role.company?.name ?? ''}`);
					if (!key || seen.has(key)) continue;
					seen.add(key);
					hits.push({ hit, linkedin });
				}
				const photo = async (hit: (typeof response.results)[number]) => {
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
				const accepted = push(rows);
				return summarise(accepted.length, accepted.map((row) => String(row.Name ?? '')), response.next_cursor ?? null, response.results.length);
			}),
		});
	}
	if (request.entity === 'websites') {
		tools.searchWeb = tool({
			description: 'Search the web. Each result page becomes a row (URL, title, description). Vary the query to find more.',
			inputSchema: z.object({ query: z.string().max(400), numResults: z.number().int().min(1).max(50).default(20), includeDomains: z.array(z.string()).max(20).optional(), excludeDomains: z.array(z.string()).max(20).optional() }),
			execute: async ({ query, numResults, includeDomains }) => searchInOrder(async () => {
				if (state.added >= target) return summarise(0, [], null, 0);
				const result = await webSearchCountries(client, query, countries, { numResults: Math.min(numResults, target - state.added), includeDomains }, signal);
				const rows: FoundRow[] = [];
				for (const hit of result.results) {
					const key = foundRowKey(hit.url);
					if (!key || seen.has(key)) continue;
					seen.add(key);
					rows.push({ URL: hit.url, Title: hit.title, Description: hit.description });
				}
				const accepted = push(rows);
				return summarise(accepted.length, accepted.map((row) => String(row.Title ?? '')), null, result.results.length);
			}),
		});
	}

	const reachedTarget: StopCondition<ToolSet> = () => state.added >= target;
	const stalled: StopCondition<ToolSet> = () => state.emptyStreak >= 4;

	emit({ type: 'status', message: `Searching for ${request.entity}…` });
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
			`Rules: keep calling tools until total_added reaches the target, next_cursor is null for every reasonable query, or four consecutive calls add nothing. Do not repeat a query that returned nothing new. Do not write out the results; when finished, reply with one short sentence summarising what you found.`,
			countries ? (request.entity === 'websites' ? `Web searches are localized to ${countries.join(', ')}; localization is not a strict website headquarters filter.` : `Hard filter already applied: headquarters/location in ${countries.join(', ')}.`) : '',
		]
			.filter(Boolean)
			.join('\n'),
		prompt: `Request: ${request.query}${companyContext}\nTarget: ${target} ${request.entity}.${seen.size ? ` The sheet already has ${seen.size} rows; duplicates are skipped automatically.` : ''}`,
		tools,
		stopWhen: [isStepCount(MAX_STEPS), reachedTarget, stalled],
		// Each step is billed once processed; the transport resends a rate-limited request (see `openaiModel`).
		maxRetries: 0,
		abortSignal: signal,
	});
	const summary = result.text?.trim();
	emit({ type: 'done', total: state.added, message: summary && summary.length < 400 ? summary : undefined });
}

/** Direct catalog-routed discovery keeps Treg selection explicit and avoids hidden Monid calls. */
async function populateDirectTreg(access: ProviderAccess, request: PopulateRequest, emit: (event: PopulateEvent) => void, signal: AbortSignal) {
	const target = request.target;
	const query = normalizeDiscoveryQuery(request.query);
	const countries = request.countries?.length ? request.countries.map((country) => country.toUpperCase()) : [undefined];
	const existingKeys = new Set((request.existingKeys ?? []).map(foundRowKey).filter(Boolean));
	const seen = new Set(existingKeys);
	const refreshedExisting = new Set<string>();
	const canUpdateExisting = request.entity === 'people' && request.dataProvider === 'treg' && request.enrichFullProfiles === true;
	let added = 0, calls = 0, missingProfileUrls = 0, duplicateProfiles = 0;
	let profileRowsProcessed = 0, existingProfilesMatched = 0;
	let fullProfileCalls = 0, fullProfilesWithDetails = 0, fullProfileMisses = 0, fullProfileFailures = 0, fullProfileSkipped = 0;
	let companyDomainCalls = 0, companyDomainsFound = 0, companyDomainFailures = 0;
	let fullProfileBlocked = false;
	emit({ type: 'status', message: `Searching Treg for ${request.entity}…` });
	for (const country of countries) {
		let cursor: string | undefined;
		while ((canUpdateExisting ? profileRowsProcessed : added) < target && calls < 40) {
			signal.throwIfAborted();
			calls++;
			const endpoint = request.entity === 'companies' ? 'treg.companies.search' : request.entity === 'people' ? 'treg.people.search' : 'treg.web.search';
			const limit = Math.min(50, target - (canUpdateExisting ? profileRowsProcessed : added));
			const body = request.entity === 'companies'
				? { q: query, limit, ...(country ? { country } : {}), ...(cursor ? { cursor } : {}) }
				: request.entity === 'people'
					? { ...tregPeopleSearchInput(query), limit, ...(country ? { country } : {}), ...(cursor ? { cursor } : {}) }
					: { q: query.slice(0, 500), limit };
			const retryScope = request.idempotencyKey ?? JSON.stringify([access.account?.partition ?? 'anonymous', request.entity, query, target, request.existingKeys ?? []]);
			const idempotencyKey = createHash('sha256').update(`${retryScope}:${endpoint}:${country ?? ''}:${cursor ?? ''}`).digest('hex');
			const { data, meta } = await runTregEndpoint(access, {
				operation: endpoint,
				endpoint,
				method: 'POST',
				body,
				input: body,
				maxCostUsd: 1,
			}, { idempotencyKey, signal });
			const output = tregOutput(data);
			let rows: FoundRow[] = [];
			if (request.entity === 'companies') {
				const hits = Array.isArray(output.companies) ? output.companies : [];
				rows = hits.map((entry) => {
					const hit = objectValue(entry), location = objectValue(hit.location ?? hit.headquarters);
					const domain = textValue(hit.domain ?? hit.website ?? hit.url);
					const industry = hit.industries ?? hit.industry;
					const employeeCount = hit.employee_count ?? hit.employees ?? hit.employeeCount;
					const hq = textValue(hit.headquarters_location ?? hit.location_name) ?? ([location.city, location.region, location.country].filter((part): part is string => typeof part === 'string' && Boolean(part)).join(', ') || null);
					return {
						Company: textValue(hit.name ?? hit.company_name ?? hit.display_name),
						Domain: domain,
						Description: textValue(hit.description ?? hit.about),
						Industry: Array.isArray(industry) ? industry.filter((value): value is string => typeof value === 'string').slice(0, 3).join(', ') || null : textValue(industry),
						Headquarters: hq,
						Employees: cellValue(typeof employeeCount === 'object' && employeeCount !== null ? objectValue(employeeCount).count ?? objectValue(employeeCount).value : employeeCount),
						Founded: cellValue(hit.founded_year ?? hit.founded),
						Funding: cellValue(hit.funding_total ?? objectValue(hit.funding).total_usd),
						Stage: textValue(hit.funding_stage ?? objectValue(hit.funding).stage) ?? null,
					};
				});
			} else if (request.entity === 'people') {
				const data = objectValue(output.data);
				const candidateHits = [output.people, output.results, output.items, Array.isArray(output.data) ? output.data : undefined, data.people, data.results, data.items].find(Array.isArray);
				const hits = Array.isArray(candidateHits) ? candidateHits : [];
				rows = hits.map((entry) => {
					const hit = objectValue(entry), role = objectValue(hit.current_role ?? hit.currentRole ?? hit.role ?? hit.position);
					const companyValue = hit.company ?? hit.organization ?? role.company ?? role.organization;
					const company = objectValue(companyValue), location = objectValue(hit.location);
					const fullName = textValue(hit.full_name ?? hit.fullName ?? hit.name) ?? ([textValue(hit.first_name ?? hit.firstName), textValue(hit.last_name ?? hit.lastName)].filter(Boolean).join(' ') || null);
					const locationText = textValue(typeof hit.location === 'string' ? hit.location : hit.location_name) ?? ([location.city, location.region, location.country].filter((part): part is string => typeof part === 'string' && Boolean(part)).join(', ') || null);
					return {
						Name: fullName,
						'Profile photo': textValue(hit.avatar_url ?? hit.photo_url ?? hit.image_url),
						Title: textValue(hit.title ?? hit.current_title ?? role.title ?? hit.headline ?? (typeof hit.role === 'string' ? hit.role : null)),
						Company: textValue(typeof companyValue === 'string' ? companyValue : company.name ?? company.company_name ?? hit.company_name),
						'Company domain': textValue(hit.company_domain ?? hit.company_website ?? company.domain ?? company.website ?? company.url ?? role.company_domain),
						Location: locationText,
						LinkedIn: tregPersonLinkedIn(hit),
						Schools: textList(hit.schools ?? hit.education, ['school_name', 'school', 'institution', 'college', 'name']),
						Skills: textList(hit.skills, ['name', 'skill', 'label', 'value']).slice(0, 15),
						'Years of experience': cellValue(hit.years_of_experience),
						Summary: textValue(hit.description ?? hit.summary ?? hit.about),
					};
				});
			} else {
				const hits = Array.isArray(output.results) ? output.results : [];
				rows = hits.map((entry) => {
					const hit = objectValue(entry);
					return { URL: textValue(hit.url ?? hit.link), Title: textValue(hit.title), Description: textValue(hit.description ?? hit.snippet) };
				});
			}
			const keyField = foundRowKeyField(request.entity);
			let pageProfileRows = 0;
			const unique = rows.filter((row) => {
				const key = foundRowKey(row[keyField]);
				if (!key) { if (request.entity === 'people') missingProfileUrls++; return false; }
				if (existingKeys.has(key)) {
					if (canUpdateExisting && !refreshedExisting.has(key) && profileRowsProcessed + pageProfileRows < target) {
						refreshedExisting.add(key);
						existingProfilesMatched++;
						pageProfileRows++;
						return true;
					}
					if (request.entity === 'people') duplicateProfiles++;
					return false;
				}
				if (seen.has(key)) { if (request.entity === 'people') duplicateProfiles++; return false; }
				if (canUpdateExisting && profileRowsProcessed + pageProfileRows >= target) return false;
				seen.add(key);
				if (canUpdateExisting) pageProfileRows++;
				return true;
			}).slice(0, target - (canUpdateExisting ? profileRowsProcessed : added));
			if (canUpdateExisting) profileRowsProcessed += unique.length;
			if (unique.length && request.entity === 'people' && request.enrichFullProfiles) {
				const profileScope = retryScope;
				await mapConcurrent(unique, PHOTO_CONCURRENCY, async (row) => {
					const linkedinUrl = textValue(row.LinkedIn);
					let enrichedRow = row;
					let rowMeta: CellMeta = { ...meta, raw: undefined, dataProvider: 'treg' };
					if (linkedinUrl && !signal.aborted && !fullProfileBlocked) {
						fullProfileCalls++;
						try {
							const body = { url: linkedinUrl };
						const profileKey = createHash('sha256').update(`${profileScope}:${TREG_LINKEDIN_PROFILE_ENDPOINT}:${linkedinUrl}`).digest('hex');
						const profileResult = await runTregEndpoint(access, {
							operation: TREG_LINKEDIN_PROFILE_ENDPOINT,
							endpoint: TREG_LINKEDIN_PROFILE_ENDPOINT,
							method: 'POST',
							body,
							input: body,
							maxCostUsd: TREG_LINKEDIN_PROFILE_MAX_COST_USD,
						}, { idempotencyKey: profileKey, signal });
							const details = enrichFoundPerson(row, profileResult.data);
							enrichedRow = details.row;
							if (details.hasDetails) fullProfilesWithDetails++;
							else fullProfileMisses++;
							rowMeta = mergeTregProfileMeta(meta, profileResult.meta, details.derivedYears ? 'Years of experience is an estimate from the returned work-history dates.' : undefined);
							if (!textValue(enrichedRow['Company domain'])) {
								companyDomainCalls++;
								const domainInput = { linkedin_url: linkedinUrl, ...(textValue(enrichedRow.Name) ? { full_name: textValue(enrichedRow.Name)! } : {}) };
								const domainKey = createHash('sha256').update(`${profileScope}:treg.people.enrich:${linkedinUrl}`).digest('hex');
								try {
									const domainResult = await runTregEndpoint(access, {
										operation: 'treg.people.enrich', endpoint: 'treg.people.enrich', method: 'POST',
										body: domainInput, input: domainInput, maxCostUsd: TREG_PERSON_DOMAIN_MAX_COST_USD,
									}, { idempotencyKey: domainKey, signal });
									const domainProfile = findProfileRecord(tregOutput(domainResult.data));
									const companyDomain = textValue(profileField(domainProfile, ['company_domain', 'companyDomain', 'domain', 'website']));
									if (companyDomain) {
										enrichedRow = { ...enrichedRow, 'Company domain': companyDomain };
										companyDomainsFound++;
									}
									rowMeta = mergeTregProfileMeta(rowMeta, domainResult.meta);
								} catch (error) {
									companyDomainFailures++;
									if (error instanceof TregCallError && /insufficient (?:team )?balance|rejected this api key|quota/i.test(error.message)) fullProfileBlocked = true;
									const domainErrorMeta = error instanceof TregCallError ? error.meta : { dataProvider: 'treg' as const };
									rowMeta = mergeTregProfileMeta(rowMeta, domainErrorMeta, `Company website lookup did not complete: ${access.redact(error)}`);
								}
							}
						} catch (error) {
							fullProfileFailures++;
							if (error instanceof TregCallError && /insufficient (?:team )?balance|rejected this api key|quota/i.test(error.message)) fullProfileBlocked = true;
							const failureMeta = error instanceof TregCallError ? error.meta : { dataProvider: 'treg' as const };
							rowMeta = mergeTregProfileMeta(meta, failureMeta, `Full LinkedIn profile lookup did not complete: ${access.redact(error)}`);
						}
					} else if (linkedinUrl) {
						fullProfileSkipped++;
						rowMeta = { ...rowMeta, reasoning: fullProfileBlocked ? 'Treg profile lookups stopped after a balance or connection error.' : 'Full profile lookup was stopped before it began.' };
					}
					if (!existingKeys.has(foundRowKey(row[keyField]))) added++;
					emit({ type: 'rows', rows: [enrichedRow], key: keyField, meta: rowMeta, updateExisting: canUpdateExisting });
					emit({ type: 'status', message: `Added ${added} of ${target}${existingProfilesMatched ? ` · refreshing ${existingProfilesMatched} existing` : ''}${fullProfileCalls ? ` · full profiles ${fullProfileCalls} started` : ''}` });
				});
			} else if (unique.length) {
				added += unique.length;
				emit({ type: 'rows', rows: unique, key: keyField, meta: { ...meta, raw: undefined, dataProvider: 'treg' } });
			}
			emit({ type: 'status', message: `Added ${added} of ${target}` });
			const next = textValue(output.next_cursor ?? output.nextCursor) || null;
			if (request.entity === 'websites' || !next || unique.length === 0) break;
			cursor = next;
		}
		if (added >= target || request.entity === 'websites') break;
	}
	const entityLabel = request.entity === 'people' ? (added === 1 ? 'person' : 'people') : request.entity;
	const profileSummary = request.entity === 'people' && request.enrichFullProfiles && fullProfileCalls + fullProfileSkipped
		? ` Full profiles: ${fullProfilesWithDetails} returned details, ${fullProfileMisses} missed, ${fullProfileFailures} failed, ${fullProfileSkipped} skipped. Company websites found: ${companyDomainsFound}${companyDomainCalls ? ` of ${companyDomainCalls}` : ''}${companyDomainFailures ? `; ${companyDomainFailures} lookups failed` : ''}.`
		: '';
	const message = added || existingProfilesMatched
		? `Found ${added} new ${entityLabel}${existingProfilesMatched ? ` and refreshed ${existingProfilesMatched} existing ${request.entity === 'people' ? 'profiles' : entityLabel}` : ''} with Treg.${profileSummary}`
		: request.entity === 'people' && missingProfileUrls
			? `Treg returned people, but ${missingProfileUrls} result${missingProfileUrls === 1 ? '' : 's'} did not include a LinkedIn URL. Find rows needs a LinkedIn profile to identify and deduplicate people.`
			: request.entity === 'people' && duplicateProfiles
				? 'Treg found people, but their LinkedIn profiles are already in this sheet.'
				: 'Treg found no matches. Try a broader description or remove country filters.';
	emit({ type: 'done', total: added + existingProfilesMatched, message });
}

/** Direct Monid discovery keeps natural-language row search available when the user has not connected OpenAI. */
async function populateDirectMonid(access: ProviderAccess, request: PopulateRequest, emit: (event: PopulateEvent) => void, signal: AbortSignal) {
	const client = access.context();
	const target = request.target;
	const query = normalizeDiscoveryQuery(request.query);
	const countries = request.countries?.length ? request.countries.map((country) => country.toUpperCase()) : undefined;
	const seen = new Set((request.existingKeys ?? []).map(foundRowKey).filter(Boolean));
	let added = 0, cursor: string | undefined, calls = 0;
	let runCursor = access.spend.monidRuns.length;
	emit({ type: 'status', message: `Searching Monid for ${request.entity}…` });
	while (added < target && calls < 20) {
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
		const keyField = foundRowKeyField(request.entity);
		const unique = rows.filter((row) => { const key = foundRowKey(row[keyField]); if (!key || seen.has(key)) return false; seen.add(key); return true; }).slice(0, target - added);
		if (unique.length) {
			added += unique.length;
			const monidRuns = access.spend.monidRuns.slice(runCursor);
			runCursor = access.spend.monidRuns.length;
			emit({ type: 'rows', rows: unique, key: foundRowKeyField(request.entity), meta: monidRuns.length ? { monidRuns } : undefined });
		}
		emit({ type: 'status', message: `Added ${added} of ${target}` });
		if (request.entity === 'websites' || !nextCursor || unique.length === 0) break;
		cursor = nextCursor;
	}
	emit({ type: 'done', total: added, message: added ? `Found ${added} ${request.entity} with Monid.` : 'No results found. Try a more specific query.' });
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
