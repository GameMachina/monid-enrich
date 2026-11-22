import 'server-only';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { wrapLanguageModel, type LanguageModelMiddleware } from 'ai';
import type ContextDev from 'context.dev';
import type { z } from 'zod';
import { SELF_HOSTED_ISSUER, type Account } from '../auth-identity';
import { DECISIONS_CLASSIFIER, MODEL_ID, PROVIDERS, type OrganizationPreferences, type Provider, type ProviderAlias } from '../organization-settings';
import { DEFAULT_MODEL, type Decider, type FailureProvider } from '../types';
import { readSession, SESSION_COOKIE } from './auth';
import { contextClient } from './context';
import { failureOf, newTrace } from './api-route';
import type { LedgerAccess } from './credit-ledger';
import { clean, CredentialError, ensureSafeEndpoint, jsonError, redactError, safeBaseUrl } from './credentials';
import { classifyFailure, failure, Spend, spendMiddleware } from './enrich-failure';
import { openaiModel } from './openai';
import type { Jev } from './typesafe-trial';
import { DEFAULT_ALLOWED_PHONE_PROVIDERS, type PhoneProvider } from '../phone-strategy';
import { withDatabase } from './database';
import { OrganizationStore, organizationPersistenceEnabled } from './organization-store';
import { localCredentialVault } from './local-credential-store';

/* Provider access resolves only an explicit verification key or the encrypted workspace vault. */

export const SOURCES = ['request', 'vault', 'connection', 'server', 'trial'] as const;
export type Source = typeof SOURCES[number];

/** Which sources a caller may draw on, and whether a malformed request override is rejected or ignored. */
export interface AccessPolicy { sources: readonly Source[]; strict: boolean }
export const BROWSER_POLICY: AccessPolicy = { sources: ['request', 'vault'], strict: false };
/** MCP callers hold only an organization API key: never browser cookies, deployment keys or the sponsored trial. */
export const MCP_POLICY: AccessPolicy = { sources: ['request', 'vault'], strict: true };

/** Per-provider server wiring. Keyed by Provider, so a provider added to PROVIDERS does not compile until wired here.
    `refuses`: the statuses a provider answers without processing a request, when not just 429. */
const PROVIDER_INFO: Record<ProviderAlias, { label: string; failure: FailureProvider; refuses?: readonly number[] }> = {
	openai: { label: 'OpenAI', failure: 'openai' },
	monid: { label: 'Monid', failure: 'monid' },
	context: { label: 'Monid', failure: 'monid' },
	typesafe: { label: 'Monid', failure: 'monid' },
	hunter: { label: 'Monid', failure: 'monid' },
	prospeo: { label: 'Monid', failure: 'monid' },
	quickenrich: { label: 'Monid', failure: 'monid' },
	apollo: { label: 'Monid', failure: 'monid' },
	contactout: { label: 'Monid', failure: 'monid' },
};
const OPENAI_API = 'https://api.openai.com/v1';

type Keys = Partial<Record<Provider, string>>;
export interface Vault { keys: Keys; preferences: Partial<Pick<OrganizationPreferences, 'model' | 'classifierModel' | 'openaiBaseUrl' | 'preferJev' | 'mobilePhoneProviders'>>; contextUserEmail?: string }
/** Deployment configuration. Keys count only when `unlocked`; the trials use the OpenAI and TypeSafe keys regardless. */
export interface ServerEnv { unlocked: boolean; keys: Keys; model?: string | null; baseUrl?: string | null; trial: boolean; typesafeTrial?: boolean }
/** Everything the gathering I/O found. The resolver ignores what the policy excludes. */
export interface AccessInputs {
	/** Verified actor; never supplied by request JSON. */
	account?: Account;
	headers: Headers;
	vault?: Vault | null;
	connection?: string | null;
	/** Workspace-controlled Monid routes allowed for mobile-phone operations. */
	allowedPhoneProviders?: PhoneProvider[];
	server?: ServerEnv;
}

/** What a caller resolved to. Plain data, so tests can build one directly. */
export interface AccessGrant {
	account?: Account;
	allowedPhoneProviders?: PhoneProvider[];
	contextUserEmail?: string;
	keys: Keys;
	model?: string;
	classifierModel?: string;
	openaiBaseUrl?: string | null;
	/** OpenAI runs on the deployment key, metered against this organization's trial budget. */
	trialAccount?: Account;
	/** TypeSafe runs on the deployment key, metered against this organization's TypeSafe trial budget. */
	typesafeTrialAccount?: Account;
	preferJev?: boolean;
}

