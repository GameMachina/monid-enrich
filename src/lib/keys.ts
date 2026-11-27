'use client';

import { DEFAULT_MODEL } from './types';
import { accountHeaders, accountStorageKey } from './account-storage';
import { PROVIDERS, providerField, type OrganizationSettings, type Provider } from './organization-settings';
import { DEFAULT_ALLOWED_PHONE_PROVIDERS, type PhoneProvider } from './phone-strategy';

/* Saved API keys live in the server vault. The browser keeps public preferences and sends a raw key only while the user
 * is entering or explicitly verifying it. Older localStorage keys are migrated once and removed. */

export interface Settings {
	companyDomain?: string;
	openaiKey: string;
	monidKey: string;
	tregKey: string;
	/** Legacy fields are only retained to clear old browser settings during migration. */
	contextKey: string;
	typesafeKey: string;
	hunterKey: string;
	quickenrichKey: string;
	apolloKey: string;
	contactoutKey: string;
	prospeoKey: string;
	/** Retained for old settings migration; the standalone app does not use a remote logo service. */
	logolinkKey: string;
	model: string;
	/** Decisions API by default; otherwise an independent OpenAI model ID. */
	classifierModel: string;
	/** Optional OpenAI-compatible base URL (Azure, a proxy, a local server). Uses the Chat Completions API. */
	openaiBaseUrl: string;
	concurrency: number;
	/** When true, check/classify/score columns prefer Jev; otherwise OpenAI. */
	preferJev: boolean;
	/** Workspace-level allowlist for mobile enrichment providers, all routed through Monid. */
	 mobilePhoneProviders: PhoneProvider[];
}

const STORAGE_KEY = 'enrichable.settings.v1';
const listeners = new Set<() => void>();
const publish = () => { for (const listener of listeners) listener(); };

export const DEFAULT_SETTINGS: Settings = { openaiKey: '', monidKey: '', tregKey: '', contextKey: '', typesafeKey: '', hunterKey: '', quickenrichKey: '', apolloKey: '', contactoutKey: '', prospeoKey: '', logolinkKey: '', model: DEFAULT_MODEL, classifierModel: 'decisions', openaiBaseUrl: '', concurrency: 4, preferJev: false, mobilePhoneProviders: [...DEFAULT_ALLOWED_PHONE_PROVIDERS] };
const publicFields = ['model', 'classifierModel', 'openaiBaseUrl', 'concurrency', 'preferJev', 'companyDomain', 'mobilePhoneProviders'] as const;
let localWorkspaceRevision = 0;

// Browser-local adapter.
let cached: Settings | null = null;
let cachedStorageKey: string | null = null;
let cachedRaw: string | null = null;

function loadLocalSettings(): Settings {
	if (typeof window === 'undefined') return DEFAULT_SETTINGS;
	try {
		const key = accountStorageKey(STORAGE_KEY);
		const raw = window.localStorage.getItem(key);
		if (cached && cachedStorageKey === key && cachedRaw === raw) return cached;
		const saved = raw ? JSON.parse(raw) as Partial<Settings> : {};
		cached = { ...DEFAULT_SETTINGS, ...saved, openaiKey: '', monidKey: '', tregKey: '', contextKey: '', typesafeKey: '', hunterKey: '', quickenrichKey: '', apolloKey: '', contactoutKey: '', prospeoKey: '', logolinkKey: '', classifierModel: saved.classifierModel || saved.model || DEFAULT_MODEL, preferJev: false };
		cachedStorageKey = key;
		cachedRaw = raw;
		return cached;
	} catch {
		// Account initialization and temporary storage failures must not cache empty keys.
		return DEFAULT_SETTINGS;
	}
}

/** Read secrets from the pre-vault browser version only long enough to migrate them to the server. */
function readLegacyLocalSettings(): Partial<Settings> {
	if (typeof window === 'undefined') return {};
	try {
		const raw = window.localStorage.getItem(accountStorageKey(STORAGE_KEY));
		return raw ? JSON.parse(raw) as Partial<Settings> : {};
	} catch { return {}; }
}

