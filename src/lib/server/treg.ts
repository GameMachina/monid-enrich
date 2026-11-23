import 'server-only';

import { createHash } from 'node:crypto';
import type { Account } from '../auth-identity';
import { isSocialProfileFor, type SocialPlatform } from '../social-platform';
import { renderTemplate, toDomain, toUrl } from '../template';
import type { CellMeta, CellValue, ColumnOp, DataProvider, EnrichResponse } from '../types';
import { EnrichError, failure, httpFailure, inputError } from './enrich-failure';
import type { ProviderAccess } from './provider-access';
import { withDatabase } from './database';

const API = 'https://treg.to';
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
type Json = Record<string, unknown>;
type TregReceipt = NonNullable<CellMeta['tregRuns']>[number];
type CallSpec = { operation: string; endpoint: string; method: 'GET' | 'POST'; query?: Record<string, string>; body?: Json; maxCostUsd?: number; routeWaterfall?: boolean };

export interface TregEndpointRequest {
	operation: string;
	endpoint: string;
	method: 'GET' | 'POST';
	query?: Record<string, string>;
	body?: Record<string, unknown>;
	maxCostUsd?: number;
	routeWaterfall?: boolean;
	input?: unknown;
}

const obj = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const str = (value: unknown) => typeof value === 'string' ? value.trim() : '';

function safeCost(response: Response, body: unknown) {
	const rawHeader = response.headers.get('x-treg-cost-micro');
	const header = rawHeader === null || rawHeader === '' ? Number.NaN : Number(rawHeader);
	if (Number.isFinite(header) && header >= 0) return { costMicroUsd: header, costUsd: header / 1_000_000 };
	const treg = obj(obj(body)._treg);
	const rawMicro = treg.cost_micro ?? treg.costMicroUsd;
	const micro = rawMicro === null || rawMicro === undefined || rawMicro === '' ? Number.NaN : Number(rawMicro);
	if (Number.isFinite(micro) && micro >= 0) return { costMicroUsd: micro, costUsd: micro / 1_000_000 };
	const rawUsd = treg.cost_usd ?? treg.costUsd;
	const usd = rawUsd === null || rawUsd === undefined || rawUsd === '' ? Number.NaN : Number(rawUsd);
	return Number.isFinite(usd) && usd >= 0 ? { costUsd: usd } : {};
}