type Offer = { keys?: Partial<Record<Provider, string | null>>; model?: string | null; classifier?: string | null; endpoint?: string | null; preferJev?: boolean | null; contextUserEmail?: string };
type Found<T> = { source: Source; value: T } | null;

const invalidOverride = () => new CredentialError('Invalid provider credential headers.', 400);
const validModel = (value: string) => value.length <= 100 && MODEL_ID.test(value);

/** What each permitted source offers, in precedence order. */
function offers(policy: AccessPolicy, { headers, vault, server }: AccessInputs): Array<[Source, Offer]> {
	const header = (name: string) => headers.get(name)?.trim() || null;
	const requestKey = (provider: Provider) => {
		const raw = header(`x-${provider}-key`);
		if (!raw || clean(raw)) return raw;
		if (policy.strict) throw invalidOverride();
		return null;
	};
	const table: Record<Source, Offer> = {
		request: { keys: Object.fromEntries(PROVIDERS.map((provider) => [provider, requestKey(provider)])), model: header('x-openai-model'), classifier: header('x-classifier-model'), endpoint: header('x-openai-base-url'), preferJev: false },
		vault: vault ? { keys: vault.keys, model: vault.preferences.model, classifier: vault.preferences.classifierModel, endpoint: vault.preferences.openaiBaseUrl, preferJev: vault.preferences.preferJev, contextUserEmail: vault.contextUserEmail } : {},
		connection: {},
		server: server ? { keys: server.unlocked ? server.keys : {}, model: server.model, endpoint: server.unlocked ? safeBaseUrl(server.baseUrl) : null } : {},
		trial: {},
	};
	const permitted = new Set(policy.sources);
	return SOURCES.filter((source) => permitted.has(source)).map((source) => [source, table[source]]);
}

function first<T>(rows: Array<[Source, Offer]>, pick: (offer: Offer) => T | null | undefined): Found<T> {
	for (const [source, offer] of rows) {
		const value = pick(offer);
		if (value !== null && value !== undefined && value !== '') return { source, value };
	}
	return null;
}

/** Pure precedence: the highest permitted source wins per setting. Throws CredentialError for unusable combinations. */
export function resolveGrant(policy: AccessPolicy, inputs: AccessInputs): AccessGrant {
	const rows = offers(policy, inputs);
	const { account } = inputs;
	const keys: Keys = {};
	for (const provider of PROVIDERS) {
		const key = first(rows, (offer) => offer.keys?.[provider]);
		if (key) keys[provider] = key.value;
	}
	const openai = first(rows, (offer) => offer.keys?.openai);
	const typesafeTrialAccount = undefined;
	const modelId = (found: Found<string>) => {
		if (!found || validModel(found.value)) return found?.value;
		if (policy.strict && found.source === 'request') throw invalidOverride();
		return undefined;
	};
	const model = modelId(first(rows, (offer) => offer.model)) ?? DEFAULT_MODEL;
	const classifier = modelId(first(rows, (offer) => offer.classifier));
	const requested = first(rows, (offer) => offer.endpoint);
	const endpoint = requested ? safeBaseUrl(requested.value) : null;
	if (requested && !endpoint) throw new CredentialError('The OpenAI base URL must be a public http(s) URL.', 400);
	const preferJev = false;
	const contextUserEmail = first(rows, (offer) => offer.contextUserEmail)?.value ?? account?.user.email;
	// A key goes only to its own source's endpoint unless the caller supplies the key too.
	if (openai && requested && SOURCES.indexOf(requested.source) < SOURCES.indexOf(openai.source)) {
		const own = safeBaseUrl(rows.find(([source]) => source === openai.source)?.[1].endpoint) ?? OPENAI_API;
		if (endpoint !== own) throw new CredentialError(`Supply an explicit OpenAI key when overriding the ${openai.source === 'vault' ? 'organization' : 'server'} provider endpoint.`, 400);
	}
	return { account, allowedPhoneProviders: inputs.allowedPhoneProviders ?? [...DEFAULT_ALLOWED_PHONE_PROVIDERS], contextUserEmail, keys, model, classifierModel: classifier && classifier !== DECISIONS_CLASSIFIER ? classifier : undefined, openaiBaseUrl: endpoint, typesafeTrialAccount, preferJev };
}

