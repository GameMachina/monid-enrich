import type { PhoneLookupProvider } from './types';

const logo = '/providers/monid.svg';
export const PHONE_WATERFALL_INFO: Record<PhoneLookupProvider, { name: string; baseUsd: number; logo: string }> = {
	leadmagic: { name: 'LeadMagic · Monid', baseUsd: 0.2016, logo },
	clay: { name: 'Clay · Monid', baseUsd: 0.568, logo },
	ai_ark: { name: 'AI Ark · Monid', baseUsd: 0.084, logo },
	reversecontact: { name: 'Reverse Contact · Monid', baseUsd: 0.1, logo },
	prospeo: { name: 'Prospeo · Monid', baseUsd: 0.066, logo },
};
