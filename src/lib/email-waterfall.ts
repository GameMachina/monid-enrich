import type { Column, ColumnOp } from './types';
import { roleColumn, type ColumnRole } from './column-roles';

const MONID_INFO = { name: 'Monid', baseUsd: 0.0245, logo: '/providers/monid.svg' } as const;
export const EMAIL_PROVIDER_INFO = { monid: MONID_INFO, hunter: MONID_INFO, prospeo: MONID_INFO, quickenrich: MONID_INFO, apollo: MONID_INFO, contactout: MONID_INFO } as const;

export function defaultEmailWaterfall(columns: Column[]): Extract<ColumnOp, { kind: 'email-enrichment' }> {
	const ref = (role: ColumnRole) => { const column = roleColumn(columns, role); return column ? `{{${column.name}}}` : ''; };
	return { kind: 'email-enrichment', name: ref('person') || [ref('first-name'), ref('last-name')].filter(Boolean).join(' '), company: ref('company'), domain: ref('website'), profileUrl: ref('profile'), providers: ['monid'] };
}