/** What every provider caller gets. */
export interface ProviderAccess {
	readonly account?: Account;
	readonly allowedPhoneProviders: readonly PhoneProvider[];
	/** Who Context.dev usage is attributed to. */
	readonly contextUserEmail?: string;
	/** Main model id; the trial model when OpenAI is sponsored. */
	readonly model: string;
	/** Independent decision model; undefined means the decision default. */
	readonly classifierModel?: string;
	/** OpenAI calls are metered against the organization's trial budget. */
	readonly trial: boolean;
	/** TypeSafe decisions are metered against the organization's TypeSafe trial budget. */
	readonly typesafeTrial: boolean;
	/** What this access's clients spent. A run takes its own (`withSpend`), so its failures know whether it paid. */
	readonly spend: Spend;
	/** The same access, its clients recording into `spend`. */
	withSpend(spend: Spend): ProviderAccess;
	/** The raw key, or null. Direct provider calls go through `fetch`, so their spend is recorded. */
	key(provider: ProviderAlias): string | null;
	/** The key, or a credential_missing CredentialError naming the provider. */
	requireKey(provider: ProviderAlias): string;
	/** An OpenAI model on the resolved endpoint; spend tracking, trial metering and the endpoint guard run inside. */
	openai(model?: string): LanguageModelV4;
	/** A Context.dev client attributed to contextUserEmail. */
	context(): ContextDev;
	/** A TypeSafe client; on the TypeSafe trial every decision is metered. */
	typesafe(): Jev;
	/** A fetch for providers reached over plain HTTP: the email providers, and the included enrichment service (no provider). */
	fetch(provider?: ProviderAlias): typeof fetch;
	/** The engine a decision column should prefer: a classifier model or the caller's preference can force OpenAI. */
	decider(requested?: Decider): Decider;
	/** Fails early when the OpenAI endpoint is unsafe. Memoized; every OpenAI request awaits it too. */
	checkEndpoint(): Promise<void>;
	/** The OpenAI base URL (null for the default), only after the endpoint guard passes. */
	openaiEndpoint(): Promise<string | null>;
	/** Error text with every resolved key redacted, safe for cells and streams. */
	redact(error: unknown): string;
}

/** Replaceable SDK edges, so tests can back an access with in-memory fakes. A fake Context.dev client sends no requests,
    so it records no spend. */
export interface AccessAdapters {
	openai?: typeof openaiModel;
	context?: typeof contextClient;
	lookup?: (host: string) => Promise<Array<{ address: string }>>;
	/** The TypeSafe trial ledger; Neon by default. */
	typesafeLedger?: LedgerAccess;
}

export function providerAccess(grant: AccessGrant, adapters: AccessAdapters = {}): ProviderAccess {
	const keys = grant.keys;
	const model = grant.model ?? DEFAULT_MODEL;
	const contextUserEmail = grant.contextUserEmail ?? grant.account?.user.email;
	let checked: Promise<void> | undefined;
	const checkEndpoint = () => checked ??= ensureSafeEndpoint(grant.openaiBaseUrl, adapters.lookup);
	const providerKey = (provider: ProviderAlias): Provider => provider === 'openai' ? 'openai' : 'monid';
	const requireKey = (provider: ProviderAlias) => {
		const key = keys[providerKey(provider)];
		if (!key) throw new CredentialError(`Add your ${PROVIDER_INFO[provider].label} API key in Configuration to run this column.`, 401, 'credential_missing', PROVIDER_INFO[provider].failure);
		return key;
	};
	const guard: LanguageModelMiddleware = { specificationVersion: 'v4', wrapGenerate: async ({ doGenerate }) => { await checkEndpoint(); return doGenerate(); }, wrapStream: async ({ doStream }) => { await checkEndpoint(); return doStream(); } };
	const build = (spend: Spend): ProviderAccess => ({
		account: grant.account, allowedPhoneProviders: grant.allowedPhoneProviders ?? [...DEFAULT_ALLOWED_PHONE_PROVIDERS], contextUserEmail, model, classifierModel: grant.classifierModel, trial: Boolean(grant.trialAccount), typesafeTrial: Boolean(grant.typesafeTrialAccount),
		spend,
		withSpend: build,
		key: (provider) => keys[providerKey(provider)] ?? null,
		requireKey,
		openai(requested) {
			const built = (adapters.openai ?? openaiModel)(requireKey('openai'), requested ?? model, grant.openaiBaseUrl ?? null, grant.trialAccount);
			return wrapLanguageModel({ model: built, middleware: grant.openaiBaseUrl ? [spendMiddleware(spend), guard] : spendMiddleware(spend) });
		},
		context: () => (adapters.context ?? contextClient)(requireKey('monid'), contextUserEmail, spend, grant.account),
		typesafe: () => { throw new CredentialError('TypeSafe decision columns are no longer supported. Add your OpenAI key to use reasoning columns.', 400, 'credential_missing', 'openai'); },
		fetch: () => { throw new CredentialError('Direct vendor requests are disabled. Use the Monid provider adapter.', 500, 'provider_error', 'monid'); },
		decider: () => 'openai',
		checkEndpoint,
		openaiEndpoint: async () => { await checkEndpoint(); return grant.openaiBaseUrl ?? null; },
		redact: (error) => redactError(error, Object.values(keys)),
	});
	return build(new Spend());
}

