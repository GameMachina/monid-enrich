import type { ServerKeys } from '@/lib/api';
import { maskKey, type Settings } from '@/lib/keys';
import { providerField, type OrganizationSettings, type Provider } from '@/lib/organization-settings';

export const CONNECTION_ORDER = ['monid', 'treg', 'openai'] as const satisfies readonly Provider[];
export const DATA_PROVIDER_IDS = ['monid', 'treg'] as const satisfies readonly Provider[];

export const PROVIDER_INFO: Record<Provider, { name: string; logo: string; description: string; link: string; placeholder: string; verifiable: boolean }> = {
	monid: { name: 'Monid', logo: '/providers/monid.svg', description: 'Web research, company and people data, and enrichment', link: 'https://app.monid.ai/access/api-keys', placeholder: 'monid_live_…', verifiable: true },
	treg: { name: 'Treg', logo: '/providers/treg.svg', description: 'Pay-per-use email, phone, and social lookups with separate billing', link: 'https://treg.to', placeholder: 'treg_…', verifiable: true },
	context: { name: 'Monid', logo: '/providers/monid.svg', description: 'Web research, company and people data, and enrichment', link: 'https://app.monid.ai/access/api-keys', placeholder: 'monid_live_…', verifiable: true },
	openai: { name: 'OpenAI', logo: '/providers/openai.svg', description: 'Optional reasoning, classification, and scoring', link: 'https://platform.openai.com/api-keys', placeholder: 'sk-…', verifiable: true },
	typesafe: { name: 'OpenAI', logo: '/providers/openai.svg', description: 'AI reasoning', link: 'https://platform.openai.com/api-keys', placeholder: 'sk-…', verifiable: false },
	hunter: { name: 'Monid', logo: '/providers/monid.svg', description: 'Email enrichment via Monid', link: 'https://app.monid.ai/access/api-keys', placeholder: 'monid_live_…', verifiable: false },
	prospeo: { name: 'Monid', logo: '/providers/monid.svg', description: 'Email enrichment via Monid', link: 'https://app.monid.ai/access/api-keys', placeholder: 'monid_live_…', verifiable: false },
	quickenrich: { name: 'Monid', logo: '/providers/monid.svg', description: 'Email enrichment via Monid', link: 'https://app.monid.ai/access/api-keys', placeholder: 'monid_live_…', verifiable: false },
	apollo: { name: 'Monid', logo: '/providers/monid.svg', description: 'Email enrichment via Monid', link: 'https://app.monid.ai/access/api-keys', placeholder: 'monid_live_…', verifiable: false },
	contactout: { name: 'Monid', logo: '/providers/monid.svg', description: 'Email enrichment via Monid', link: 'https://app.monid.ai/access/api-keys', placeholder: 'monid_live_…', verifiable: false },
};

/** saved: a browser-local key; connected: a workspace vault connection; included: a hosted included trial (OpenAI or TypeSafe); deployment: server environment keys. */
export type ConnectionState = 'connected' | 'saved' | 'expired' | 'included' | 'deployment' | 'missing';
export interface Connection { state: ConnectionState; detail?: string; source?: 'manual' | 'signin'; expiresAt?: number }

export const isReady = (connection: Connection) => connection.state !== 'missing' && connection.state !== 'expired';
export const isConfigured = (connection: Connection) => connection.state === 'connected' || connection.state === 'saved';

export function deriveConnections({ settings, organization, server, selfHosted, trialLimited }: { settings: Settings; organization: OrganizationSettings | null; server: ServerKeys | null; selfHosted: boolean; trialLimited: boolean }): Record<Provider, Connection> {
	void selfHosted;
	void trialLimited;
	const derive = (provider: Provider): Connection => {
		const key = settings[providerField[provider]];
		if (key) return { state: 'saved', detail: maskKey(key) };
		const status = organization?.providers[provider];
		if (status?.reconnectRequired) return { state: 'expired', source: status.source, expiresAt: status.expiresAt };
		if (status?.configured) return { state: 'connected', source: status.source, expiresAt: status.expiresAt, detail: status.prefix ? `${status.prefix}${'•'.repeat(8)}` : 'API key' };
		if (provider === 'monid' && server?.monidSaved) return { state: 'connected', source: 'manual', detail: 'Saved encrypted on this server' };
		if (provider === 'treg' && server?.tregSaved) return { state: 'connected', source: 'manual', detail: 'Saved encrypted on this server' };
		if (provider === 'openai' && server?.openaiSaved) return { state: 'connected', source: 'manual', detail: 'Saved encrypted on this server' };
		if (provider === 'monid' && server?.monid) return { state: 'deployment', detail: 'Provided by this deployment' };
		if (provider === 'treg' && server?.treg) return { state: 'deployment', detail: 'Provided by this deployment' };
		if (provider === 'openai' && server?.openai) return { state: 'deployment', detail: 'Provided by this deployment' };
		return { state: 'missing' };
	};
	return Object.fromEntries(Object.keys(PROVIDER_INFO).map((provider) => [provider, derive(provider as Provider)])) as Record<Provider, Connection>;
}

export function formatExpiry(expiresAt: number, now = Date.now()) {
	const minutes = Math.round((expiresAt - now) / 60_000);
	if (minutes <= 0) return 'expired';
	if (minutes < 60) return `expires in ${minutes} min`;
	const hours = Math.round(minutes / 60);
	return hours < 48 ? `expires in ${hours} h` : `expires in ${Math.round(hours / 24)} days`;
}

/** MCP client config. Provider keys remain server-side; callers send only their workspace agent secret. */
export function mcpConfig(endpoint: string, secret: string | undefined, selfHosted: boolean) {
	void selfHosted;
	return JSON.stringify({ mcpServers: { monidEnrich: { url: endpoint, headers: { Authorization: `Bearer ${secret ?? 'YOUR_AGENT_KEY'}` } } } }, null, 2);
}
