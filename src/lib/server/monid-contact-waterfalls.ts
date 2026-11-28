import 'server-only';

import { renderTemplate, toDomain, toUrl } from '../template';
import { isSocialProfileFor, type SocialPlatform, type SocialProvider } from '../social-platform';
import type { CellMeta, CellValue, ColumnOp, EmailProvider, EnrichResponse, PhoneLookupProvider } from '../types';
import type { ProviderAccess } from './provider-access';
import { inputError } from './enrich-failure';
import { MonidError, runMonidOperation, runMonidWaterfall, type MonidRun } from './monid';

type Obj = Record<string, unknown>;
type ContactIdentity = { name: string; company: string; domain: string; profileUrl: string; email: string };
const obj = (value: unknown): Obj => value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
const str = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const emailValue = (value: unknown): string | null => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !/[*•]/.test(value) ? value : null;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

function identityFrom(op: { name: string; company: string; domain: string; profileUrl: string; email?: string }, row: Record<string, CellValue>): ContactIdentity {
	const input = (value: string) => renderTemplate(value, row).trim();
	return { name: input(op.name), company: input(op.company), domain: toDomain(input(op.domain)), profileUrl: toUrl(input(op.profileUrl)) ?? '', email: input(op.email ?? '') };
}

function nestedObjects(value: unknown, depth = 0, result: Obj[] = []): Obj[] {
	if (depth > 7 || result.length > 250) return result;
	if (Array.isArray(value)) { for (const child of value) nestedObjects(child, depth + 1, result); return result; }
	if (!value || typeof value !== 'object') return result;
	const record = value as Obj;
	result.push(record);
	for (const child of Object.values(record)) nestedObjects(child, depth + 1, result);
	return result;
}

function firstString(root: unknown, keys: readonly string[]): string {
	for (const record of nestedObjects(root)) for (const key of keys) {
		const value = str(record[key]);
		if (value) return value;
	}
	return '';
}

