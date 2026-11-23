import 'server-only';

import { tregRequest } from './treg';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (...values: unknown[]) => values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim() ?? '';
const bool = (value: unknown) => typeof value === 'boolean' ? value : undefined;
const safeHttpsUrl = (value: unknown) => {
	const raw = text(value);
	try {
		const url = new URL(raw);
		return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : '';
	} catch { return ''; }
};

export type TregConnectionProvider = {
	service: string;
	displayName: string;
	category: string;
	summary: string;
	authKind: string;
	enabled?: boolean;
	configured?: boolean;
	tokenLabel: string;
	tokenPlaceholder: string;
	setupUrl: string;
	setupActionLabel: string;
	setupSteps: string[];
	setupNote: string;
	needsExtraCredential: boolean;
	extraCredentialLabel: string;
	extraCredentialNote: string;
	capability: string;
	resourceLabel: string;
	resourcePlural: string;
};

export function normalizeTregProviderDirectory(value: unknown): TregConnectionProvider[] {
	const root = record(value);
	const rows = Array.isArray(value) ? value : Array.isArray(root.providers) ? root.providers : [];
	return rows.flatMap((entry) => {
		const item = record(entry);
		const service = text(item.service, item.provider, item.id).toLowerCase();
		if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(service)) return [];
		const setupSteps = Array.isArray(item.setup_steps) ? item.setup_steps.filter((step): step is string => typeof step === 'string').slice(0, 8) : [];
		return [{
			service,
			displayName: text(item.display_name, item.name, service),
			category: text(item.category, 'Other'),
			summary: text(item.summary, item.description),
			authKind: text(item.auth_kind, item.authKind, 'key').toLowerCase(),
			...(bool(item.enabled) !== undefined ? { enabled: bool(item.enabled) } : {}),
			...(bool(item.configured) !== undefined ? { configured: bool(item.configured) } : {}),
			tokenLabel: text(item.token_label, 'API key'),
			tokenPlaceholder: text(item.token_placeholder, 'Paste your API key'),
			setupUrl: safeHttpsUrl(item.setup_url ?? item.setupUrl),
			setupActionLabel: text(item.setup_action_label, 'Get an API key'),
			setupSteps,
			setupNote: text(item.setup_note),
			needsExtraCredential: item.needs_extra_credential === true,
			extraCredentialLabel: text(item.extra_credential_label, 'Additional credential'),
			extraCredentialNote: text(item.extra_credential_note),
			capability: text(item.connect_default_capability, item.default_capability),
			resourceLabel: text(item.resource_label),
			resourcePlural: text(item.resource_plural),
		}];
	});
}

export function normalizeTregConnections(value: unknown) {
	const root = record(value);
	const rows = Array.isArray(value) ? value : Array.isArray(root.connections) ? root.connections : [];
	return rows.flatMap((entry) => {
		const item = record(entry);
		const secretId = Number(item.secret_id ?? item.secretId ?? item.id);
		const service = text(item.service, item.provider, item.provider_id).toLowerCase();
		if (!Number.isSafeInteger(secretId) || secretId <= 0 || !service) return [];
		return [{
			secretId,
			service,
			displayName: text(item.display_name, item.provider_display, item.name, service),
			name: text(item.connection_name, item.account_name, item.name, item.identity),
			category: text(item.category),
			authKind: text(item.auth_kind, item.kind).toLowerCase(),
			status: text(item.status, item.health, item.state, 'connected'),
			...(text(item.expires_at, item.expiresAt) ? { expiresAt: text(item.expires_at, item.expiresAt) } : {}),
			...(text(item.email, item.account_email, item.handle) ? { identity: text(item.email, item.account_email, item.handle) } : {}),
			resourceLabel: text(item.resource_label),
			resourcePlural: text(item.resource_plural),
			...(item.resource && typeof item.resource === 'object' ? { resource: {
				ref: text(record(item.resource).resource_ref, record(item.resource).ref),
				name: text(record(item.resource).resource_name, record(item.resource).name),
			} } : {}),
		}];
	});
}

export function normalizeTregOAuthStart(value: unknown) {
	const root = record(value);
	// Treg's POST /oauth/start contract calls the provider consent link `consent_url`.
	// Keep the older aliases for compatible deployments, but prefer the documented field.
	const authorizationUrl = safeHttpsUrl(root.consent_url ?? root.authorization_url ?? root.authorize_url ?? root.auth_url ?? root.url);
	const state = text(root.state, root.oauth_state);
	if (!authorizationUrl || !state) throw new Error('Treg did not return a valid authorization URL and state.');
	return { authorizationUrl, state };
}

export function normalizeTregOAuthStatus(value: unknown) {
	const root = record(value);
	const connection = record(root.connection);
	const status = text(root.status, root.state).toLowerCase();
	const connected = root.connected === true || root.complete === true || root.completed === true || Boolean(root.secret_id ?? root.secretId ?? connection.secret_id ?? connection.secretId) || ['connected', 'complete', 'completed', 'success', 'succeeded', 'done'].includes(status);
	return { connected, status: status || (connected ? 'connected' : 'pending'), message: text(root.message, root.detail) };
}

export function normalizeTregConnectResult(value: unknown) {
	const root = record(value);
	const secretId = Number(root.secret_id ?? root.secretId ?? record(root.connection).secret_id ?? record(root.connection).secretId);
	return {
		connected: root.connected !== false && (root.ok !== false),
		...(Number.isSafeInteger(secretId) && secretId > 0 ? { secretId } : {}),
		needsExtraCredential: root.needs_extra_credential === true || root.needsExtraCredential === true,
		message: text(root.message, root.detail),
	};
}

export function normalizeTregResources(value: unknown) {
	const root = record(value);
	const rows = Array.isArray(value) ? value : Array.isArray(root.resources) ? root.resources : Array.isArray(root.items) ? root.items : [];
	return rows.flatMap((entry) => {
		const item = record(entry);
		const ref = text(item.resource_ref, item.ref, item.id, item.site_url, item.account_id);
		if (!ref) return [];
		return [{ ref, name: text(item.resource_name, item.name, item.title, ref), detail: text(item.type, item.subtitle, item.url) }];
	});
}

export async function tregConnectionRequest(token: string, path: string, init: RequestInit = {}) {
	return tregRequest(token, path, init);
}
