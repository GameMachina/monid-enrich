'use client';

import Dexie from 'dexie';
import { ExternalLink } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { accountHeaders, accountStorageKey } from '@/lib/account-storage';
import { importMyLocalSheets } from '@/lib/db';
import type { Settings } from '@/lib/keys';
import { buttonClassName } from '@/components/ui/button-class';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, Input, Select, Switch } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { PageColumn, PageHeader } from './page-header';
import { ModelPicker } from './model-picker';
import { useSettings } from './settings-context';
import { McpAccess } from './mcp-access';
import { CompanyBranding } from './company-branding';
import { brandingDomain, loadBrand } from './brand-lookup';
import { Connections } from './connections';
import { AgentWebConnection } from './agentweb-connection';
import { isReady } from './providers';
import { providerCheck, useVerification, type ProviderCheck } from './use-verification';
import { allowedPhoneStrategies, DEFAULT_ALLOWED_PHONE_PROVIDERS, PHONE_PROVIDERS, PHONE_STRATEGY_INFO, type PhoneProvider } from '@/lib/phone-strategy';

export function SettingsPage() {
	const { selfHosted, workspaceName } = useSettings();
	return (
		<PageColumn>
			<PageHeader title="Configuration" description={selfHosted ? 'This workspace and its sheets are stored in this browser.' : `Shared with ${workspaceName || 'your workspace team'}.`} />
			<Connections />
			<AgentWebConnection />
			<MonidWallet />
			<TregWallet />
			{!selfHosted && <SubscriptionBilling />}
			<MobilePhoneProviderSettings />
			<Defaults />
			<McpAccess />
			{!selfHosted && <WorkspaceData />}
			{!selfHosted && <LegacySheetsImport />}
		</PageColumn>
	);
}

function WorkspaceData() {
	const router = useRouter();
	const { workspaceName, workspaceAdmin } = useSettings();
	const { toast } = useToast();
	const [exporting, setExporting] = useState(false);
	const [name, setName] = useState('');
	const [confirming, setConfirming] = useState(false);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);

	async function exportWorkspace() {
		setExporting(true); setError('');
		try {
			const response = await fetch('/api/workspace/export', { headers: accountHeaders(), cache: 'no-store' });
			if (!response.ok) {
				const data = await response.json().catch(() => null) as { error?: string } | null;
				throw new Error(data?.error || 'Could not export workspace data.');
			}
			const data = await response.blob();
			const url = URL.createObjectURL(data);
			const link = document.createElement('a');
			link.href = url;
			link.download = `monid-enrich-${new Date().toISOString().slice(0, 10)}.json`;
			link.click();
			setTimeout(() => URL.revokeObjectURL(url), 60_000);
			toast('Workspace export downloaded. Provider credentials are never included.', 'success');
		} catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not export workspace data.'); }
		finally { setExporting(false); }
	}

	async function closeWorkspace() {
		setBusy(true); setError('');
		try {
			const response = await fetch('/api/workspace', { method: 'DELETE', headers: { ...accountHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ confirmWorkspaceName: name }) });
			const data = await response.json().catch(() => null) as { error?: string } | null;
			if (!response.ok) throw new Error(data?.error || 'Could not close workspace.');
			router.replace('/workspace-closed');
			router.refresh();
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : 'Could not close workspace.';
			setError(message);
			throw new Error(message);
		} finally { setBusy(false); }
	}

	return <section aria-labelledby="workspace-data-title" className="glass-card flex flex-col gap-4 px-5 py-5">
		<div className="flex flex-col gap-1">
			<h2 id="workspace-data-title" className="text-body text-fg">Workspace data</h2>
			<p className="text-body-sm text-fg-muted">Export your sheets, settings, and recent provider usage. Credentials are excluded from exports.</p>
		</div>
		<div className="flex flex-wrap items-center gap-3">
			{workspaceAdmin ? <Button size="sm" loading={exporting} onClick={() => void exportWorkspace()}>Download workspace export</Button> : <p className="text-caption text-fg-subtle">A workspace admin can download an export.</p>}
			{workspaceAdmin && <span className="text-caption text-fg-subtle">JSON · includes up to 10,000 recent Monid and Treg receipts</span>}
		</div>
		<div className="flex flex-col gap-3 border-t border-line-subtle pt-4">
			{workspaceAdmin ? <><div className="flex flex-col gap-1">
				<h3 className="text-body-sm font-medium text-danger">Close this workspace</h3>
				<p className="text-caption text-fg-subtle">Removes sheets, connected provider credentials, workspace settings, agent keys, and queued jobs. Cancel the app subscription first. Billing records and provider usage receipts remain for accounting. This cannot be undone.</p>
			</div>
			<Field label={`Type “${workspaceName || 'workspace'}” to continue`}>
				{(id) => <Input id={id} value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" className="max-w-md" />}
			</Field>
			<Button size="sm" variant="danger" className="self-start" disabled={!workspaceName || name !== workspaceName || busy} onClick={() => { setError(''); setConfirming(true); }}>Close workspace…</Button>
			{error && !confirming && <p role="alert" className="text-caption text-danger">{error}</p>}</> : <p className="text-caption text-fg-subtle">A workspace owner or admin can permanently close this workspace.</p>}
		</div>
		{confirming && <ConfirmDialog title="Permanently close this workspace?" description="This removes the workspace's sheets, credentials, settings, agent keys, and queued jobs. Cancel the app subscription first. Billing records and provider usage receipts are retained. The workspace cannot be reopened." confirmLabel="Close workspace" danger loading={busy} onClose={() => { if (!busy) setConfirming(false); }} onConfirm={closeWorkspace} />}
	</section>;
}

