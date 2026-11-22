import { z } from 'zod';
import { DEFAULT_PHONE_STRATEGY, PhoneProviderStrategySchema } from './phone-strategy';

export const memberPreferencesSchema = z.object({
	defaultPhoneStrategy: PhoneProviderStrategySchema.default(DEFAULT_PHONE_STRATEGY),
});
export type MemberPreferences = z.infer<typeof memberPreferencesSchema>;

export const memberSettingsPatchSchema = z.strictObject({
	revision: z.number().int().min(0),
	preferences: memberPreferencesSchema.partial(),
});

export const DEFAULT_MEMBER_PREFERENCES: MemberPreferences = { defaultPhoneStrategy: DEFAULT_PHONE_STRATEGY };