function clearLegacyLocalSecrets(preferences: Partial<Settings>) {
	try {
		const safe: Partial<Settings> = Object.fromEntries(publicFields.flatMap((field) => preferences[field] === undefined ? [] : [[field, preferences[field]]])) as Partial<Settings>;
		window.localStorage.removeItem(accountStorageKey(STORAGE_KEY));
		if (Object.keys(safe).length) saveLocalSettings(safe);
	} catch { /* The encrypted server copy is already saved; never put secrets back in local storage. */ }
}

function saveLocalSettings(patch: Partial<Settings>) {
	const next = { ...loadLocalSettings(), ...patch, openaiKey: '', monidKey: '', tregKey: '', contextKey: '', typesafeKey: '', hunterKey: '', quickenrichKey: '', apolloKey: '', contactoutKey: '', prospeoKey: '', logolinkKey: '' };
	const key = accountStorageKey(STORAGE_KEY);
	const raw = JSON.stringify(next);
	window.localStorage.setItem(key, raw);
	cached = next;
	cachedStorageKey = key;
	cachedRaw = raw;
	publish();
}

// Organization adapter. A failed load is retryable: it never caches the rejected request.
type OrganizationState =
	| { kind: 'off' }
	| { kind: 'loading'; promise: Promise<boolean> }
	| { kind: 'failed'; error: string }
	| { kind: 'loaded'; organization: OrganizationSettings; snapshot: Settings };
let organizationState: OrganizationState = { kind: 'off' };
let pendingSave: Promise<unknown> = Promise.resolve();

export function loadSettings(): Settings {
	if (organizationState.kind === 'off') return loadLocalSettings();
	// Never fall back to browser secrets while the organization vault is loading or unavailable.
	return organizationState.kind === 'loaded' ? organizationState.snapshot : DEFAULT_SETTINGS;
}

async function saveStandaloneCredentials(patch: Partial<Settings>) {
	const providers: Record<string, string | null> = {};
	if (patch.monidKey !== undefined) providers.monid = patch.monidKey.trim() || null;
	if (patch.openaiKey !== undefined) providers.openai = patch.openaiKey.trim() || null;
	if (!Object.keys(providers).length) return;
	const response = await fetch('/api/local-connections', { method: 'POST', headers: { ...accountHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ providers }), cache: 'no-store' });
	if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Could not save this connection securely on the server.');
}

export async function saveSettings(patch: Partial<Settings>) {
	if (organizationState.kind !== 'off') return saveOrganizationSettings(patch);
	await saveStandaloneCredentials(patch);
	if (patch.mobilePhoneProviders !== undefined) {
		const local = await organizationRequest('PATCH', { revision: localWorkspaceRevision, preferences: { mobilePhoneProviders: patch.mobilePhoneProviders } });
		if (!local.local) throw new Error('The workspace settings storage changed. Reload before saving.');
		localWorkspaceRevision = local.revision;
	}
	saveLocalSettings(patch);
}

export function subscribeSettings(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Headers for calls to this app's API routes. */
export function keyHeaders(settings: Settings = loadSettings()): Record<string, string> {
	const headers: Record<string, string> = { 'content-type': 'application/json', ...accountHeaders() };
	if (settings.openaiKey) headers['x-openai-key'] = settings.openaiKey;
	if (settings.monidKey) headers['x-monid-key'] = settings.monidKey;
	if (settings.model) headers['x-openai-model'] = settings.model;
	if (settings.classifierModel) headers['x-classifier-model'] = settings.classifierModel;
	if (settings.openaiBaseUrl) headers['x-openai-base-url'] = settings.openaiBaseUrl;
	return headers;
}

export function maskKey(key: string): string {
	if (!key) return '';
	if (key.length <= 10) return '•'.repeat(key.length);
	return `${key.slice(0, 7)}${'•'.repeat(12)}${key.slice(-4)}`;
}

export const organizationSettingsEnabled = () => organizationState.kind !== 'off';
export const organizationSettingsSnapshot = () => organizationState.kind === 'loaded' ? organizationState.organization : null;

function publishOrganization(organization: OrganizationSettings) {
	organizationState = { kind: 'loaded', organization, snapshot: { ...DEFAULT_SETTINGS, ...organization.preferences } };
	publish();
}
function loadedOrganization() {
	if (organizationState.kind !== 'loaded') throw new Error('Workspace settings are still loading. Try again in a moment.');
	return organizationState.organization;
}
async function organizationRequest(method: string, body?: unknown) {
	const response = await fetch('/api/organization-settings', { method, headers: { ...accountHeaders(), 'Content-Type': 'application/json' }, cache: 'no-store', ...(body ? { body: JSON.stringify(body) } : {}) });
	if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || (method === 'PATCH' ? 'Could not save workspace settings.' : 'Could not load workspace settings.'));
	return await response.json() as OrganizationSettings & { local?: boolean };
}