type ProductBilling = { configured: boolean; required: boolean; subscription: null | { status: string; currentPeriodEnd: number | null; cancelAtPeriodEnd: boolean; active: boolean } };

function SubscriptionBilling() {
	const [billing, setBilling] = useState<ProductBilling | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [notice, setNotice] = useState('');
	useEffect(() => {
		const query = new URLSearchParams(window.location.search);
		const checkoutNotice = query.get('billing') === 'success'
			? 'Checkout completed. Your workspace access updates when Stripe confirms the subscription.'
			: query.get('billing') === 'cancelled' ? 'Checkout was cancelled. No subscription was started.' : '';
		let stopped = false;
		fetch('/api/billing', { headers: accountHeaders(), cache: 'no-store' }).then(async (response) => {
			const data = await response.json().catch(() => null) as ProductBilling | { error?: string } | null;
			if (!response.ok) throw new Error((data as { error?: string } | null)?.error || 'Could not load subscription status.');
			if (!stopped) { setBilling(data as ProductBilling); if (checkoutNotice) setNotice(checkoutNotice); }
		}).catch((cause: unknown) => { if (!stopped) { setError(cause instanceof Error ? cause.message : 'Could not load subscription status.'); if (checkoutNotice) setNotice(checkoutNotice); } });
		return () => { stopped = true; };
	}, []);
	async function openBilling(path: '/api/billing' | '/api/billing/portal') {
		setBusy(true); setError('');
		try {
			const response = await fetch(path, { method: 'POST', headers: { ...accountHeaders(), ...(path === '/api/billing' ? { 'idempotency-key': crypto.randomUUID() } : {}) } });
			const data = await response.json().catch(() => null) as { url?: string; error?: string } | null;
			if (!response.ok || !data?.url) throw new Error(data?.error || 'Could not open Stripe billing.');
			window.location.assign(data.url);
		} catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open Stripe billing.'); setBusy(false); }
	}
	const active = billing?.subscription?.active;
	return <section aria-labelledby="product-billing-title" className="glass-card flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
		<div className="flex min-w-0 flex-col gap-1">
			<h2 id="product-billing-title" className="text-body text-fg">Monid Enrich subscription</h2>
			<p className="text-body-sm text-fg-muted">This subscription is for the app. Monid, Treg, and OpenAI usage remain billed separately by their providers.</p>
			{billing && <p className="text-caption text-fg-subtle">{!billing.configured ? 'Subscription billing is not configured for this deployment.' : active ? `Status: ${billing.subscription?.status}${billing.subscription?.cancelAtPeriodEnd ? ' · cancels at period end' : ''}${billing.subscription?.currentPeriodEnd ? ` · renews ${new Date(billing.subscription.currentPeriodEnd * 1000).toLocaleDateString()}` : ''}` : 'No active subscription for this workspace.'}</p>}
			{notice && <p role="status" className="text-caption text-success">{notice}</p>}
			{error && <p role="alert" className="text-caption text-danger">{error}</p>}
		</div>
		{billing?.configured && <Button size="sm" className="shrink-0 self-start sm:self-auto" loading={busy} onClick={() => void openBilling(active ? '/api/billing/portal' : '/api/billing')}>{active ? 'Manage subscription' : 'Start subscription'}</Button>}
	</section>;
}