function sourceUrls(root: unknown): string[] {
	const found = new Set<string>();
	const visit = (value: unknown, depth = 0) => {
		if (depth > 7) return;
		if (Array.isArray(value)) { value.forEach((item) => visit(item, depth + 1)); return; }
		if (!value || typeof value !== 'object') return;
		for (const [key, child] of Object.entries(value as Json)) {
			if (['sources', 'source_urls', 'sourceUrls', 'urls_analyzed', 'citations'].includes(key)) {
				for (const item of Array.isArray(child) ? child : [child]) {
					const url = typeof item === 'string' ? item : str(obj(item).url ?? obj(item).uri ?? obj(item).link);
					if (/^https?:\/\//i.test(url)) found.add(url);
				}
			}
			visit(child, depth + 1);
		}
	};
	visit(root);
	return [...found];
}

function confidence(root: unknown): number | undefined {
	const visit = (value: unknown, depth = 0): number | undefined => {
		if (depth > 7) return undefined;
		if (Array.isArray(value)) { for (const item of value) { const found = visit(item, depth + 1); if (found !== undefined) return found; } return undefined; }
		if (!value || typeof value !== 'object') return undefined;
		const record = value as Json;
		for (const key of ['confidence', 'match_score', 'matchScore', 'score']) {
			const raw = record[key];
			if (raw === undefined || raw === null || raw === '') continue;
			const number = Number(raw);
			if (Number.isFinite(number)) return Math.max(0, Math.min(1, number > 1 ? number / 100 : number));
		}
		for (const child of Object.values(record)) { const found = visit(child, depth + 1); if (found !== undefined) return found; }
		return undefined;
	};
	return visit(root);
}

function nestedString(root: unknown, keys: readonly string[]): string {
	const visit = (value: unknown, depth = 0): string => {
		if (depth > 7) return '';
		if (Array.isArray(value)) { for (const item of value) { const found = visit(item, depth + 1); if (found) return found; } return ''; }
		if (!value || typeof value !== 'object') return '';
		const record = value as Json;
		for (const key of keys) if (str(record[key])) return str(record[key]);
		for (const child of Object.values(record)) { const found = visit(child, depth + 1); if (found) return found; }
		return '';
	};
	return visit(root);
}

function makeMeta(receipt: TregReceipt, response: unknown, provider: DataProvider = 'treg'): CellMeta {
	const cost = receipt.costUsd;
	return {
		dataProvider: provider,
		tregRuns: [receipt],
		...(cost !== undefined ? { tregCostUsd: cost } : {}),
		sources: sourceUrls(response),
		confidence: confidence(response),
		raw: response,
	};
}

async function persistCall(actor: Account | undefined, receipt: TregReceipt, idempotencyKey: string, input: unknown, error?: string) {
	if (!actor) return;
	const inputHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
	const callId = receipt.callId ?? `idem:${idempotencyKey}`;
	const now = Date.now();
	await withDatabase((database) => database.transaction(async (sql, workspace) => {
		await sql.query(`INSERT INTO enrichable.treg_runs (workspace_id,call_id,idempotency_key,data_provider,operation,endpoint,status,input_hash,cost_usd,cost_micro_usd,served_via,error,created_at,updated_at)
			VALUES ($1,$2,$3,'treg',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
			ON CONFLICT (workspace_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE SET call_id=excluded.call_id,status=excluded.status,cost_usd=COALESCE(excluded.cost_usd,enrichable.treg_runs.cost_usd),cost_micro_usd=COALESCE(excluded.cost_micro_usd,enrichable.treg_runs.cost_micro_usd),served_via=COALESCE(excluded.served_via,enrichable.treg_runs.served_via),error=excluded.error,updated_at=excluded.updated_at`,
		[workspace, callId, idempotencyKey, receipt.operation, receipt.endpoint, receipt.status, inputHash, receipt.costUsd ?? null, receipt.costMicroUsd ?? null, receipt.servedVia ?? null, error ? 'Provider request failed.' : null, now, now]);
	}, { workspace: actor }));
}

async function persistReceipt(actor: Account | undefined, receipt: TregReceipt, idempotencyKey: string, input: unknown, error?: string, response?: unknown) {
	try { await persistCall(actor, receipt, idempotencyKey, input, error); }
	catch {
		const meta = { ...makeMeta(receipt, response), tregIdempotencyKey: idempotencyKey, tregIdempotencyCreatedAt: Date.now() };
		throw new TregCallError(`Treg call ${receipt.callId ?? '(ID pending)'} could not save its usage receipt. It was not resubmitted; retry safely with the saved idempotency key.`, failure('provider_error', 'treg', false), meta, idempotencyKey);
	}
}

function responseFailure(status: number, message: string) {
	const parsed = httpFailure(status, 'treg', message);
	const error = status === 401 || status === 403
		? new EnrichError('Treg rejected this API key. Reconnect Treg in Configuration.', parsed)
		: status === 402 || /insufficient balance|insufficient funds|quota/i.test(message)
			? new EnrichError('Treg reported insufficient team balance or quota. Check the separate Treg billing state in Configuration.', failure('credits_exhausted', 'treg'))
			: new EnrichError(message || `Treg request failed (${status}).`, parsed);
	Object.defineProperty(error, 'status', { value: status, enumerable: true });
	return error;
}

function parseReceipt(response: Response, operation: string, endpoint: string, body: unknown, fallbackStatus: string): TregReceipt {
	const cost = safeCost(response, body);
	const root = obj(body), meta = obj(root._treg);
	const callId = response.headers.get('x-treg-call-id') ?? str(root.call_id ?? root.callId ?? meta.call_id ?? meta.callId);
	const tried = Array.isArray(meta.tried) ? meta.tried.flatMap((attempt) => {
		const item = obj(attempt);
		const provider = str(item.provider ?? item.service ?? item.served_by ?? item.endpoint);
		if (!provider) return [];
		const attemptCost = Number(item.cost_usd ?? item.costUsd);
		return [{ provider, ...(str(item.status) ? { status: str(item.status) } : {}), ...(Number.isFinite(attemptCost) && attemptCost >= 0 ? { costUsd: attemptCost } : {}) }];
	}) : [];
	const servedBy = response.headers.get('x-treg-served-by') ?? str(meta.served_by ?? meta.servedBy);
	return {
		...(callId ? { callId } : {}),
		operation,
		endpoint,
		status: str(meta.status ?? obj(body).status) || fallbackStatus,
		...(cost.costUsd !== undefined ? { costUsd: cost.costUsd } : {}),
		...(cost.costMicroUsd !== undefined ? { costMicroUsd: cost.costMicroUsd } : {}),
		...(response.headers.get('x-treg-served-via') ?? str(meta.served_via ?? meta.servedVia) ? { servedVia: response.headers.get('x-treg-served-via') ?? str(meta.served_via ?? meta.servedVia) } : {}),
		...(servedBy ? { servedBy } : {}),
		...(tried.length ? { tried } : {}),
		completedAt: new Date().toISOString(),
	};
}

async function jsonResponse(response: Response) {
	return response.json().catch(() => ({})) as Promise<unknown>;
}

async function callTreg(access: ProviderAccess, spec: CallSpec, input: unknown, idempotencyKey: string, signal?: AbortSignal): Promise<{ data: unknown; meta: CellMeta }> {
	const token = access.requireKey('treg');
	const url = new URL(`/call/${spec.endpoint}`, API);
	for (const [key, value] of Object.entries(spec.query ?? {})) url.searchParams.set(key, value);
	const headers = new Headers({ 'X-Treg-Token': token, 'Idempotency-Key': idempotencyKey });
	if (spec.body) headers.set('content-type', 'application/json');
	if (spec.maxCostUsd !== undefined) headers.set('X-Treg-Route-Max-Cost', String(spec.maxCostUsd));
	if (spec.routeWaterfall === false) headers.set('X-Treg-Route-Waterfall', '0');
	let response: Response;
	try {
		response = await fetch(url, { method: spec.method, headers, ...(spec.body ? { body: JSON.stringify(spec.body) } : {}), cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000) });
	} catch {
		// Treg stores idempotency receipts, so repeating the exact request with the same key is safe.
		try {
			response = await fetch(url, { method: spec.method, headers, ...(spec.body ? { body: JSON.stringify(spec.body) } : {}), cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000) });
		} catch {
			const receipt = { operation: spec.operation, endpoint: `/call/${spec.endpoint}`, status: 'UNCERTAIN' };
			const meta = makeMeta(receipt, null);
			await persistReceipt(access.account, receipt, idempotencyKey, input, 'Treg did not confirm the call; safe retry key retained.');
			throw new TregCallError('Treg did not confirm this call. Its idempotency key is saved for a safe retry; check Treg call history before retrying.', failure('timeout', 'treg', false), meta, idempotencyKey);
		}
	}
	let data = await jsonResponse(response);
	let receipt = parseReceipt(response, spec.operation, `/call/${spec.endpoint}`, data, response.ok ? 'COMPLETED' : 'FAILED');
	if (!response.ok && response.status !== 202) {
		const message = str(obj(data).detail ?? obj(data).error ?? obj(data).message) || `Treg request failed (${response.status}).`;
		await persistReceipt(access.account, receipt, idempotencyKey, input, message, data);
		throw new TregCallError(message, responseFailure(response.status, message).failure, makeMeta(receipt, data), idempotencyKey);
	}
	if (response.headers.get('x-treg-error') === '1') {
		const message = str(obj(data).detail ?? obj(data).error ?? obj(data).message) || 'Treg reported an endpoint error.';
		await persistReceipt(access.account, { ...receipt, status: 'FAILED' }, idempotencyKey, input, message, data);
		throw new TregCallError(message, failure('provider_error', 'treg', false), makeMeta({ ...receipt, status: 'FAILED' }, data), idempotencyKey);
	}
	if (['failed', 'error', 'cancelled', 'canceled', 'timeout', 'timed_out'].includes(receipt.status.toLowerCase())) {
		const message = str(obj(data).detail ?? obj(data).error ?? obj(data).message) || `Treg call ended with status ${receipt.status}.`;
		receipt = { ...receipt, status: receipt.status.toUpperCase() };
		await persistReceipt(access.account, receipt, idempotencyKey, input, message, data);
		throw new TregCallError(message, failure(receipt.status.toLowerCase().includes('timeout') ? 'timeout' : 'provider_error', 'treg', false), makeMeta(receipt, data), idempotencyKey);
	}
	const asyncRun = response.status === 202 || ['true', '1', 'yes'].includes((response.headers.get('x-treg-async') ?? '').toLowerCase());
	if (asyncRun && !receipt.callId) {
		receipt = { ...receipt, status: 'UNCERTAIN' };
		const message = 'Treg accepted an asynchronous call without returning a call ID. It was not resubmitted; check Treg call history before retrying.';
		await persistReceipt(access.account, receipt, idempotencyKey, input, message, data);
		throw new TregCallError(message, failure('timeout', 'treg', false), makeMeta(receipt, data), idempotencyKey);
	}
	if (asyncRun && receipt.callId) {
		const deadline = Date.now() + 120_000;
		let terminal = false;
		while (Date.now() < deadline) {
			if (signal?.aborted) break;
			await new Promise((resolve) => setTimeout(resolve, 1200));
			let poll: Response;
			try {
				poll = await fetch(`${API}/calls/${encodeURIComponent(receipt.callId)}/result`, { headers: { 'X-Treg-Token': token }, cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
			} catch (cause) {
				const message = cause instanceof Error ? cause.message : 'Treg run status check failed.';
				receipt = { ...receipt, status: 'UNCERTAIN' };
				await persistReceipt(access.account, receipt, idempotencyKey, input, message);
				throw new TregCallError(`Treg created run ${receipt.callId}, but its status could not be checked. It was not resubmitted; retry safely with the saved idempotency key.`, failure('timeout', 'treg', false), makeMeta(receipt, null), idempotencyKey);
			}
			const polled = await jsonResponse(poll);
			const pollStatus = str(obj(polled).status).toLowerCase();
			if (poll.status === 202 || ['queued', 'pending', 'running', 'processing'].includes(pollStatus)) continue;
			if (!poll.ok) {
				const message = str(obj(polled).detail ?? obj(polled).error ?? obj(polled).message) || `Treg run status check failed (${poll.status}).`;
				receipt = { ...receipt, status: 'UNCERTAIN' };
				await persistReceipt(access.account, receipt, idempotencyKey, input, message, polled);
				throw new TregCallError(message, httpFailure(poll.status, 'treg', message), makeMeta(receipt, polled), idempotencyKey);
			}
			if (['failed', 'error', 'cancelled', 'canceled', 'timeout', 'timed_out'].includes(pollStatus)) {
				receipt = { ...receipt, status: pollStatus.toUpperCase() };
				const message = str(obj(polled).detail ?? obj(polled).error ?? obj(polled).message) || `Treg run ended with status ${pollStatus}.`;
				await persistReceipt(access.account, receipt, idempotencyKey, input, message, polled);
				throw new TregCallError(message, failure(pollStatus.includes('timeout') ? 'timeout' : 'provider_error', 'treg', false), makeMeta(receipt, polled), idempotencyKey);
			}
			data = polled;
			receipt = { ...receipt, ...parseReceipt(poll, spec.operation, `/call/${spec.endpoint}`, polled, str(obj(polled).status) || 'COMPLETED'), callId: receipt.callId };
			terminal = true;
			break;
		}
		if (!terminal) {
			receipt = { ...receipt, status: 'RUNNING' };
			await persistReceipt(access.account, receipt, idempotencyKey, input, 'Treg async run is still active; not resubmitted.', data);
			throw new TregCallError(`Treg run ${receipt.callId} is still active. It was not resubmitted; retry safely with the saved idempotency key.`, failure('timeout', 'treg', false), makeMeta(receipt, data), idempotencyKey);
		}
	}
	await persistReceipt(access.account, receipt, idempotencyKey, input, undefined, data);
	return { data, meta: makeMeta(receipt, data) };
}

/** Call one catalog-inspected Treg route. The selected route and receipt stay Treg-specific. */
export async function runTregEndpoint(access: ProviderAccess, request: TregEndpointRequest, options: { idempotencyKey?: string; signal?: AbortSignal } = {}) {
	const key = chosenIdempotencyKey(access, options.idempotencyKey);
	const body = request.body as Json | undefined;
	const input = request.input ?? request.body ?? request.query ?? {};
	try {
		const result = await callTreg(access, { operation: request.operation, endpoint: request.endpoint, method: request.method, query: request.query, body, maxCostUsd: request.maxCostUsd, routeWaterfall: request.routeWaterfall }, input, key, options.signal);
		return { ...result, meta: withRetryMeta(result.meta, key) };
	} catch (error) {
		if (error instanceof TregCallError) throw new TregCallError(error.message, error.failure, withRetryMeta(error.meta, key), key);
		throw error;
	}
}

export function tregOutput(value: unknown): Record<string, unknown> {
	const root = obj(value);
	return obj(root.output ?? root.result ?? root.data ?? value);
}

export function tregText(value: unknown, keys: readonly string[]): string {
	return nestedString(value, keys);
}

export function tregUrls(value: unknown): string[] {
	return sourceUrls(value);
}

export class TregCallError extends EnrichError {
	constructor(message: string, failureInfo: ReturnType<typeof failure>, readonly meta: CellMeta, readonly idempotencyKey: string) { super(message, failureInfo); }
}

function identity(op: { name: string; company: string; domain: string; profileUrl: string; email?: string }, row: Record<string, CellValue>) {
	const render = (value: string) => renderTemplate(value, row).trim();
	return { name: render(op.name), company: render(op.company), domain: toDomain(render(op.domain)), profileUrl: toUrl(render(op.profileUrl)) ?? '', email: render(op.email ?? '') };
}

function chosenIdempotencyKey(access: ProviderAccess, requestKey: string | undefined) {
	if (requestKey && /^[A-Za-z0-9._:-]{8,128}$/.test(requestKey)) return requestKey;
	return createHash('sha256').update(`${access.account?.partition ?? 'anonymous'}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 40);
}

function withRetryMeta(meta: CellMeta, key: string): CellMeta {
	return { ...meta, tregIdempotencyKey: key, tregIdempotencyCreatedAt: Date.now() };
}

export async function runTregContact(access: ProviderAccess, op: Extract<ColumnOp, { kind: 'email-enrichment' | 'phone-enrichment' | 'social-enrichment' }>, row: Record<string, CellValue>, options: { idempotencyKey?: string; signal?: AbortSignal } = {}): Promise<EnrichResponse> {
	const key = chosenIdempotencyKey(access, options.idempotencyKey);
	const id = identity(op as { name: string; company: string; domain: string; profileUrl: string; email?: string }, row);
	let spec: CallSpec;
	let input: unknown;
	let resultKey: readonly string[];
	let maxCostUsd: number;
	const routeWaterfall = op.tregRouteWaterfall !== false;
	if (op.kind === 'email-enrichment') {
		if (!id.profileUrl && (!id.name || !id.domain)) throw inputError('Treg email lookup needs a LinkedIn URL or both a person name and company domain.', 'treg');
		if (id.profileUrl && !/^https:\/\//i.test(id.profileUrl)) throw inputError('Enter a valid LinkedIn profile URL.', 'treg');
		input = { ...(id.name ? { full_name: id.name } : {}), ...(id.domain ? { domain: id.domain } : {}), ...(id.profileUrl ? { linkedin_url: id.profileUrl } : {}) };
		maxCostUsd = op.tregRouteMaxCostUsd ?? 0.15;
		spec = { operation: 'treg.people.email.find', endpoint: 'treg.people.email.find', method: 'POST', body: input as Json, maxCostUsd, routeWaterfall };
		resultKey = ['email', 'work_email', 'workEmail', 'professional_email'];
	} else if (op.kind === 'phone-enrichment') {
		const possibleEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id.email) ? id.email : '';
		if (!id.profileUrl && !possibleEmail && !(id.name && id.domain)) throw inputError('Treg phone lookup needs a LinkedIn URL, valid work email, or a person name with company domain.', 'treg');
		input = { ...(id.profileUrl ? { linkedin_url: id.profileUrl } : {}), ...(possibleEmail ? { email: possibleEmail } : {}), ...(id.name ? { full_name: id.name } : {}), ...(id.domain ? { domain: id.domain } : {}) };
		maxCostUsd = op.tregRouteMaxCostUsd ?? 0.90;
		spec = { operation: 'treg.people.phone.find', endpoint: 'treg.people.phone.find', method: 'POST', body: input as Json, maxCostUsd, routeWaterfall };
		resultKey = ['phone', 'mobile', 'mobile_phone', 'phone_number', 'phoneNumber', 'direct_phone'];
	} else {
		if (!id.name) throw inputError('Treg social search needs a person name.', 'treg');
		input = { name: id.name, company: id.company, domain: id.domain, platform: op.platform };
		const hosts: Record<SocialPlatform, string> = { linkedin: 'linkedin.com/in', instagram: 'instagram.com', facebook: 'facebook.com', x: 'x.com OR site:twitter.com', tiktok: 'tiktok.com', youtube: 'youtube.com/@ OR site:youtube.com/channel' };
		const site = hosts[op.platform];
		const query = [id.name, id.company, id.domain, `site:${site}`].filter(Boolean).join(' ');
		maxCostUsd = op.tregRouteMaxCostUsd ?? 0.16;
		spec = { operation: 'treg.web.search', endpoint: 'treg.web.search', method: 'POST', body: { q: query, limit: 8 }, maxCostUsd, routeWaterfall };
		resultKey = ['url', 'link', 'profile_url', 'profileUrl', 'href'];
	}
	try {
		const { data, meta } = await callTreg(access, spec, input, key, options.signal);
		const wrapped = obj(data);
		const output = wrapped.output ?? wrapped.result ?? wrapped.data ?? data;
		const extracted = op.kind === 'social-enrichment'
			? (Array.isArray(obj(output).results) ? (obj(output).results as unknown[]).map((entry) => nestedString(entry, resultKey)).find((url) => url && isSocialProfileFor(url, op.platform as SocialPlatform)) ?? '' : '')
			: nestedString(output, resultKey);
		const value = op.kind === 'social-enrichment' ? (extracted && isSocialProfileFor(extracted, op.platform as SocialPlatform) ? extracted : null) : extracted || null;
		const normalized = makeMeta(meta.tregRuns![0], data);
		const detail = op.kind === 'email-enrichment' ? 'Treg returned a work email.' : op.kind === 'phone-enrichment' ? 'Treg returned a phone number.' : `Treg searched ${op.platform} for a public profile.`;
		return { value: value as CellValue, meta: { ...normalized, reasoning: value ? detail : `Treg completed the lookup but returned no ${op.kind === 'email-enrichment' ? 'email' : op.kind === 'phone-enrichment' ? 'phone number' : 'matching profile'}.` } };
	} catch (error) {
		if (error instanceof TregCallError) throw new TregCallError(error.message, error.failure, withRetryMeta(error.meta, key), key);
		throw error;
	}
}

export const isTregIdempotencyKeyReusable = (meta: CellMeta | undefined, now = Date.now()) => Boolean(meta?.tregIdempotencyKey && meta.tregIdempotencyCreatedAt && now - meta.tregIdempotencyCreatedAt <= IDEMPOTENCY_WINDOW_MS);

export async function tregRequest(token: string, path: string, init: RequestInit = {}) {
	const url = new URL(path, API);
	if (url.origin !== API || !path.startsWith('/')) throw new Error('Invalid Treg API path.');
	const headers = new Headers(init.headers);
	headers.set('X-Treg-Token', token);
	if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
	const response = await fetch(url, { ...init, headers, cache: 'no-store', signal: init.signal ?? AbortSignal.timeout(25_000) });
	const body = await jsonResponse(response);
	if (!response.ok) {
		const message = str(obj(body).detail ?? obj(body).error ?? obj(body).message) || `Treg request failed (${response.status}).`;
		throw responseFailure(response.status, message);
	}
	return body;
}

export function tregBalanceUsd(data: unknown): number | undefined {
	const root = obj(data), billing = obj(root.billing), balance = obj(root.balance), organization = obj(root.organization), wallet = obj(root.wallet);
	for (const value of [root.balance_usd, root.balanceUsd, billing.balance_usd, billing.balanceUsd, organization.balance_usd, organization.balanceUsd, wallet.balance_usd, wallet.balanceUsd, balance.usd, balance.value, root.balance, billing.balance]) {
		const number = typeof value === 'number' ? value : Number(value);
		if (value !== undefined && value !== null && Number.isFinite(number)) return number;
	}
	const micro = root.balance_micro_usd ?? root.balanceMicroUsd ?? billing.balance_micro_usd ?? organization.balance_micro_usd ?? wallet.balance_micro_usd ?? balance.micro_usd;
	const parsedMicro = typeof micro === 'number' ? micro : Number(micro);
	return micro !== undefined && Number.isFinite(parsedMicro) ? parsedMicro / 1_000_000 : undefined;
}

export function tregTopupDefaultUsd(data: unknown): number | undefined {
	const topup = obj(obj(data).topup);
	const value = Number(topup.default_usd ?? topup.default_amount_usd ?? topup.suggested_usd ?? topup.amount_usd);
	return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function tregCheckoutUrl(data: unknown): string | undefined {
	const raw = str(obj(data).checkout_url ?? obj(data).url ?? obj(obj(data).checkout).url);
	try {
		const url = new URL(raw);
		return url.protocol === 'https:' && ['checkout.stripe.com', 'billing.stripe.com'].includes(url.hostname) ? url.toString() : undefined;
	} catch { return undefined; }
}