export function initializeOrganizationSettings(): Promise<boolean> {
	if (organizationState.kind === 'loading') return organizationState.promise;
	if (organizationState.kind === 'loaded') return Promise.resolve(true);
	const promise = connectOrganization(readLegacyLocalSettings()).catch((error: unknown) => {
		organizationState = { kind: 'failed', error: error instanceof Error ? error.message : 'Could not load workspace settings.' };
		publish();
		throw error;
	});
	organizationState = { kind: 'loading', promise };
	publish();
	return promise;
}
async function connectOrganization(previous: Partial<Settings>) {
	const data = await organizationRequest('GET');
		if (data.local) {
			if (previous.monidKey || previous.openaiKey) await saveStandaloneCredentials({ monidKey: previous.monidKey, openaiKey: previous.openaiKey });
		clearLegacyLocalSecrets(previous);
		localWorkspaceRevision = data.revision ?? 0;
		if (data.revision === 0 && previous.mobilePhoneProviders) {
			const migrated = await organizationRequest('PATCH', { revision: data.revision, preferences: { mobilePhoneProviders: previous.mobilePhoneProviders } });
			localWorkspaceRevision = migrated.revision;
			saveLocalSettings({ mobilePhoneProviders: migrated.preferences.mobilePhoneProviders });
		} else if (data.preferences?.mobilePhoneProviders) {
			saveLocalSettings({ mobilePhoneProviders: data.preferences.mobilePhoneProviders });
		}
		organizationState = { kind: 'off' }; publish(); return false;
	}
	const providers = Object.fromEntries([
		...(!data.providers.monid?.configured && previous.monidKey ? [['monid', previous.monidKey]] : []),
		...(!data.providers.openai?.configured && previous.openaiKey ? [['openai', previous.openaiKey]] : []),
	]) as Partial<Record<'monid' | 'openai', string>>;
	const preferences = Object.fromEntries(publicFields.flatMap((field) => previous[field] === undefined ? [] : [[field, previous[field]]])) as Partial<Settings>;
	const migrated = Object.keys(providers).length || Object.keys(preferences).length
		? await organizationRequest('PATCH', { revision: data.revision, providers, preferences })
		: data;
	clearLegacyLocalSecrets(previous);
	publishOrganization(migrated);
	return true;
}

/** Reloads organization settings; after a failed first load this retries the whole initialization. */
export async function refreshOrganizationSettings() {
	if (organizationState.kind === 'failed') { await initializeOrganizationSettings(); return; }
	if (organizationState.kind === 'loading') { await organizationState.promise; return; }
	if (organizationState.kind !== 'loaded') return;
	await pendingSave.catch(() => {});
	publishOrganization(await organizationRequest('GET'));
}

export function saveOrganizationSettings(patch: Partial<Settings>, expectedRevision?: number) {
	const save = pendingSave.catch(() => {}).then(async () => {
		const organization = loadedOrganization();
		const preferences = Object.fromEntries(publicFields.filter((field) => patch[field] !== undefined).map((field) => [field, patch[field]]));
		const providers = Object.fromEntries(PROVIDERS.flatMap((provider) => { const field = providerField[provider]; return patch[field]?.trim() ? [[provider, patch[field]!.trim()]] : []; }));
		try { publishOrganization(await organizationRequest('PATCH', { revision: expectedRevision ?? organization.revision, preferences, providers })); }
		catch (error) { await refreshAfterConflict(); throw error; }
	});
	pendingSave = save;
	return save.then(() => undefined);
}
async function refreshAfterConflict() {
	try { publishOrganization(await organizationRequest('GET')); } catch {}
}

export async function disconnectOrganizationProvider(provider: Provider) {
	await pendingSave.catch(() => {});
	const organization = loadedOrganization();
	publishOrganization(await organizationRequest('PATCH', { revision: organization.revision, providers: { [provider]: null } }));
}
