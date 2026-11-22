import { z } from 'zod';

/** Monid routes currently available for mobile phone lookups. */
export const PHONE_PROVIDERS = ['leadmagic', 'clay'] as const;
export type PhoneProvider = (typeof PHONE_PROVIDERS)[number];
export const PhoneProviderSchema = z.enum(PHONE_PROVIDERS);

/** A single route or an ordered no-match waterfall. */
export const PHONE_STRATEGIES = ['leadmagic', 'clay', 'leadmagic-then-clay', 'clay-then-leadmagic'] as const;
export type PhoneProviderStrategy = (typeof PHONE_STRATEGIES)[number];
export const PhoneProviderStrategySchema = z.enum(PHONE_STRATEGIES);

export const DEFAULT_PHONE_STRATEGY: PhoneProviderStrategy = 'leadmagic';
export const DEFAULT_ALLOWED_PHONE_PROVIDERS: PhoneProvider[] = [...PHONE_PROVIDERS];

export const PHONE_STRATEGY_INFO: Record<PhoneProviderStrategy, { label: string; providers: readonly PhoneProvider[] }> = {
	leadmagic: { label: 'LeadMagic only', providers: ['leadmagic'] },
	clay: { label: 'Clay only', providers: ['clay'] },
	'leadmagic-then-clay': { label: 'LeadMagic → Clay', providers: ['leadmagic', 'clay'] },
	'clay-then-leadmagic': { label: 'Clay → LeadMagic', providers: ['clay', 'leadmagic'] },
};

export function allowedPhoneStrategies(allowed: readonly PhoneProvider[]): PhoneProviderStrategy[] {
	const set = new Set(allowed);
	return PHONE_STRATEGIES.filter((strategy) => PHONE_STRATEGY_INFO[strategy].providers.every((provider) => set.has(provider)));
}
