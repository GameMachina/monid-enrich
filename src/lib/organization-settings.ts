import { z } from 'zod';
import { DEFAULT_MODEL } from './types';
import { logoDomain } from './organization-logo';
import { DEFAULT_ALLOWED_PHONE_PROVIDERS, PhoneProviderSchema } from './phone-strategy';

/** Legacy operation aliases remain as type names for old sheets; runtime connections expose OpenAI, Monid, and Treg. */
export type Provider = 'openai' | 'monid' | 'treg' | 'context' | 'typesafe' | 'hunter' | 'prospeo' | 'quickenrich' | 'apollo' | 'contactout';
const PROVIDER_IDS = ['openai', 'monid', 'treg'] as const;
export const PROVIDERS: readonly Provider[] = PROVIDER_IDS;
export type ProviderAlias = Provider;
export const providerField: Record<Provider, 'openaiKey' | 'monidKey' | 'tregKey'> = { openai: 'openaiKey', monid: 'monidKey', treg: 'tregKey', context: 'monidKey', typesafe: 'monidKey', hunter: 'monidKey', prospeo: 'monidKey', quickenrich: 'monidKey', apollo: 'monidKey', contactout: 'monidKey' };
export const MODEL_ID = /^[a-z0-9.\-_:/]+$/i;
/** Classifier setting that selects the Decisions API (TypeSafe Jev) rather than naming a model. */
export const DECISIONS_CLASSIFIER = 'decisions';
export const organizationPreferencesSchema = z.object({
 companyDomain: z.string().max(253).refine((value) => !value || Boolean(logoDomain(value)), 'Enter a valid company website.').optional(),
 model: z.string().min(1).max(100).regex(MODEL_ID).default(DEFAULT_MODEL),
 classifierModel: z.string().min(1).max(100).regex(MODEL_ID).default(DECISIONS_CLASSIFIER),
 openaiBaseUrl: z.string().max(512).default(''),
 concurrency: z.number().int().min(1).max(16).default(4),
 preferJev: z.boolean().default(false),
 logolinkKey: z.string().max(300).default(''),
 mobilePhoneProviders: z.array(PhoneProviderSchema).min(1).max(2).default([...DEFAULT_ALLOWED_PHONE_PROVIDERS]).refine((providers) => new Set(providers).size === providers.length, 'Each mobile provider can appear only once.'),
});
export type OrganizationPreferences = z.infer<typeof organizationPreferencesSchema>;
export type ProviderStatus = { configured: boolean; disconnected?: boolean; prefix?: string; source?: 'manual' | 'signin'; expiresAt?: number; reconnectRequired?: boolean; updatedAt?: number };
export type OrganizationSettings = { revision: number; preferences: OrganizationPreferences; providers: Partial<Record<Provider, ProviderStatus>> };
export const organizationSettingsPatchSchema = z.strictObject({
 revision: z.number().int().min(0),
 preferences: organizationPreferencesSchema.partial().optional(),
 providers: z.partialRecord(z.enum(PROVIDER_IDS), z.string().trim().min(1).max(512).regex(/^[^\r\n]+$/).nullable()).optional(),
 importOnly: z.boolean().default(false),
});
