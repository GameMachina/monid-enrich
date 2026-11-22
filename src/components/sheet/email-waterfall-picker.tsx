'use client';

import { EMAIL_PROVIDERS, type EmailProvider } from '@/lib/types';
import { EMAIL_PROVIDER_INFO } from '@/lib/email-waterfall';
import { MonidWaterfallPicker } from './monid-waterfall-picker';

/** Find email uses Monid routes in the configured order. */
export function EmailWaterfallPicker({ value, onChange }: { value: EmailProvider[]; onChange: (value: EmailProvider[]) => void }) {
	const selected = value.map((provider) => provider === 'monid' ? 'hunter' : provider);
	return <MonidWaterfallPicker value={selected} providers={EMAIL_PROVIDERS} info={EMAIL_PROVIDER_INFO} onChange={onChange} />;
}
