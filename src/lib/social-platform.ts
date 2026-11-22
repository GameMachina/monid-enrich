import { z } from 'zod';

export const SOCIAL_PLATFORMS = ['linkedin', 'instagram', 'facebook', 'x', 'tiktok', 'youtube'] as const;
export const SocialPlatformSchema = z.enum(SOCIAL_PLATFORMS);
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

/** Monid routes that can search for a public profile on each supported network. */
export const SOCIAL_WATERFALL_PROVIDERS = {
	linkedin: ['people_enrich', 'web_search', 'apify', 'ploid', 'anyapi'],
	instagram: ['people_enrich', 'web_search', 'anyapi', 'tikhub'],
	facebook: ['people_enrich', 'web_search', 'litescrape'],
	x: ['people_enrich', 'web_search', 'anyapi'],
	tiktok: ['people_enrich', 'web_search', 'anyapi', 'tikhub'],
	youtube: ['people_enrich', 'web_search', 'tikhub', 'litescrape'],
} as const satisfies Record<SocialPlatform, readonly string[]>;
export const SOCIAL_PROVIDER_IDS = ['people_enrich', 'web_search', 'apify', 'ploid', 'anyapi', 'tikhub', 'litescrape'] as const;
export const SocialProviderSchema = z.enum(SOCIAL_PROVIDER_IDS);
export type SocialProvider = typeof SOCIAL_PROVIDER_IDS[number];

export function socialProviderInfo(platform: SocialPlatform): Record<SocialProvider, { name: string; baseUsd: number; logo: string }> {
	const anyApiUsd: Record<SocialPlatform, number> = { linkedin: 0.032, instagram: 0.0012, facebook: 0.00015, x: 0.00049, tiktok: 0.0006, youtube: 0.001 };
	const anyApiPlatform = platform === 'linkedin' ? 'LinkedIn' : platform === 'instagram' ? 'Instagram' : platform === 'x' ? 'X' : platform === 'tiktok' ? 'TikTok' : platform === 'youtube' ? 'YouTube' : 'Facebook';
	return {
		people_enrich: { name: 'People enrichment · Monid', baseUsd: 0.04, logo: '/providers/monid.svg' },
		web_search: { name: 'Web search · Monid', baseUsd: 0.002, logo: '/providers/monid.svg' },
		apify: { name: 'Apify LinkedIn · Monid', baseUsd: 0.008, logo: '/providers/monid.svg' },
		ploid: { name: 'Ploid LinkedIn · Monid', baseUsd: 0.01, logo: '/providers/monid.svg' },
		anyapi: { name: `AnyAPI ${anyApiPlatform} · Monid`, baseUsd: anyApiUsd[platform], logo: '/providers/monid.svg' },
		tikhub: { name: `${platform === 'youtube' ? 'TikHub YouTube' : 'TikHub'} · Monid`, baseUsd: 0.001, logo: '/providers/monid.svg' },
		litescrape: { name: `Litescrape ${platform === 'facebook' ? 'Facebook' : 'YouTube'} · Monid`, baseUsd: 0.00015, logo: '/providers/monid.svg' },
	};
}

export function socialProvidersFor(platform: SocialPlatform): readonly SocialProvider[] {
	return SOCIAL_WATERFALL_PROVIDERS[platform] as readonly SocialProvider[];
}

export const SOCIAL_PLATFORM_OPTIONS: Array<{ value: SocialPlatform; label: string }> = [
	{ value: 'linkedin', label: 'LinkedIn' },
	{ value: 'instagram', label: 'Instagram' },
	{ value: 'facebook', label: 'Facebook' },
	{ value: 'x', label: 'X / Twitter' },
	{ value: 'tiktok', label: 'TikTok' },
	{ value: 'youtube', label: 'YouTube' },
];

const PLATFORM_HOSTS: Record<SocialPlatform, readonly string[]> = {
	linkedin: ['linkedin.com'],
	instagram: ['instagram.com'],
	facebook: ['facebook.com'],
	x: ['x.com', 'twitter.com'],
	tiktok: ['tiktok.com'],
	youtube: ['youtube.com', 'youtu.be'],
};

export function isSocialProfileFor(value: string, platform: SocialPlatform): boolean {
	try {
		const hostname = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
		return PLATFORM_HOSTS[platform].some((host) => hostname === host || hostname.endsWith(`.${host}`));
	} catch {
		return false;
	}
}
