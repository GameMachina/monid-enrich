'use client';

import type { SocialPlatform, SocialProvider } from '@/lib/social-platform';
import { socialProviderInfo, socialProvidersFor } from '@/lib/social-platform';
import { MonidWaterfallPicker } from './monid-waterfall-picker';

export function SocialWaterfallPicker({ platform, value, onChange }: { platform: SocialPlatform; value: SocialProvider[]; onChange: (value: SocialProvider[]) => void }) {
	return <MonidWaterfallPicker key={platform} value={value} providers={socialProvidersFor(platform)} info={socialProviderInfo(platform)} onChange={onChange} />;
}
