import 'server-only';

export const OFFICIAL_SITE_URL = 'https://enrich.autonomousgtm.xyz';
const OFFICIAL_HOSTS = ['autonomousgtm.xyz', 'www.autonomousgtm.xyz', 'enrich.autonomousgtm.xyz'];

/** Parses a configured URL, naming the variable when it is malformed rather than failing with a bare "Invalid URL". */
export function configuredUrl(name: string, value: string) {
	if (!URL.canParse(value)) throw new Error(`${name} must be an absolute URL.`);
	return new URL(value);
}

export function contextSignInEnabled() {
	return false;
}

export function managedAuthEnabled() {
	return process.env.ENRICHABLE_AUTH_MODE === 'clerk';
}

export function durableEnrichmentEnabled() {
	return managedAuthEnabled() && process.env.ENRICHABLE_DURABLE_ENRICHMENT === 'true' && Boolean(process.env.DATABASE_URL?.trim());
}

export function durableWorkerConfigured() {
	return process.env.CRON_SECRET?.trim().length !== undefined && (process.env.CRON_SECRET?.trim().length ?? 0) >= 32;
}

export function authMode(): 'clerk' | 'self-hosted' | 'unconfigured' {
	const configured = process.env.ENRICHABLE_AUTH_MODE;
	if (configured === 'clerk' || configured === 'self-hosted') return configured;
	if (configured) throw new Error('ENRICHABLE_AUTH_MODE must be clerk or self-hosted.');
	if (process.env.NODE_ENV === 'production') return 'unconfigured';
	return 'self-hosted';
}

/** Production deployments fail closed unless their owner explicitly chooses a hosted identity mode. */
export const selfHostedEnabled = () => authMode() === 'self-hosted' && !(process.env.NODE_ENV === 'development' && process.env.ENRICHABLE_DEV_AUTH === 'true');

/** Public origin for canonical and Open Graph URLs. The official apex always resolves to www. */
export function siteUrl() {
	const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
	try {
		const url = new URL(process.env.NEXT_PUBLIC_SITE_URL || process.env.ENRICHABLE_APP_URL || (vercel ? `https://${vercel}` : 'http://localhost:3000'));
		return url.protocol === 'https:' && OFFICIAL_HOSTS.includes(url.hostname) ? new URL(OFFICIAL_SITE_URL) : new URL(url.origin);
	} catch {
		return new URL('http://localhost:3000');
	}
}

/** Search engines index only the official site; forks opt in, and Vercel previews never index. */
export const indexingEnabled = () => process.env.VERCEL_ENV !== 'preview' && (siteUrl().origin === OFFICIAL_SITE_URL || process.env.ENRICHABLE_ALLOW_INDEXING === 'true');