export const resolveAccess = (policy: AccessPolicy, inputs: AccessInputs) => providerAccess(resolveGrant(policy, inputs));

/* ───────────── Gathering I/O: read only what each policy may use ───────────── */

const vaultOf = ({ keys, settings, contextUserEmail }: Awaited<ReturnType<OrganizationStore['credentials']>>): Vault => ({ keys, preferences: settings.preferences, contextUserEmail });

function requestAccount(request: Request) {
	const cookie = (request.headers.get('cookie') ?? '').split(';').map((entry) => entry.trim()).find((entry) => entry.startsWith(`${SESSION_COOKIE}=`));
	return readSession(cookie?.slice(SESSION_COOKIE.length + 1)) ?? undefined;
}

export async function browserInputs(request: Request): Promise<AccessInputs> {
	const account = requestAccount(request);
	if (organizationPersistenceEnabled(account)) {
		const stored = await withDatabase((database) => new OrganizationStore(database).credentials(account!));
		return { account, headers: request.headers, vault: vaultOf(stored), allowedPhoneProviders: stored.settings.preferences.mobilePhoneProviders };
	}
	if (account?.issuer === SELF_HOSTED_ISSUER) {
		const [vault, organization] = await Promise.all([
			localCredentialVault(account),
			withDatabase((database) => new OrganizationStore(database).get(account)),
		]);
		return { account, headers: request.headers, vault: { keys: vault.keys, preferences: organization.preferences }, allowedPhoneProviders: organization.preferences.mobilePhoneProviders };
	}
	return { account, headers: request.headers, vault: null };
}

/** MCP inputs never include cookies or deployment configuration. */
export async function mcpInputs(headers: Headers, actor: Account, organization?: OrganizationStore): Promise<AccessInputs> {
	if (!organization) return { account: actor, headers, vault: null };
	const stored = await organization.credentials(actor);
	return { account: actor, headers, vault: vaultOf(stored), allowedPhoneProviders: stored.settings.preferences.mobilePhoneProviders };
}

export const browserAccess = async (request: Request) => resolveAccess(BROWSER_POLICY, await browserInputs(request));
export const mcpAccess = async (headers: Headers, actor: Account, organization?: OrganizationStore) => resolveAccess(MCP_POLICY, await mcpInputs(headers, actor, organization));

/** What the browser policy resolves without request overrides, so the client knows whether it must ask for keys. */
export async function serverKeyAvailability(request: Request) {
	const inputs = await browserInputs(request);
	const rows = offers(BROWSER_POLICY, { ...inputs, headers: new Headers() });
	const available = Object.fromEntries(PROVIDERS.map((provider) => [provider, Boolean(first(rows, (offer) => offer.keys?.[provider]))])) as Record<Provider, boolean>;
	const { vault } = inputs;
	return {
		...available,
		monidSaved: Boolean(vault?.keys.monid),
		openaiSaved: Boolean(vault?.keys.openai),
		enrichmentTrial: false,
		openaiTrial: undefined,
		openai: available.openai,
		monid: available.monid,
		typesafeTrial: false,
		typesafe: false,
		context: available.monid,
		contextConnected: false,
	};
}

/* ───────────── Route preamble ───────────── */

/** Browser provider access with the OpenAI endpoint already checked, or the error response. */
export async function routeAccess(request: Request): Promise<ProviderAccess | Response> {
	try {
		const access = await browserAccess(request);
		await access.checkEndpoint();
		return access;
	} catch (error) {
		if (error instanceof CredentialError) return jsonError(error.message, error.status, error.failure);
		// Anything other than a credential problem is the server's own storage or configuration failing.
		const { status, error: message } = failureOf(error, newTrace('provider-access'));
		return jsonError(message, status, classifyFailure(error) ?? failure('provider_error', undefined, true));
	}
}

/** Parses the JSON body against `schema`, then resolves provider access. Every failure is a ready response. */
export async function routeInput<S extends z.ZodType>(request: Request, schema: S): Promise<{ input: z.output<S>; access: ProviderAccess } | Response> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return jsonError('Invalid JSON body', 400, failure('input_invalid'));
	}
	const parsed = schema.safeParse(body);
	if (!parsed.success) return jsonError(`Invalid request: ${parsed.error.issues[0]?.message ?? 'bad input'}`, 400, failure('input_invalid'));
	const access = await routeAccess(request);
	return access instanceof Response ? access : { input: parsed.data, access };
}
