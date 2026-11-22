import 'server-only';

export const OFFICIAL_SITE_URL = 'http://localhost:3000';
const OFFICIAL_HOSTS: string[] = [];

/** Parses a configured URL, naming the variable when it is malformed rather than failing with a bare "Invalid URL". */
export function configuredUrl(name: string, value: string) {
	if (!URL.canParse(value)) throw new Error(`${name} must be an absolute URL.`);
	return new URL(value);
}

export function contextSignInEnabled() {
	return false;
}

export const selfHostedEnabled = () => !contextSignInEnabled() && !(process.env.NODE_ENV === 'development' && process.env.ENRICHABLE_DEV_AUTH === 'true');

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
