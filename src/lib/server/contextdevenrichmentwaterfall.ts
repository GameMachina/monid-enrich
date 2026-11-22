import 'server-only';
import type { CellMeta, CellValue, ColumnOp, EmailProvider, EnrichFailure, EnrichResponse } from '../types';
import { renderTemplate, toDomain } from '../template';
import type { ProviderAccess } from './provider-access';
import { CredentialError } from './credentials';
import { inputError } from './enrich-failure';
import { runMonidOperation, type MonidOperationInputs } from './monid';

type Identity = { name: string; company: string; domain: string; profileUrl: string };
type SharedRequest = { operation: 'email.find'; input: MonidOperationInputs['email.find']; boundUsd: number };
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const string = (value: unknown) => typeof value === 'string' ? value : '';
const validEmail = (value: unknown): string | null => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !/[*•]/.test(value) ? value : null;
const verified = (value: unknown) => typeof value === 'string' && ['valid', 'verified', 'good'].includes(value.toLowerCase());

/** Normalizes Monid's email-finder response while retaining its match score and source URLs. */
export function emailCandidate(_provider: EmailProvider, raw: unknown): { email: string | null; verified: boolean; verificationStatus: string; confidence?: number; sources: string[] } {
	const root = object(raw), data = root.data !== undefined ? object(root.data) : root;
	const verification = object(data.verification);
	const status = string(data.status) || string(verification.status) || 'unknown';
	const score = typeof data.score === 'number' ? data.score : typeof data.confidence === 'number' ? data.confidence : undefined;
	const sourceList = Array.isArray(data.sources) ? data.sources : [];
	const sources = sourceList.flatMap((entry) => { const url = typeof entry === 'string' ? entry : string(object(entry).uri ?? object(entry).url); return /^https?:\/\//i.test(url) ? [url] : []; });
	return { email: validEmail(data.email), verified: verified(status), verificationStatus: status, confidence: score === undefined ? undefined : Math.max(0, Math.min(1, score > 1 ? score / 100 : score)), sources };
}

/** The current inspected Monid mapping for name + domain work-email lookup. */
export function sharedRequest(_provider: EmailProvider, identity: Identity): SharedRequest {
	const parts = identity.name.trim().split(/\s+/);
	const queryParams: MonidOperationInputs['email.find']['queryParams'] = { full_name: identity.name, domain: identity.domain, max_duration: 10 };
	if (parts.length > 1) { queryParams.first_name = parts[0]; queryParams.last_name = parts.slice(1).join(' '); }
	const linkedinHandle = identity.profileUrl.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1];
	if (linkedinHandle) queryParams.linkedin_handle = linkedinHandle;
	return { operation: 'email.find', input: { queryParams }, boundUsd: 0.0245 };
}

/** Legacy trial paths are deliberately unsupported: every email lookup requires the workspace's Monid connection. */
export async function includedRun(_access: ProviderAccess, _request: SharedRequest, _ledger?: unknown): Promise<{ output: unknown; costUsd: number }> {
	void _access; void _request; void _ledger;
	throw new CredentialError('Included enrichment is not configured. Connect a Monid API key to this workspace.', 401, 'credential_missing', 'monid');
}

function actualCost(run: { cost?: { value?: number }; billing?: unknown }) {
	if (typeof run.cost?.value === 'number') return run.cost.value;
	const billing = object(run.billing), cost = object(billing.reportedCost ?? billing.actualCost);
	if (typeof cost.value !== 'number') return 0;
	return cost.unit === 'MICRO_DOLLAR' ? cost.value / 1_000_000 : cost.value;
}

export async function runEmailWaterfall(access: ProviderAccess, op: Extract<ColumnOp, { kind: 'email-enrichment' }>, row: Record<string, CellValue>, _ledger?: unknown): Promise<EnrichResponse> {
	void _ledger;
	const input = (value: string) => renderTemplate(value, row).trim();
	const identity: Identity = { name: input(op.name), company: input(op.company), domain: toDomain(input(op.domain)), profileUrl: input(op.profileUrl) };
	if (!identity.name || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(identity.domain)) throw inputError('Provide a person name and company domain for this row.', 'monid');
	if (identity.profileUrl) {
		let profile: URL;
		try { profile = new URL(identity.profileUrl); } catch { throw inputError('Enter a valid LinkedIn profile URL.', 'monid'); }
		if (profile.protocol !== 'https:' || !['linkedin.com', 'www.linkedin.com'].includes(profile.hostname) || !/^\/(in|pub)\//.test(profile.pathname)) throw inputError('Enter a valid LinkedIn profile URL.', 'monid');
	}
	const request = sharedRequest('monid', identity);
	const attempt: NonNullable<CellMeta['enrichment']>['attempts'][number] = { provider: 'monid', source: 'own-key', status: 'Running', costUsd: 0 };
	const run = await runMonidOperation(access.requireKey('monid'), request.operation, request.input, { spend: access.spend, actor: access.account, timeoutMs: 120_000 });
	const candidate = emailCandidate('monid', run.output);
	attempt.costUsd = actualCost(run);
	attempt.status = candidate.email ? 'Found' : 'No email found';
	const meta: CellMeta = { provider: 'monid', sources: candidate.sources, confidence: candidate.confidence, reasoning: candidate.email ? `Monid match status: ${candidate.verificationStatus}.` : 'No work email found.', enrichment: { costUsd: attempt.costUsd, attempts: [attempt], verified: candidate.verified, verificationStatus: candidate.verificationStatus } };
	return { value: candidate.email as CellValue, meta };
}

export type EmailWaterfallFailure = EnrichFailure;
