'use client';

import { Button } from '@/components/ui/button';
import { NameDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';
import { accountHeaders } from '@/lib/account-storage';
import { Building2, RefreshCw, Search, ShieldCheck, Table2, Users } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

type Organization = {
	workspace_id: string; issuer: string; organization_id: string; name: string; deleted_at: string | null;
	member_count: number; sheet_count: number; row_count: number; active_jobs: number; last_member_activity: string | null; last_sheet_activity: string | null;
	trial: null | { eligible: boolean; adminExempt: boolean; sheetsUsed: number; rowsUsed: number };
	subscription_status: string | null; paid_purchase_count: number; paid_total_cents: number;
};
type Details = {
	organization: Pick<Organization, 'workspace_id' | 'issuer' | 'organization_id' | 'name' | 'deleted_at' | 'member_count' | 'sheet_count' | 'row_count' | 'active_jobs'> & { trial_eligible: boolean | null; admin_exempt: boolean | null; trial_sheets_used: number | null; trial_rows_used: number | null; subscription_status: string | null };
	members: Array<{ issuer: string; user_id: string; first_signed_in_at: string; last_signed_in_at: string }>;
	sheets: Array<{ id: string; name: string; row_count: number; updated_at: string | null }>;
	purchases: Array<{ session_id: string; status: string; amount_total: number; currency: string; created_at: string }>;
	jobs: Array<{ status: string; count: number }>;
	recentActivity: Array<{ action: string; actor_id: string; details: Record<string, unknown>; created_at: string }>;
	canClose: boolean;
};
type ListResponse = { organizations: Organization[]; mutationsEnabled: boolean };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(path, { ...init, headers: { ...accountHeaders(), ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers }, cache: 'no-store' });
	const body = await response.json().catch(() => ({})) as T & { error?: string };
	if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
	return body;
}

function date(value: string | null | undefined) { return value ? new Date(value).toLocaleString() : '—'; }
function money(cents: number, currency = 'USD') { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100); }
function shortId(value: string) { return value.length > 20 ? `${value.slice(0, 9)}…${value.slice(-7)}` : value; }

