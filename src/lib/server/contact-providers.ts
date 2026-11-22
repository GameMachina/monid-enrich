import 'server-only';
import { renderTemplate, toDomain, toUrl } from '../template';
import type { CellMeta, CellValue, ColumnOp, EnrichResponse } from '../types';
import type { ProviderAccess } from './provider-access';
import { EnrichError, failure, inputError } from './enrich-failure';
import { runMonidOperation, type MonidOperationInputs } from './monid';
import { PHONE_STRATEGY_INFO, type PhoneProvider, type PhoneProviderStrategy } from '../phone-strategy';

type ContactOp = Extract<ColumnOp, { kind: 'hunter' | 'prospeo' }>;
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const text = (value: unknown) => typeof value === 'string' ? value : '';
const email = (value: unknown) => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
const verifiedEmailStatus = (status: string) => ['valid', 'verified', 'good'].includes(status.toLowerCase());

function metaFromRun(run: { runId: string; provider: string; endpoint: string; status: string; cost?: { value?: number }; billedUnits?: number; price?: { type?: string; amount?: number; currency?: string }; resultCount?: number | null; completedAt?: string }): CellMeta {
	return { monidRuns: [{ runId: run.runId, provider: run.provider, endpoint: run.endpoint, status: run.status, costUsd: run.cost?.value, billedUnits: run.billedUnits, price: run.price, resultCount: run.resultCount ?? undefined, completedAt: run.completedAt }] };
}

type MobileInput = { name: string; company: string; profileUrl: string; workEmail?: string; strategy?: PhoneProviderStrategy };

function mobileOutput(run: { output?: unknown }, provider: PhoneProvider) {
	const root = object(run.output);
	const data = object(root.data ?? root.result ?? root);
	const candidates = provider === 'clay' ? [data['Mobile Phone'], data.mobile, data.phone] : [data.mobile, data.mobilePhone, data.phone, data['Mobile Phone']];
	const phone = candidates.find((value) => typeof value === 'string' && value.trim());
	const rawSources = data.sources ?? root.sources;
	const sources = Array.isArray(rawSources) ? rawSources.flatMap((source) => {
		const uri = text(object(source).url ?? object(source).uri ?? source);
		return /^https?:\/\//i.test(uri) ? [uri] : [];
	}) : [];
	return { phone: text(phone).trim() || null, sources };
}

function leadMagicBody(input: MobileInput): MonidOperationInputs['people.mobilePhone.leadmagic']['body'] | null {
	const profileUrl = toUrl(input.profileUrl);
	const workEmail = input.workEmail?.trim() ?? '';
	const body: MonidOperationInputs['people.mobilePhone.leadmagic']['body'] = {
		...(profileUrl ? { profileUrl } : {}),
		...(email(workEmail) ? { workEmail } : {}),
	};
	return body.profileUrl || body.workEmail ? body : null;
}