function sourceUrls(root: unknown): string[] {
	const urls = new Set<string>();
	for (const record of nestedObjects(root)) {
		for (const key of ['sources', 'source_urls', 'sourceUrls', 'citations']) {
			for (const value of list(record[key])) {
				const url = typeof value === 'string' ? value : str(obj(value).url ?? obj(value).uri ?? obj(value).link);
				if (/^https?:\/\//i.test(url)) urls.add(url);
			}
		}
	}
	return [...urls];
}

function confidenceOf(root: unknown): number | undefined {
	for (const record of nestedObjects(root)) for (const key of ['confidence', 'score', 'matchScore', 'match_score']) {
		const parsed = typeof record[key] === 'number' ? record[key] as number : Number(record[key]);
		if (Number.isFinite(parsed)) return Math.max(0, Math.min(1, parsed > 1 ? parsed / 100 : parsed));
	}
	return undefined;
}

function emailCandidate(root: unknown) {
	const raw = firstString(root, ['email', 'workEmail', 'work_email', 'professional_email', 'address']);
	const address = emailValue(raw);
	const data = obj(obj(root).data ?? root);
	const status = firstString(root, ['verificationStatus', 'verification_status', 'email_status', 'emailVerificationStatus']) || str(obj(data.verification).status) || 'unknown';
	const verified = ['valid', 'verified', 'good'].includes(status.toLowerCase()) || Boolean(firstString(root, ['emailVerifiedUtc', 'email_verified_utc']));
	return { email: address, status, verified, confidence: confidenceOf(root), sources: sourceUrls(root) };
}

function providerTitle(provider: string) {
	return ({ quickenrich: 'QuickEnrich', hunter: 'Hunter', apollo: 'Apollo', prospeo: 'Prospeo', contactout: 'ContactOut', leadmagic: 'LeadMagic', clay: 'Clay', ai_ark: 'AI Ark', reversecontact: 'Reverse Contact' } as Record<string, string>)[provider] ?? provider;
}

function emailRequest(provider: Exclude<EmailProvider, 'monid'>, identity: ContactIdentity) {
	const parts = identity.name.split(/\s+/).filter(Boolean);
	const fullName = identity.name;
	const linkedinHandle = identity.profileUrl.match(/linkedin\.com\/(?:in|pub)\/([^/?#]+)/i)?.[1];
	switch (provider) {
		case 'quickenrich':
			if (identity.profileUrl) return { operation: 'email.quickenrich' as const, input: { body: { linkedinUrl: identity.profileUrl } } };
			if (parts.length < 2 || !identity.domain) return null;
			return { operation: 'email.quickenrich' as const, input: { body: { companyDomain: identity.domain, firstName: parts[0], lastName: parts.slice(1).join(' ') } } };
		case 'hunter':
			if (!identity.domain) return null;
			return { operation: 'email.hunter' as const, input: { queryParams: { domain: identity.domain, ...(fullName ? { full_name: fullName } : {}), ...(parts.length > 1 ? { first_name: parts[0], last_name: parts.slice(1).join(' ') } : {}), ...(linkedinHandle ? { linkedin_handle: linkedinHandle } : {}), max_duration: 10 } } };
		case 'apollo':
			if (!identity.domain && !identity.profileUrl) return null;
			return { operation: 'email.apollo' as const, input: { queryParams: { ...(fullName ? { name: fullName } : {}), ...(identity.domain ? { domain: identity.domain } : {}), ...(identity.profileUrl ? { linkedin_url: identity.profileUrl } : {}) } } };
		case 'prospeo':
			if (!identity.profileUrl && (!fullName || !identity.domain)) return null;
			return { operation: 'email.prospeo' as const, input: { body: { ...(identity.profileUrl ? { linkedinUrl: identity.profileUrl } : { fullName, companyWebsite: identity.domain }), onlyVerifiedEmail: true } } };
		case 'contactout':
			if (!identity.profileUrl || !/linkedin\.com\/(?:in|pub)\//i.test(identity.profileUrl)) return null;
			return { operation: 'email.contactout' as const, input: { queryParams: { profile: identity.profileUrl, email_type: 'work' as const } } };
	}
}

function monidRuns(access: ProviderAccess): NonNullable<CellMeta['monidRuns']> {
	return access.spend.monidRuns.map((run) => ({ ...run }));
}

function sumRunCosts(access: ProviderAccess) {
	return access.spend.monidRuns.reduce((total, run) => total + (run.costUsd ?? 0), 0);
}

function runFromError(error: unknown): MonidRun | undefined {
	if (!(error instanceof MonidError)) return undefined;
	const detail = obj(error.detail);
	return typeof detail.runId === 'string' ? detail as MonidRun : undefined;
}

/** Runs email lookup providers through Monid, stopping only when a completed route finds an address. */
export async function runMonidEmailWaterfall(access: ProviderAccess, op: Extract<ColumnOp, { kind: 'email-enrichment' }>, row: Record<string, CellValue>): Promise<EnrichResponse> {
	const identity = identityFrom(op, row);
	if (!identity.name || !identity.domain) throw inputError('Provide a person name and company domain for this row.', 'monid');
	if (identity.profileUrl && (!/^https:\/\//i.test(identity.profileUrl) || !/linkedin\.com\/(?:in|pub)\//i.test(identity.profileUrl))) throw inputError('Enter a valid LinkedIn profile URL.', 'monid');
	const providers = op.providers.map((provider) => provider === 'monid' ? 'hunter' : provider) as Array<Exclude<EmailProvider, 'monid'>>;
	const attempts: NonNullable<CellMeta['enrichment']>['attempts'] = [];
	let best: ReturnType<typeof emailCandidate> | null = null;
	let matchedProvider: EmailProvider = 'hunter';
	for (const provider of providers) {
		const request = emailRequest(provider, identity);
		if (!request) {
			attempts.push({ provider, source: 'monid-workspace', status: 'Skipped · missing provider inputs', costUsd: 0 });
			continue;
		}
		let run: MonidRun | undefined;
		try {
			run = await runMonidWaterfall(access.requireKey('monid'), request.operation, request.input, { spend: access.spend, actor: access.account, timeoutMs: 120_000 });
		} catch (error) {
			// ContactOut documents a 404 as a free, completed no-match. Do not treat any other error as a miss.
			if (provider !== 'contactout' || !(error instanceof MonidError) || error.status !== 404) throw error;
			run = runFromError(error);
		}
		const candidate = emailCandidate(run?.output);
		const cost = typeof run?.cost?.value === 'number' ? run.cost.value : 0;
		attempts.push({ provider, source: 'monid-workspace', status: candidate.email ? 'Found' : 'No email found', costUsd: cost });
		best = candidate;
		if (candidate.email) { matchedProvider = provider; break; }
	}
	if (!attempts.some((attempt) => !attempt.status.startsWith('Skipped'))) throw inputError('Add a LinkedIn URL or the identifiers required by at least one selected email provider.', 'monid');
	const candidate = best ?? { email: null, status: 'not found', verified: false, confidence: undefined, sources: [] };
	const meta: CellMeta = {
		...(candidate.email ? { provider: matchedProvider } : {}),
		monidRuns: monidRuns(access),
		monidCostUsd: sumRunCosts(access),
		sources: candidate.sources,
		confidence: candidate.confidence,
		reasoning: candidate.email ? `${providerTitle(matchedProvider)} found a work email through Monid. Verification status: ${candidate.status}.` : 'No work email was returned by the selected Monid providers.',
		enrichment: { costUsd: sumRunCosts(access), attempts, verified: candidate.verified, verificationStatus: candidate.status },
	};
	return { value: candidate.email as CellValue, meta };
}

function phoneRequest(provider: PhoneLookupProvider, identity: ContactIdentity) {
	const parts = identity.name.split(/\s+/).filter(Boolean);
	switch (provider) {
		case 'leadmagic':
			if (!identity.profileUrl && !emailValue(identity.email)) return null;
			return { operation: 'phone.leadmagic' as const, input: { body: { ...(identity.profileUrl ? { profileUrl: identity.profileUrl } : {}), ...(emailValue(identity.email) ? { workEmail: identity.email } : {}) } } };
		case 'clay':
			if (!identity.profileUrl || !/linkedin\.com\/in\//i.test(identity.profileUrl) || !identity.name || !(identity.company || identity.domain)) return null;
			return { operation: 'phone.clay' as const, input: { body: { 'Social Profile URL': identity.profileUrl, 'Full Name': identity.name, 'Company Name': identity.company || identity.domain, ...(identity.domain ? { 'Company Domain': identity.domain } : {}), ...(emailValue(identity.email) ? { 'Work Email': identity.email } : {}) } } };
		case 'ai_ark':
			if (identity.profileUrl) return { operation: 'phone.aiArk' as const, input: { body: { linkedinUrl: identity.profileUrl } } };
			if (identity.domain && identity.name) return { operation: 'phone.aiArk' as const, input: { body: { domain: identity.domain, fullName: identity.name } } };
			return null;
		case 'reversecontact':
			if (identity.profileUrl) return { operation: 'phone.reverseContact' as const, input: { body: { url: identity.profileUrl, ...(identity.name ? { fullName: identity.name } : {}) } } };
			if (identity.domain && parts.length > 1) return { operation: 'phone.reverseContact' as const, input: { body: { fullName: identity.name, firstName: parts[0], lastName: parts.slice(1).join(' '), companyDomain: identity.domain } } };
			return null;
		case 'prospeo':
			if (identity.profileUrl) return { operation: 'phone.prospeo' as const, input: { body: { linkedinUrl: identity.profileUrl, enrichMobile: true } } };
			if (emailValue(identity.email)) return { operation: 'phone.prospeo' as const, input: { body: { email: identity.email, enrichMobile: true } } };
			if (identity.domain && identity.name) return { operation: 'phone.prospeo' as const, input: { body: { fullName: identity.name, companyWebsite: identity.domain, enrichMobile: true } } };
			return null;
	}
}

function phoneCandidate(root: unknown) {
	const keys = ['mobile', 'mobilePhone', 'mobile_phone', 'phone', 'phoneNumber', 'phone_number', 'Mobile Phone', 'directPhone'];
	for (const record of nestedObjects(root)) for (const key of keys) {
		const raw = record[key];
		if (typeof raw === 'string' && raw.trim()) return raw.trim();
		if (Array.isArray(raw)) {
			const first = raw.map((item) => typeof item === 'string' ? item : str(obj(item).number ?? obj(item).value ?? obj(item).phone)).find(Boolean);
			if (first) return first;
		}
		const nested = str(obj(raw).number ?? obj(raw).value);
		if (nested) return nested;
	}
	return null;
}

/** Monid phone waterfall: failed/uncertain routes stop; only a completed no-number result advances. */
export async function runMonidPhoneWaterfall(access: ProviderAccess, op: Extract<ColumnOp, { kind: 'phone-enrichment' }>, row: Record<string, CellValue>): Promise<EnrichResponse> {
	const identity = identityFrom(op, row);
	const reasons: string[] = [];
	for (const provider of op.providers) {
		const request = phoneRequest(provider, identity);
		if (!request) { reasons.push(`${providerTitle(provider)} skipped · missing required inputs`); continue; }
		const timeoutMs = provider === 'clay' ? 210_000 : 120_000;
		const run = await runMonidWaterfall(access.requireKey('monid'), request.operation, request.input, { spend: access.spend, actor: access.account, timeoutMs });
		const phone = phoneCandidate(run.output);
		if (phone) return { value: phone, meta: { monidRuns: monidRuns(access), monidCostUsd: sumRunCosts(access), sources: [...new Set([...sourceUrls(run.output), ...(identity.profileUrl ? [identity.profileUrl] : [])])], confidence: confidenceOf(run.output), reasoning: `${providerTitle(provider)} returned a phone number through Monid.${reasons.length ? ` ${reasons.join('; ')}.` : ''}` } };
		reasons.push(`${providerTitle(provider)} completed without a phone number`);
	}
	if (!access.spend.monidRuns.length && reasons.every((reason) => reason.includes('skipped'))) throw inputError('Add a LinkedIn profile, work email, or a person name and company domain accepted by a selected phone provider.', 'monid');
	return { value: null, meta: { monidRuns: monidRuns(access), monidCostUsd: sumRunCosts(access), sources: identity.profileUrl ? [identity.profileUrl] : [], reasoning: `No phone number was returned. ${reasons.join('; ')}.` } };
}

function socialQuery(identity: ContactIdentity) {
	return [identity.name, identity.company || identity.domain].filter(Boolean).join(' ').slice(0, 400);
}

function socialHost(platform: SocialPlatform) {
	return ({ linkedin: 'linkedin.com', instagram: 'instagram.com', facebook: 'facebook.com', x: 'x.com', tiktok: 'tiktok.com', youtube: 'youtube.com' } as const)[platform];
}

function canonicalSocialUrl(raw: string, platform: SocialPlatform): string {
	const url = raw.trim();
	if (/^https?:\/\//i.test(url)) return url;
	if (platform === 'youtube' && url.startsWith('/')) return `https://www.youtube.com${url}`;
	const handle = url.replace(/^@/, '').replace(/^\//, '');
	if (!handle || /\s/.test(handle)) return '';
	const base = ({ linkedin: 'https://www.linkedin.com/in/', instagram: 'https://www.instagram.com/', facebook: 'https://www.facebook.com/', x: 'https://x.com/', tiktok: 'https://www.tiktok.com/@', youtube: 'https://www.youtube.com/@' } as const)[platform];
	return `${base}${handle}${platform === 'instagram' ? '/' : ''}`;
}

function profileUrl(record: Obj, platform: SocialPlatform) {
	const keys = ['profileUrl', 'profile_url', 'linkedinUrl', 'linkedin_url', 'channel_url', 'canonical_url', 'externalUrl', 'external_url', 'url', 'link', 'href'];
	for (const key of keys) {
		const value = str(record[key]);
		if (value) {
			const candidate = canonicalSocialUrl(value, platform);
			if (isSocialProfileFor(candidate, platform)) return candidate;
		}
	}
	const handle = firstString(record, ['username', 'userName', 'handle', 'vanityName', 'publicIdentifier', 'channelHandle']);
	return handle ? canonicalSocialUrl(handle, platform) : '';
}

function socialUrls(record: Obj, platform: SocialPlatform): string[] {
	const urls = new Set<string>();
	const add = (value: unknown) => {
		if (typeof value === 'string') {
			const candidate = canonicalSocialUrl(value, platform);
			if (isSocialProfileFor(candidate, platform)) urls.add(candidate);
			return;
		}
		const entry = obj(value);
		const candidate = profileUrl(entry, platform);
		if (candidate) urls.add(candidate);
		for (const key of ['url', 'uri', 'link', 'profile_url', 'profileUrl', 'username', 'handle']) {
			const raw = str(entry[key]);
			if (!raw) continue;
			const normalized = canonicalSocialUrl(raw, platform);
			if (isSocialProfileFor(normalized, platform)) urls.add(normalized);
		}
	};
	for (const key of ['social_urls', 'socialUrls', 'social_profiles', 'socialProfiles']) {
		const value = record[key];
		if (Array.isArray(value)) value.forEach(add);
		else if (value && typeof value === 'object') {
			const mapped = obj(value);
			const aliases: Record<SocialPlatform, readonly string[]> = {
				linkedin: ['linkedin', 'linked_in'], instagram: ['instagram'], facebook: ['facebook'],
				x: ['x', 'twitter'], tiktok: ['tiktok'], youtube: ['youtube'],
			};
			for (const [network, entry] of Object.entries(mapped)) {
				if (aliases[platform].includes(network.toLowerCase())) add(entry);
			}
			add(value);
		}
	}
	return [...urls];
}

function normalizeName(value: string) { return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
function nameMatch(target: string, candidate: string) {
	const wanted = normalizeName(target).split(/\s+/).filter((part) => part.length > 1);
	const found = normalizeName(candidate);
	if (!wanted.length || !found) return 0;
	if (found.includes(wanted.join(' '))) return 0.98;
	const overlap = wanted.filter((part) => found.includes(part)).length / wanted.length;
	return overlap * (wanted.length === 1 ? 0.72 : 0.9);
}

function socialCandidate(root: unknown, platform: SocialPlatform, identity: ContactIdentity) {
	const keys = ['displayName', 'display_name', 'fullName', 'full_name', 'name', 'title', 'username', 'handle', 'channelTitle'];
	const candidates = nestedObjects(root).flatMap((record) => {
		const nestedName = obj(record.name);
		const name = keys.map((key) => str(record[key])).find(Boolean)
			|| str(nestedName.full)
			|| [str(nestedName.first), str(nestedName.last)].filter(Boolean).join(' ');
		const providerScore = confidenceOf(record) ?? confidenceOf(root);
		const score = nameMatch(identity.name, name);
		const urls = [profileUrl(record, platform), ...socialUrls(record, platform)].filter((url) => url && isSocialProfileFor(url, platform));
		return [...new Set(urls)].map((url) => ({ url, name, score, providerScore }));
	}).sort((a, b) => b.score - a.score);
	const winner = candidates.find((candidate) => candidate.score >= 0.55);
	return winner ? { ...winner, sources: [...new Set([winner.url, ...sourceUrls(root)])] } : null;
}

function socialRequest(provider: SocialProvider, platform: SocialPlatform, identity: ContactIdentity) {
	const query = socialQuery(identity);
	const parts = identity.name.split(/\s+/).filter(Boolean);
	if (!query) return null;
	if (provider === 'people_enrich' || provider === 'web_search') return { generic: provider } as const;
	switch (`${platform}:${provider}`) {
		case 'linkedin:apify':
			if (parts.length < 2) return null;
			return { operation: 'social.linkedin.apify' as const, input: { body: { profileScraperMode: 'Short' as const, firstName: parts[0], lastName: parts.slice(1).join(' '), strictSearch: true as const, maxPages: 1 as const, maxItems: 5 as const } } };
		case 'linkedin:ploid':
			return { operation: 'social.linkedin.ploid' as const, input: { body: { filters: { keywords: identity.name, ...(identity.company ? { currentCompany: identity.company } : {}) }, limit: 10 } } };
		case 'linkedin:anyapi':
			return { operation: 'social.linkedin.anyapi' as const, input: { body: { query } } };
		case 'instagram:anyapi':
			return { operation: 'social.instagram.anyapi' as const, input: { body: { query } } };
		case 'instagram:tikhub':
			return { operation: 'social.instagram.tikhub' as const, input: { queryParams: { query, select: 'users' as const } } };
		case 'facebook:litescrape':
			return { operation: 'social.facebook.litescrape' as const, input: { queryParams: { query, limit: 10 } } };
		case 'x:anyapi':
			return { operation: 'social.x.anyapi' as const, input: { body: { query } } };
		case 'tiktok:anyapi':
			return { operation: 'social.tiktok.anyapi' as const, input: { body: { query } } };
		case 'tiktok:tikhub':
			return { operation: 'social.tiktok.tikhub' as const, input: { queryParams: { keyword: query } } };
		case 'youtube:tikhub':
			return { operation: 'social.youtube.tikhub' as const, input: { queryParams: { keyword: query, need_format: true as const } } };
		case 'youtube:litescrape':
			return { operation: 'social.youtube.litescrape' as const, input: { queryParams: { q: query, type: 'channel' as const } } };
		default: return null;
	}
}

async function runSocialProvider(access: ProviderAccess, provider: SocialProvider, platform: SocialPlatform, identity: ContactIdentity) {
	const request = socialRequest(provider, platform, identity);
	if (!request) return null;
	if ('generic' in request) {
		if (request.generic === 'people_enrich') {
			const parts = identity.name.split(/\s+/).filter(Boolean);
			const run = await runMonidOperation(access.requireKey('monid'), 'people.enrich', { body: {
				...(parts.length > 1 ? { name: { first: parts[0], last: parts.slice(1).join(' ') } } : {}),
				...(identity.email && emailValue(identity.email) ? { email: identity.email } : {}),
				...(identity.profileUrl ? { social_urls: [identity.profileUrl] } : {}),
				...((identity.company || identity.domain) ? { company: { ...(identity.company ? { name: identity.company } : {}), ...(identity.domain ? { domain: identity.domain } : {}) } } : {}),
			} }, { spend: access.spend, actor: access.account, timeoutMs: 120_000 });
			return run;
		}
		const queryText = `site:${socialHost(platform)} ${JSON.stringify(identity.name)} ${identity.company || identity.domain}`.trim();
		return runMonidOperation(access.requireKey('monid'), 'web.search', { body: { query: queryText, numResults: 10, includeDomains: [socialHost(platform)] } }, { spend: access.spend, actor: access.account, timeoutMs: 120_000 });
	}
	const timeoutMs = provider === 'apify' ? 210_000 : 120_000;
	return runMonidWaterfall(access.requireKey('monid'), request.operation, request.input, { spend: access.spend, actor: access.account, timeoutMs });
}

/** Returns one verified-platform profile URL, preserving match score, evidence, and every Monid run receipt. */
export async function runMonidSocialWaterfall(access: ProviderAccess, op: Extract<ColumnOp, { kind: 'social-enrichment' }>, row: Record<string, CellValue>): Promise<EnrichResponse> {
	const identity = identityFrom(op, row);
	if (!identity.name) throw inputError('Add a person’s name before searching for a social profile.', 'monid');
	if (identity.profileUrl && isSocialProfileFor(identity.profileUrl, op.platform)) return { value: identity.profileUrl, meta: { sources: [identity.profileUrl], confidence: 1, reasoning: `This row already contains a ${op.platform} profile URL.` } };
	const reasons: string[] = [];
	for (const provider of op.providers) {
		const run = await runSocialProvider(access, provider, op.platform, identity);
		if (!run) { reasons.push(`${provider} skipped · missing required inputs`); continue; }
		const candidate = socialCandidate(run.output, op.platform, identity);
		if (candidate) return { value: candidate.url, meta: { monidRuns: monidRuns(access), monidCostUsd: sumRunCosts(access), sources: candidate.sources, confidence: candidate.providerScore ?? candidate.score, reasoning: `${providerTitle(provider)} returned a ${op.platform} profile whose displayed name matched the requested person. Confidence uses the Monid match score when available, otherwise an app-side name similarity estimate.` } };
		reasons.push(`${providerTitle(provider)} completed without a confident profile match`);
	}
	if (!access.spend.monidRuns.length && reasons.every((reason) => reason.includes('skipped'))) throw inputError(`The selected ${op.platform} providers need a name and any provider-specific identity clues shown above.`, 'monid');
	return { value: null, meta: { monidRuns: monidRuns(access), monidCostUsd: sumRunCosts(access), reasoning: `No confident ${op.platform} profile match was returned. ${reasons.join('; ')}.` } };
}