function MobilePhoneProviderSettings() {
	const { settings, update, organization, memberPreferences, memberPreferencesError, updateMemberPreferences } = useSettings();
	const { toast } = useToast();
	const allowed = settings.mobilePhoneProviders?.length ? settings.mobilePhoneProviders : DEFAULT_ALLOWED_PHONE_PROVIDERS;
	const strategies = allowedPhoneStrategies(allowed);
	const currentDefault = strategies.includes(memberPreferences.defaultPhoneStrategy) ? memberPreferences.defaultPhoneStrategy : strategies[0] ?? 'leadmagic';
	const [allowedDraft, setAllowedDraft] = useState<PhoneProvider[] | null>(null);
	const [defaultDraft, setDefaultDraft] = useState<typeof currentDefault | null>(null);
	const [savingWorkspace, setSavingWorkspace] = useState(false);
	const [savingMember, setSavingMember] = useState(false);
	const [error, setError] = useState('');
	const draftAllowed = allowedDraft ?? allowed;
	const draftStrategies = allowedPhoneStrategies(draftAllowed);
	const draftDefault = defaultDraft && draftStrategies.includes(defaultDraft) ? defaultDraft : draftStrategies.includes(currentDefault) ? currentDefault : draftStrategies[0] ?? 'leadmagic';
	const workspaceChanged = JSON.stringify(draftAllowed) !== JSON.stringify(allowed);

	function toggleProvider(provider: PhoneProvider, checked: boolean) {
		const next = checked ? [...draftAllowed, provider] : draftAllowed.filter((entry) => entry !== provider);
		if (!next.length) { setError('Keep at least one mobile provider enabled.'); return; }
		setAllowedDraft(PHONE_PROVIDERS.filter((entry) => next.includes(entry)));
		setError('');
	}

	async function saveWorkspace() {
		setSavingWorkspace(true); setError('');
		try {
			await update({ mobilePhoneProviders: draftAllowed }, organization?.revision);
			setAllowedDraft(null); setDefaultDraft(null);
			toast('Workspace mobile providers saved.', 'success');
		} catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save workspace providers.'); }
		finally { setSavingWorkspace(false); }
	}

	async function saveMemberDefault() {
		setSavingMember(true); setError('');
		try {
			await updateMemberPreferences({ defaultPhoneStrategy: draftDefault });
			setDefaultDraft(null);
			toast('Your mobile lookup default saved.', 'success');
		} catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save your default.'); }
		finally { setSavingMember(false); }
	}

	return <section aria-labelledby="mobile-providers-title" className="glass-card flex flex-col gap-5 px-5 py-5">
		<div className="flex flex-col gap-1">
			<h2 id="mobile-providers-title" className="text-body text-fg">Mobile phone providers</h2>
			<p className="text-body-sm text-fg-muted">Choose which Monid routes your workspace allows, then set your personal default. Provider calls are billed to the workspace Monid wallet.</p>
		</div>
		<div className="flex flex-col gap-3">
			<div><h3 className="text-body-sm font-medium text-fg">Workspace provider access</h3><p className="text-caption text-fg-subtle">Members can only select strategies that use enabled providers.</p></div>
			<div className="grid gap-2 sm:grid-cols-2">
				{PHONE_PROVIDERS.map((provider) => <label key={provider} className="flex items-center justify-between gap-3 rounded-lg border border-line-subtle px-3 py-2.5">
					<span><span className="block text-body-sm text-fg">{provider === 'leadmagic' ? 'LeadMagic' : 'Clay'} via Monid</span><span className="block text-caption text-fg-subtle">{provider === 'leadmagic' ? 'Fast lookup; no-match calls are billable.' : 'Requires LinkedIn, name, and company; no-match results are not billed.'}</span></span>
					<Switch checked={draftAllowed.includes(provider)} onChange={(checked) => toggleProvider(provider, checked)} label={`Allow ${provider === 'leadmagic' ? 'LeadMagic' : 'Clay'} via Monid`} />
				</label>)}
			</div>
			<Button size="sm" className="self-start" disabled={!workspaceChanged || !draftAllowed.length} loading={savingWorkspace} onClick={() => void saveWorkspace()}>Save workspace providers</Button>
		</div>
		<div className="flex flex-col gap-3 border-t border-line-subtle pt-5">
			<div><h3 className="text-body-sm font-medium text-fg">My default strategy</h3><p className="text-caption text-fg-subtle">Used when you create a new mobile-number column. You can override it per column.</p></div>
			<Field label="Provider strategy" help="Waterfalls continue only after a completed no-match. Provider errors and uncertain timeouts stop the chain.">
				{(id) => <Select id={id} value={draftDefault} onValueChange={(value) => setDefaultDraft(value as typeof currentDefault)} className="max-w-md">
					{draftStrategies.map((strategy) => <option key={strategy} value={strategy}>{PHONE_STRATEGY_INFO[strategy].label}</option>)}
				</Select>}
			</Field>
			<p className="max-w-2xl text-caption text-fg-subtle">LeadMagic is billed on a no-match; Clay no-match results are not billed. Waterfalls can make two paid requests, and each Monid run’s actual cost is recorded with the cell.</p>
			{memberPreferencesError && <p role="alert" className="text-body-sm text-danger">{memberPreferencesError}</p>}
			{memberPreferences.defaultPhoneStrategy !== currentDefault && <p role="status" className="text-caption text-warning">Your previous default uses a provider the workspace disabled. Save an enabled strategy.</p>}
			<Button size="sm" className="self-start" disabled={!draftDefault || draftDefault === memberPreferences.defaultPhoneStrategy && !memberPreferencesError} loading={savingMember} onClick={() => void saveMemberDefault()}>Save my default</Button>
		</div>
		{error && <p role="alert" className="text-body-sm text-danger">{error}</p>}
	</section>;
}

