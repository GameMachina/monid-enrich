'use client';

import { PHONE_LOOKUP_PROVIDERS, type PhoneLookupProvider } from '@/lib/types';
import { PHONE_WATERFALL_INFO } from '@/lib/phone-waterfall';
import { MonidWaterfallPicker } from './monid-waterfall-picker';

export function PhoneWaterfallPicker({ value, onChange }: { value: PhoneLookupProvider[]; onChange: (value: PhoneLookupProvider[]) => void }) {
	return <MonidWaterfallPicker value={value} providers={PHONE_LOOKUP_PROVIDERS} info={PHONE_WATERFALL_INFO} onChange={onChange} />;
}