export function PlatformAdmin() {
	const [organizations, setOrganizations] = useState<Organization[]>([]);
	const [mutationsEnabled, setMutationsEnabled] = useState(false);
	const [details, setDetails] = useState<Details | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [search, setSearch] = useState('');
	const [status, setStatus] = useState<'active' | 'closed' | 'all'>('active');
	const [loading, setLoading] = useState(true);
	const [detailLoading, setDetailLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [closeTarget, setCloseTarget] = useState<Pick<Organization, 'workspace_id' | 'name'> | null>(null);
	const [deleteSheet, setDeleteSheet] = useState<Details['sheets'][number] | null>(null);
	const [closing, setClosing] = useState(false);

	const load = useCallback(async () => {
		setLoading(true); setError(null);
		try {
			const result = await api<ListResponse>(`/api/admin/organizations?${new URLSearchParams({ q: search, status })}`);
			setOrganizations(result.organizations);
			setMutationsEnabled(result.mutationsEnabled);
			setSelectedId((current) => result.organizations.some((item) => item.workspace_id === current) ? current : result.organizations[0]?.workspace_id ?? null);
		} catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load organizations.'); }
		finally { setLoading(false); }
	}, [search, status]);

	const loadDetails = useCallback(async (id: string) => {
		setDetailLoading(true);
		try { const result = await api<Details>(`/api/admin/organizations/${encodeURIComponent(id)}`); setDetails(result); }
		catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load organization details.'); setDetails(null); }
		finally { setDetailLoading(false); }
	}, []);

	useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
	useEffect(() => { if (selectedId) void loadDetails(selectedId); else setDetails(null); }, [selectedId, loadDetails]);

	const summary = useMemo(() => ({ active: organizations.filter((item) => !item.deleted_at).length, sheets: organizations.reduce((total, item) => total + Number(item.sheet_count), 0), rows: organizations.reduce((total, item) => total + Number(item.row_count), 0) }), [organizations]);
	async function closeOrganization(name: string) {
		if (!closeTarget) return;
		setClosing(true); setError(null);
		try {
			await api(`/api/admin/organizations/${encodeURIComponent(closeTarget.workspace_id)}`, { method: 'DELETE', body: JSON.stringify({ confirmWorkspaceName: name }) });
			setCloseTarget(null); setDetails(null); setSelectedId(null); await load();
		} catch (cause) { throw cause instanceof Error ? cause : new Error('Could not close this organization.'); }
		finally { setClosing(false); }
	}

	async function removeSheet(name: string) {
		if (!details || !deleteSheet) return;
		await api(`/api/admin/organizations/${encodeURIComponent(details.organization.workspace_id)}/sheets/${encodeURIComponent(deleteSheet.id)}`, { method: 'DELETE', body: JSON.stringify({ confirmSheetName: name }) });
		setDeleteSheet(null);
		await loadDetails(details.organization.workspace_id);
		await load();
	}

	return <div className="flex flex-col gap-5">
		<div className="grid gap-3 sm:grid-cols-3">
			<Summary icon={<Building2 size={17} />} label="Organizations shown" value={organizations.length.toLocaleString()} />
			<Summary icon={<Table2 size={17} />} label="Sheets shown" value={summary.sheets.toLocaleString()} />
			<Summary icon={<Users size={17} />} label="Rows shown" value={summary.rows.toLocaleString()} />
		</div>
		{!mutationsEnabled && <p className="rounded-lg border border-warning/25 bg-warning-soft px-4 py-3 text-body-sm text-fg">This admin view is read-only in local development and Vercel preview deployments. Workspace and sheet deletion are available in production, or on an explicitly enabled preview.</p>}
		<section className="glass-card overflow-hidden">
			<div className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-3">
				<label className="relative min-w-[220px] flex-1"><span className="sr-only">Search organizations</span><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or organization ID" className="pl-9" /></label>
				<select aria-label="Organization status" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} className="h-10 rounded-lg border border-line bg-surface px-3 text-body-sm text-fg"><option value="active">Active</option><option value="closed">Closed</option><option value="all">All</option></select>
				<Button size="sm" onClick={() => void load()} loading={loading}><RefreshCw size={15} />Refresh</Button>
			</div>
			{error && <p role="alert" className="m-4 rounded-lg border border-danger/25 bg-danger-soft px-4 py-3 text-body-sm text-danger">{error}</p>}
			{loading ? <p role="status" className="px-4 py-10 text-center text-body-sm text-fg-subtle">Loading organizations…</p> : organizations.length === 0 ? <p className="px-4 py-10 text-center text-body-sm text-fg-subtle">No organizations match this view.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-body-sm"><thead className="bg-tint/[0.025] text-caption text-fg-subtle"><tr><th className="px-4 py-3 font-medium">Organization</th><th className="px-4 py-3 font-medium">Members</th><th className="px-4 py-3 font-medium">Sheets / rows</th><th className="px-4 py-3 font-medium">Access</th><th className="px-4 py-3 font-medium">Last activity</th></tr></thead><tbody>{organizations.map((item) => <tr key={item.workspace_id} className={`border-t border-hairline ${selectedId === item.workspace_id ? 'bg-brand-soft/40' : 'hover:bg-tint/[0.025]'}`}><td className="px-4 py-3"><button type="button" onClick={() => setSelectedId(item.workspace_id)} className="text-left"><span className="block font-medium text-fg">{item.name}</span><span className="mt-0.5 block font-mono text-caption text-fg-subtle" title={item.workspace_id}>{shortId(item.organization_id || item.workspace_id)}</span></button>{item.deleted_at && <span className="mt-1 inline-block rounded-md bg-neutral-5 px-1.5 py-0.5 text-caption text-fg-subtle">Closed</span>}</td><td className="px-4 py-3 text-fg-muted">{Number(item.member_count).toLocaleString()}</td><td className="px-4 py-3 text-fg-muted">{Number(item.sheet_count).toLocaleString()} / {Number(item.row_count).toLocaleString()}</td><td className="px-4 py-3 text-fg-muted">{item.trial?.adminExempt ? 'Admin exempt' : item.paid_purchase_count ? `${item.paid_purchase_count} paid purchase${item.paid_purchase_count === 1 ? '' : 's'}` : item.trial?.eligible ? 'Trial' : 'No purchase shown'}</td><td className="px-4 py-3 text-caption text-fg-subtle">{date(item.last_sheet_activity || item.last_member_activity)}</td></tr>)}</tbody></table></div>}
		</section>
		{selectedId && <section className="glass-card flex flex-col gap-4 p-4 sm:p-5" aria-labelledby="organization-details-title">
			{detailLoading || !details ? <p role="status" className="py-6 text-center text-body-sm text-fg-subtle">Loading organization details…</p> : <>
				<div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-caption font-medium uppercase tracking-wide text-fg-subtle">Organization details</p><h2 id="organization-details-title" className="mt-1 text-h3 text-fg">{details.organization.name}</h2><p className="mt-1 break-all font-mono text-caption text-fg-subtle">{details.organization.workspace_id}</p><p className="mt-1 text-caption text-fg-subtle">{details.organization.issuer} · provider organization {details.organization.organization_id}</p></div>{details.canClose && <Button variant="danger" size="sm" onClick={() => setCloseTarget(details.organization)}><ShieldCheck size={15} />Close organization</Button>}</div>
				{details.organization.deleted_at && <p className="rounded-lg border border-warning/25 bg-warning-soft px-3 py-2 text-body-sm text-fg">This workspace is closed. Its sheets and workspace credentials have been removed; billing and provider usage records are retained.</p>}
				<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Info label="Subscription" value={details.organization.subscription_status || 'No subscription'} /><Info label="Paid purchases" value={`${details.purchases.filter((item) => item.status === 'paid').length} · ${money(details.purchases.filter((item) => item.status === 'paid').reduce((sum, item) => sum + Number(item.amount_total), 0), details.purchases.find((item) => item.status === 'paid')?.currency || 'USD')}`} /><Info label="Trial sheets / rows used" value={`${details.organization.trial_sheets_used ?? '—'} / ${details.organization.trial_rows_used ?? '—'}`} /><Info label="Active enrichments" value={String(Number(details.organization.active_jobs ?? 0))} /></div>
				<div className="grid gap-5 xl:grid-cols-2">
					<DetailList title={`Sheets (${details.organization.sheet_count})`} empty="No sheets in this organization." items={details.sheets.map((sheet) => <div key={sheet.id} className="flex items-center justify-between gap-3 py-2"><span className="min-w-0 truncate text-fg" title={sheet.name}>{sheet.name}</span><span className="flex shrink-0 items-center gap-2 text-caption text-fg-subtle">{Number(sheet.row_count).toLocaleString()} rows · {date(sheet.updated_at)}{mutationsEnabled && !details.organization.deleted_at && <button type="button" onClick={() => setDeleteSheet(sheet)} className="rounded-md px-2 py-1 text-danger hover:bg-danger-soft">Delete</button>}</span></div>)} />
					<DetailList title={`Members (${details.members.length})`} empty="No member records found." items={details.members.map((member) => <div key={`${member.issuer}:${member.user_id}`} className="flex items-center justify-between gap-3 py-2"><span className="min-w-0 truncate font-mono text-caption text-fg" title={member.user_id}>{shortId(member.user_id)}</span><span className="shrink-0 text-caption text-fg-subtle">Last seen {date(member.last_signed_in_at)}</span></div>)} />
					<DetailList title="Recent purchases" empty="No purchase records for this organization." items={details.purchases.map((purchase) => <div key={purchase.session_id} className="flex items-center justify-between gap-3 py-2"><span className="font-mono text-caption text-fg-subtle">{shortId(purchase.session_id)}</span><span className="text-caption text-fg-muted">{purchase.status} · {money(Number(purchase.amount_total), purchase.currency)}</span></div>)} />
					<DetailList title="Recent activity" empty="No audit events recorded." items={details.recentActivity.map((event, index) => <div key={`${event.action}:${event.created_at}:${index}`} className="flex items-center justify-between gap-3 py-2"><span className="min-w-0 truncate text-fg">{event.action}</span><span className="shrink-0 text-caption text-fg-subtle">{date(event.created_at)}</span></div>)} />
				</div>
				{details.jobs.length > 0 && <p className="text-caption text-fg-subtle">Job history: {details.jobs.map((job) => `${job.status} ${job.count}`).join(' · ')}</p>}
				{Number(details.organization.member_count) > details.members.length && <p className="text-caption text-fg-subtle">Showing the first {details.members.length} of {details.organization.member_count} member records.</p>}
				{Number(details.organization.sheet_count) > details.sheets.length && <p className="text-caption text-fg-subtle">Showing the 100 most recently updated sheets.</p>}
			</>}
		</section>}
		{closeTarget && <NameDialog title={`Close “${closeTarget.name}”?`} initial="" label={`Type the exact organization name: ${closeTarget.name}`} confirmLabel="Close organization" onClose={() => { if (!closing) setCloseTarget(null); }} onSubmit={closeOrganization} />}
		{deleteSheet && details && <NameDialog title={`Delete “${deleteSheet.name}”?`} initial="" label={`Type the exact sheet name: ${deleteSheet.name}`} confirmLabel="Delete sheet and rows" onClose={() => setDeleteSheet(null)} onSubmit={removeSheet} />}
	</div>;
}

function Summary({ icon, label, value }: { icon: ReactNode; label: string; value: string }) { return <div className="glass-card flex items-center gap-3 px-4 py-3"><span className="grid size-9 place-items-center rounded-lg bg-brand-soft text-brand">{icon}</span><span><span className="block text-caption text-fg-subtle">{label}</span><span className="text-body font-semibold text-fg">{value}</span></span></div>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-hairline bg-surface px-3 py-2.5"><p className="text-caption text-fg-subtle">{label}</p><p className="mt-1 text-body-sm font-medium text-fg">{value}</p></div>; }
function DetailList({ title, empty, items }: { title: string; empty: string; items: ReactNode[] }) { return <section className="rounded-lg border border-hairline px-3.5 py-3"><h3 className="text-body-sm font-medium text-fg">{title}</h3>{items.length ? <div className="mt-2 divide-y divide-hairline">{items}</div> : <p className="mt-2 text-caption text-fg-subtle">{empty}</p>}</section>; }