function MonidWallet() {
	return (
		<section aria-labelledby="monid-wallet-title" className="glass-card flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
			<div className="flex min-w-0 flex-col gap-1">
				<h2 id="monid-wallet-title" className="text-body text-fg">Monid wallet</h2>
				<p className="text-body-sm text-fg-muted">Add funds to your Monid balance. Top-ups are completed securely in Monid via Stripe.</p>
			</div>
			<a href="https://app.monid.ai" target="_blank" rel="noopener noreferrer" className={buttonClassName('outline', 'sm')}>
				Top up wallet <ExternalLink aria-hidden="true" />
			</a>
		</section>
	);
}

type TregBilling = { connected: boolean; balanceUsd: number | null; topupDefaultUsd: number | null; teamName: string | null };
type TregUsage = { callId: string; operation: string; status: string; costUsd: number | null; servedVia: string | null; createdAt: number };
type TregUsageResponse = { runs: TregUsage[]; localOnly?: boolean; error?: string };

function TregWallet() {
	const { connections } = useSettings();
	const [billing, setBilling] = useState<TregBilling | null>(null);
	const [usage, setUsage] = useState<TregUsage[]>([]);
	const [usageLocalOnly, setUsageLocalOnly] = useState(false);
	const [usageError, setUsageError] = useState('');
	const [amount, setAmount] = useState('');
	const [topupBusy, setTopupBusy] = useState(false);
	const [error, setError] = useState('');
	const connected = connections.treg.state !== 'missing' && connections.treg.state !== 'expired';
	const loading = connected && billing === null && !error;

	useEffect(() => {
		if (!connected) return;
		let cancelled = false;
		const usageRequest: Promise<TregUsageResponse> = fetch('/api/treg/usage', { headers: accountHeaders(), cache: 'no-store' }).then(async (response) => {
			if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Could not load Treg usage.');
			return await response.json() as TregUsageResponse;
		}).catch((cause: unknown) => ({ runs: [], localOnly: false, error: cause instanceof Error ? cause.message : 'Could not load Treg usage.' }));
		void Promise.all([
			fetch('/api/treg/billing', { headers: accountHeaders(), cache: 'no-store' }).then(async (response) => { if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Could not load Treg billing.'); return await response.json() as TregBilling; }),
			usageRequest,
		]).then(([nextBilling, nextUsage]) => { if (!cancelled) { setBilling(nextBilling); setUsage(nextUsage.runs); setUsageLocalOnly(Boolean(nextUsage.localOnly)); setUsageError(nextUsage.error ?? ''); setError(''); } }).catch((cause: unknown) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load Treg billing.'); });
		return () => { cancelled = true; };
	}, [connected]);

	async function topup() {
		const amountUsd = Number(amount);
		if (!Number.isFinite(amountUsd) || amountUsd <= 0) { setError('Enter a positive amount in USD.'); return; }
		setTopupBusy(true); setError('');
		try {
			const response = await fetch('/api/treg/topup', { method: 'POST', headers: { ...accountHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ amountUsd }) });
			const data = await response.json().catch(() => null) as { checkoutUrl?: string; error?: string } | null;
			if (!response.ok || !data?.checkoutUrl) throw new Error(data?.error || 'Could not start Treg top-up.');
			window.location.assign(data.checkoutUrl);
		} catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not start Treg top-up.'); setTopupBusy(false); }
	}

	return <section aria-labelledby="treg-wallet-title" className="glass-card flex flex-col gap-4 px-5 py-5">
		<div className="flex flex-col gap-1">
			<h2 id="treg-wallet-title" className="text-body text-fg">Treg billing</h2>
			<p className="text-body-sm text-fg-muted">Treg calls and top-ups use your separate Treg team balance. Monid wallet funds and usage are not used here.</p>
		</div>
		{!connected ? <p className="text-body-sm text-fg-subtle">Connect Treg above to view its balance, top up, and see Treg-only usage.</p> : <>
			<div className="flex flex-wrap items-end gap-3 rounded-lg border border-line-subtle px-3 py-3">
				<div className="min-w-40 flex-1"><span className="block text-caption text-fg-subtle">{billing?.teamName ? `${billing.teamName} · Treg balance` : 'Treg team balance'}</span><span className="block text-title-sm text-fg tabular">{loading ? 'Loading…' : billing?.balanceUsd !== null && billing?.balanceUsd !== undefined ? `$${billing.balanceUsd.toFixed(2)}` : 'Not reported'}</span></div>
				<Field label="Top-up amount (USD)" help={billing?.topupDefaultUsd ? `Treg's suggested amount is $${billing.topupDefaultUsd.toFixed(2)}.` : 'Treg validates the amount against its current limits.'}>
					{(id) => <Input id={id} type="number" min={0.01} step="any" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder={billing?.topupDefaultUsd ? String(billing.topupDefaultUsd) : '25'} className="w-36" />}
				</Field>
				<Button size="sm" disabled={!connected || !amount || loading} loading={topupBusy} onClick={() => void topup()}>Top up Treg</Button>
			</div>
			<p className="text-caption text-fg-subtle">Checkout is hosted by Treg. The displayed balance changes after Treg confirms payment.</p>
			<div className="flex flex-col gap-2 border-t border-line-subtle pt-3">
				<h3 className="text-body-sm text-fg">Recent Treg usage</h3>
				{usage.length ? usage.slice(0, 8).map((run) => <div key={run.callId} title={run.callId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-subtle"><span className="min-w-40 flex-1 text-fg-muted">{run.operation}</span><span>{run.status}</span>{run.costUsd !== null && <span>${run.costUsd.toFixed(4)}</span>}{run.servedVia && <span>via {run.servedVia}</span>}<span>{new Date(run.createdAt).toLocaleString()}</span></div>) : <p className="text-caption text-fg-subtle">{usageLocalOnly ? 'This browser-only workspace keeps Treg run details on each cell.' : 'No Treg calls recorded for this workspace yet.'}</p>}
				{usageError && <p role="status" className="text-caption text-warning">Treg balance is available, but usage history could not load: {usageError}</p>}
			</div>
		</>}
		{error && <p role="alert" className="text-body-sm text-danger">{error}</p>}
	</section>;
}

const clampConcurrency = (value: number) => Math.max(1, Math.min(16, Math.round(value)));

function Defaults() {
	const { settings, update, organization } = useSettings();
	const { toast } = useToast();
	const [draft, setDraft] = useState<Partial<Settings> | null>(null);
	const [concurrencyText, setConcurrencyText] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');
	// The revision this draft started from: a teammate's save in between is reported as a conflict, not overwritten.
	const draftRevision = useRef<number | undefined>(undefined);
	const values = { ...settings, ...draft };
	function change(patch: Partial<Settings>) {
		if (!draft) draftRevision.current = organization?.revision;
		setDraft((current) => ({ ...current, ...patch }));
		setError('');
	}
	/** One save for the card. A new company website must resolve to a brand first, so a bad domain never saves. */
	async function save() {
		if (!draft) return;
		setSaving(true); setError('');
		try {
			const patch = { ...draft };
			if (patch.companyDomain !== undefined) {
				const domain = brandingDomain(patch.companyDomain);
				if (domain === null) throw new Error('Enter a valid company website.');
				await loadBrand(domain);
				patch.companyDomain = domain;
			}
			await update(patch, draftRevision.current);
			setDraft(null); setConcurrencyText(null);
			toast('Defaults saved.', 'success');
		} catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save defaults.'); }
		finally { setSaving(false); }
	}
	return (
		<section aria-labelledby="defaults-title" className="glass-card flex flex-col gap-5 px-5 py-5">
			<h2 id="defaults-title" className="text-body text-fg">Defaults</h2>
			<Field label="Parallel cells" help="How many cells enrich at once. Lower it if you hit rate limits.">
				{(id) => <Input id={id} type="number" min={1} max={16} value={concurrencyText ?? String(values.concurrency)} onChange={(event) => { const text = event.target.value; setConcurrencyText(text); if (text.trim() && Number.isFinite(Number(text))) change({ concurrency: clampConcurrency(Number(text)) }); }} onBlur={() => setConcurrencyText(null)} className="max-w-28" />}
			</Field>
			<details className="group/advanced flex flex-col">
				<summary className="cursor-pointer text-body-sm text-fg-muted hover:text-fg">Advanced</summary>
				<div className="flex flex-col gap-5 pt-4">
					<ModelDefaults values={values} draft={draft} onChange={change} />
				</div>
			</details>
			<div className="border-t border-line-subtle pt-5"><CompanyBranding value={values.companyDomain ?? ''} onChange={(companyDomain) => change({ companyDomain })} /></div>
			{error && <p role="alert" className="text-body-sm text-danger">{error}</p>}
			<Button size="sm" className="self-start" disabled={!draft} loading={saving} onClick={() => void save()}>Save defaults</Button>
		</section>
	);
}

/** The model or base URL was edited away from the saved value, so it needs a live test. */
const modelEdited = (draft: Partial<Settings> | null, settings: Settings) => (draft?.model !== undefined && draft.model !== settings.model) || (draft?.openaiBaseUrl !== undefined && draft.openaiBaseUrl !== settings.openaiBaseUrl);

function ModelDefaults({ values, draft, onChange }: { values: Settings; draft: Partial<Settings> | null; onChange: (patch: Partial<Settings>) => void }) {
	const { settings, server, connections } = useSettings();
	const trialInUse = connections.openai.state === 'included';
	const modelChanged = modelEdited(draft, settings);
	const modelCheck = useVerification(values, modelChanged && !trialInUse && isReady(connections.openai) ? ['openai'] : [], { inference: true });
	if (trialInUse) return <p className="text-body-sm text-fg-muted">Your workspace uses the included AI trial{server?.openaiTrial ? ` (${server.openaiTrial.model})` : ''}. Connect your own OpenAI key to choose models.</p>;
	return <>
		<Field label="AI model" help="Used for AI columns, research, and Find rows. Any OpenAI model ID works.">
			{(id) => <ModelPicker id={id} value={values.model} onChange={(model) => onChange({ model })} />}
		</Field>
		{modelChanged && <ModelCheckLine checking={modelCheck.checking} check={providerCheck(modelCheck.result, 'openai')} />}
		<Field label="Yes/no and category answers" help="These structured reasoning features use your optional OpenAI key.">
			{(id) => <ModelPicker id={id} value={values.classifierModel} onChange={(classifierModel) => onChange({ classifierModel, preferJev: classifierModel === 'decisions' })} classifier />}
		</Field>
		<Field label="OpenAI-compatible base URL (optional)" help="Leave empty for OpenAI. Set it for Azure OpenAI, a proxy, or a local server; those use the Chat Completions API.">
			{(id) => <Input id={id} value={values.openaiBaseUrl} onChange={(event) => onChange({ openaiBaseUrl: event.target.value.trim() })} placeholder="https://api.openai.com/v1" spellCheck={false} />}
		</Field>
	</>;
}

function ModelCheckLine({ checking, check }: { checking: boolean; check?: ProviderCheck }) {
	if (checking) return <p role="status" className="-mt-3 text-caption text-fg-subtle">Testing this model…</p>;
	if (!check) return null;
	return <p role={check.ok ? 'status' : 'alert'} className={`-mt-3 text-caption ${check.ok ? 'text-success' : 'text-danger'}`}>{check.ok ? 'This model works with your key.' : check.message ?? 'This model did not respond.'}</p>;
}

/** Offered only when this browser still holds sheets from before workspaces were shared. */
function LegacySheetsImport() {
	const { toast } = useToast();
	const [available, setAvailable] = useState(false);
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		let cancelled = false;
		void Dexie.exists(accountStorageKey('enrichable')).then((exists) => { if (!cancelled) setAvailable(exists); }, () => {});
		return () => { cancelled = true; };
	}, []);
	if (!available) return null;
	return (
		<section className="glass-card flex flex-col items-start justify-between gap-4 px-5 py-4 sm:flex-row sm:items-center">
			<div className="flex min-w-0 flex-col gap-0.5"><span className="text-body-sm text-fg">Import my previous local sheets</span><span className="text-caption text-fg-subtle">This browser has sheets saved before workspaces were shared.</span></div>
			<Button size="sm" onClick={() => setOpen(true)}>Import local sheets</Button>
			{open && <ConfirmDialog title="Share your local sheets with your workspace?" description="Your previous local sheets are copied to the cloud, where everyone in your workspace can view, edit, and delete them. The 10-sheet and 1,000-row limits apply. Original local copies stay intact." confirmLabel="Import and share" loading={busy} onClose={() => { if (!busy) setOpen(false); }} onConfirm={async () => {
				setBusy(true);
				try { const count = await importMyLocalSheets(); toast(count ? `Imported ${count} sheets` : 'No new local sheets to import.', 'success'); setOpen(false); }
				catch (cause) { toast(cause instanceof Error ? cause.message : 'Could not import local sheets.', 'error'); }
				finally { setBusy(false); }
			}} />}
		</section>
	);
}