function clayBody(input: MobileInput): MonidOperationInputs['people.mobilePhone']['body'] | null {
	const name = input.name.trim();
	const company = input.company.trim();
	const profileUrl = toUrl(input.profileUrl);
	const workEmail = input.workEmail?.trim() ?? '';
	if (!name || !company || !profileUrl || !/linkedin\.com\/in\//i.test(profileUrl)) return null;
	const maybeDomain = toDomain(company);
	const companyDomain = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(maybeDomain) ? maybeDomain : undefined;
	return {
		'Social Profile URL': profileUrl,
		'Full Name': name,
		'Company Name': company,
		...(companyDomain ? { 'Company Domain': companyDomain } : {}),
		...(email(workEmail) ? { 'Work Email': workEmail } : {}),
	};
}

function mobileInputError(input: MobileInput) {
	if (!input.name.trim()) return 'Add the person’s full name before looking up a mobile number.';
	if (!input.company.trim()) return 'Add the person’s current company before looking up a mobile number.';
	if (!toUrl(input.profileUrl) || !/linkedin\.com\/in\//i.test(toUrl(input.profileUrl) ?? '')) return 'Add a LinkedIn personal profile URL before looking up a mobile number.';
	return 'Add a LinkedIn profile URL or a valid work email for the selected mobile provider strategy.';
}

/** Mobile-number requests use only inspected Monid routes. A waterfall advances only on a completed no-match. */
export async function lookupMobilePhone(access: ProviderAccess, input: MobileInput) {
	const profileUrl = toUrl(input.profileUrl);
	const strategy = input.strategy ?? 'clay'; // Existing columns without a saved strategy retain their historical behavior.
	const providers = PHONE_STRATEGY_INFO[strategy].providers;
	const disallowed = providers.filter((provider) => !access.allowedPhoneProviders.includes(provider));
	if (disallowed.length) throw inputError(`This column uses ${disallowed.join(' and ')}, which the workspace has disabled. Choose an enabled strategy in the column settings.`, 'monid');
	const key = access.requireKey('monid');
	const reasons: string[] = [];
	for (const provider of providers) {
		let run;
		if (provider === 'leadmagic') {
			const body = leadMagicBody(input);
			if (!body) { reasons.push('LeadMagic skipped because this row is missing its required identifiers'); continue; }
			run = await runMonidOperation(key, 'people.mobilePhone.leadmagic', { body }, { spend: access.spend, actor: access.account, timeoutMs: 60_000 });
		} else {
			const body = clayBody(input);
			if (!body) { reasons.push('Clay skipped because this row is missing its required identifiers'); continue; }
			run = await runMonidOperation(key, 'people.mobilePhone', { body }, { spend: access.spend, actor: access.account, timeoutMs: 180_000 });
		}
		const result = mobileOutput(run, provider);
		if (profileUrl && !result.sources.includes(profileUrl)) result.sources.push(profileUrl);
		if (result.phone) return { value: result.phone, meta: { ...metaFromRun(run), sources: result.sources, reasoning: `${provider === 'leadmagic' ? 'LeadMagic' : 'Clay'} found a mobile phone number through Monid.${reasons.length ? ` ${reasons.join('; ')}.` : ''}` } };
		reasons.push(`${provider === 'leadmagic' ? 'LeadMagic' : 'Clay'} completed with no match`);
	}
	if (reasons.length && reasons.every((reason) => reason.includes('skipped'))) throw inputError(mobileInputError(input), 'monid');
	return { value: null, meta: { sources: profileUrl ? [profileUrl] : [], reasoning: `No mobile number was returned. ${reasons.join('; ')}.` } };
}

async function findWorkEmail(access: ProviderAccess, name: string, domain: string, profileUrl?: string) {
	if (!name || !domain) throw inputError('Monid email finder needs a name and company domain for this row.', 'monid');
	const parts = name.trim().split(/\s+/);
	const queryParams: MonidOperationInputs['email.find']['queryParams'] = { full_name: name, domain, max_duration: 10 };
	if (parts.length >= 2) { queryParams.first_name = parts[0]; queryParams.last_name = parts.slice(1).join(' '); }
	const linkedinHandle = profileUrl?.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1];
	if (linkedinHandle) queryParams.linkedin_handle = linkedinHandle;
	const run = await runMonidOperation(access.requireKey('monid'), 'email.find', { queryParams }, { spend: access.spend, actor: access.account, timeoutMs: 120_000 });
	const root = object(run.output), data = object(root.data !== undefined ? root.data : root);
	const matchScore = typeof data.score === 'number' ? Math.max(0, Math.min(1, data.score / 100)) : undefined;
	const sources = Array.isArray(data.sources) ? data.sources.flatMap((source) => { const uri = text(object(source).uri ?? object(source).url); return /^https?:\/\//i.test(uri) ? [uri] : []; }) : [];
	return { value: email(data.email), confidence: matchScore, sources, status: text(data.status) || text(object(data.verification).status) || 'unknown', meta: metaFromRun(run) };
}

async function verifyEmail(access: ProviderAccess, address: string) {
	if (!email(address)) throw inputError('Enter a valid email address to verify.', 'monid');
	const run = await runMonidOperation(access.requireKey('monid'), 'email.verify', { body: { email: address } }, { spend: access.spend, actor: access.account, timeoutMs: 120_000 });
	const data = object(run.output), status = text(data.status) || 'unknown';
	return { value: status, status, confidence: typeof data.score === 'number' ? Math.max(0, Math.min(1, data.score / 100)) : undefined, sources: [], meta: metaFromRun(run) };
}

function personClues(op: Extract<ContactOp, { kind: 'prospeo' }>, row: Record<string, CellValue>) {
	const name = op.name ? renderTemplate(op.name, row).trim() : '';
	const company = op.domain ? renderTemplate(op.domain, row).trim() : '';
	const domain = toDomain(company);
	const address = op.email ? renderTemplate(op.email, row).trim() : '';
	const profile = op.profileUrl ? toUrl(renderTemplate(op.profileUrl, row)) : '';
	const body: Record<string, unknown> = {};
	if (profile) body.social_urls = [profile];
	if (email(address)) body.email = address;
	if (name) {
		const parts = name.split(/\s+/);
		if (parts.length >= 2) body.name = { first: parts[0], last: parts.slice(1).join(' ') };
	}
	if (company) body.company = domain && /\.[a-z]{2,}$/i.test(domain) ? { domain } : { name: company };
	return { name, company, address, profile, body };
}

function personValue(person: ObjectValue, field: string): CellValue {
	const current = object(person.current_role), organization = object(current.organization), location = object(person.location);
	switch (field) {
		case 'full_name': return text(object(person.name).full) || [object(person.name).first, object(person.name).last].filter(Boolean).join(' ') || null;
		case 'title': return text(current.title) || null;
		case 'company': return text(organization.name) || null;
		case 'company_domain': return text(organization.domain) || null;
		case 'linkedin': return (Array.isArray(person.social_urls) ? person.social_urls.find((url) => typeof url === 'string' && url.includes('linkedin.com')) : null) as CellValue ?? null;
		case 'location': return text(location.display) || [location.city, location.region, location.country].filter(Boolean).join(', ') || null;
		case 'email': return email(person.email);
		case 'mobile': throw new EnrichError('Mobile-number enrichment is not supported by the configured Monid operations.', failure('input_invalid', 'monid', false));
		case 'skills': return Array.isArray(person.skills) ? person.skills.filter((entry): entry is string => typeof entry === 'string') : null;
		case 'schools': return Array.isArray(person.education) ? person.education.map((entry) => text(object(object(entry).institution).name)).filter(Boolean) : null;
		default: return null;
	}
}

/** All email and contact lookups execute only via Monid's current inspected endpoints. */
export async function contactLookup(access: ProviderAccess, op: ContactOp, row: Record<string, CellValue>): Promise<{ result: EnrichResponse; verification: string | null }> {
	if (op.kind === 'hunter') {
		if (op.action === 'verify') {
			const address = op.email ? renderTemplate(op.email, row).trim() : '';
			const result = await verifyEmail(access, address);
			return { result: { value: result.value, meta: { ...result.meta, confidence: result.confidence, sources: result.sources, reasoning: `Monid verification verdict: ${result.status}.` } }, verification: result.status };
		}
		const name = op.name ? renderTemplate(op.name, row).trim() : '';
		const domain = op.domain ? toDomain(renderTemplate(op.domain, row)) : '';
		const found = await findWorkEmail(access, name, domain);
		return { result: { value: found.value, meta: { ...found.meta, confidence: found.confidence, sources: found.sources, reasoning: found.value ? `Monid match status: ${found.status}.` : 'No email found.' } }, verification: found.status };
	}
	const clues = personClues(op, row);
	if (op.field === 'mobile') {
		const result = await lookupMobilePhone(access, { name: clues.name, company: clues.company, profileUrl: clues.profile ?? '', workEmail: clues.address, strategy: op.phoneStrategy });
		return { result: { value: result.value, meta: result.meta }, verification: null };
	}
	if (op.field === 'email' && !clues.address && clues.name && clues.body.company) {
		const found = await findWorkEmail(access, clues.name, toDomain(clues.company) ?? '', clues.profile ?? undefined);
		const value = op.onlyVerifiedEmail && !verifiedEmailStatus(found.status) ? null : found.value;
		return { result: { value, meta: { ...found.meta, confidence: found.confidence, sources: found.sources, reasoning: `Monid match status: ${found.status}.${found.value && !value ? ' The result was hidden because a verified address was requested.' : ''}` } }, verification: found.status };
	}
	if (clues.address && op.field === 'email') {
		const result = await verifyEmail(access, clues.address);
		const value = op.onlyVerifiedEmail && !verifiedEmailStatus(result.status) ? null : clues.address;
		return { result: { value, meta: { ...result.meta, confidence: result.confidence, reasoning: `Monid verification verdict: ${result.status}.${value ? '' : ' The result was hidden because a verified address was requested.'}` } }, verification: result.status };
	}
	if (!Object.keys(clues.body).length) throw inputError('Provide a name with a company, a work email, or a profile URL for this row.', 'monid');
	const response = await access.context().people.enrich(clues.body as never, { timeout: 120_000 });
	const match = object(response.match), person = object(match.person);
	let value = match.status === 'candidate' ? personValue(person, op.field) : null;
	const confidence = typeof match.score === 'number' ? Math.max(0, Math.min(1, Number(match.score) > 1 ? Number(match.score) / 100 : Number(match.score))) : undefined;
	const sources = Array.isArray(person.social_urls) ? person.social_urls.filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url)) : [];
	let verificationMeta: CellMeta | undefined;
	if (op.field === 'email' && typeof value === 'string' && op.onlyVerifiedEmail) {
		const checked = await verifyEmail(access, value);
		verificationMeta = checked.meta;
		if (!verifiedEmailStatus(checked.status)) value = null;
	}
	return { result: { value, meta: { ...verificationMeta, confidence, sources, reasoning: match.status === 'candidate' ? (value === null && op.field === 'email' && op.onlyVerifiedEmail ? 'Person matched, but no verified email was found.' : 'Person profile matched by Monid.') : 'No matching person found.' } }, verification: null };
}

export async function runContactProvider(access: ProviderAccess, op: ContactOp, row: Record<string, CellValue>): Promise<EnrichResponse> {
	return (await contactLookup(access, op, row)).result;
}
