import type { Column, ColumnOp } from './types';
import { roleColumn, type ColumnRole } from './column-roles';

const MONID_LOGO = '/providers/monid.svg';
export const EMAIL_PROVIDER_INFO = {
	monid: { name: 'Hunter · Monid', baseUsd: 0.0245, logo: MONID_LOGO },
	quickenrich: { name: 'QuickEnrich · Monid', baseUsd: 0.0072, logo: MONID_LOGO },
	hunter: { name: 'Hunter · Monid', baseUsd: 0.0245, logo: MONID_LOGO },
	apollo: { name: 'Apollo · Monid', baseUsd: 0.026, logo: MONID_LOGO },
	prospeo: { name: 'Prospeo · Monid', baseUsd: 0.066, logo: MONID_LOGO },
	contactout: { name: 'ContactOut · Monid', baseUsd: 0.1, logo: MONID_LOGO },
} as const;

export function defaultEmailWaterfall(columns: Column[]): Extract<ColumnOp, { kind: 'email-enrichment' }> {
	const ref = (role: ColumnRole) => { const column = roleColumn(columns, role); return column ? `{{${column.name}}}` : ''; };
	return { kind: 'email-enrichment', name: ref('person') || [ref('first-name'), ref('last-name')].filter(Boolean).join(' '), company: ref('company'), domain: ref('website'), profileUrl: ref('profile'), providers: ['hunter'] };
}
