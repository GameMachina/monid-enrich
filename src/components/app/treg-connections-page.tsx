'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import clsx from 'clsx';
import { ArrowLeft, CheckCircle2, ExternalLink, KeyRound, Search, Unplug } from 'lucide-react';
import { accountHeaders } from '@/lib/account-storage';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Segmented, Select } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useSettings } from './settings-context';

type TregProvider = {
	service: string; displayName: string; category: string; summary: string; authKind: string; enabled?: boolean; configured?: boolean;
	tokenLabel: string; tokenPlaceholder: string; setupUrl: string; setupActionLabel: string; setupSteps: string[]; setupNote: string;
	needsExtraCredential: boolean; extraCredentialLabel: string; extraCredentialNote: string; capability: string; resourceLabel: string; resourcePlural: string;
};
type TregConnection = {
	secretId: number; service: string; displayName: string; name: string; category: string; authKind: string; status: string;
	expiresAt?: string; identity?: string; resourceLabel: string; resourcePlural: string; resource?: { ref: string; name: string };
};
type TregResource = { ref: string; name: string; detail: string };
type DirectoryTab = 'all' | 'account' | 'key';

async function readJson<T>(response: Response, fallback: string): Promise<T> {
	const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
	if (!response.ok) throw new Error(body?.error || fallback);
	if (!body) throw new Error(fallback);
	return body;
}

function usesOAuth(provider: TregProvider) {
	return provider.authKind.includes('oauth') || provider.authKind === 'account';
}

function statusLabel(connection: TregConnection) {
	const status = connection.status.toLowerCase();
	if (status.includes('expired') || status.includes('error') || status.includes('invalid')) return { label: 'Needs attention', className: 'text-danger' };
	if (status.includes('pending')) return { label: 'Pending', className: 'text-warning' };
	return { label: 'Connected', className: 'text-success' };
}

export function TregConnectionsPage() {
	const { openKeys, providerReady } = useSettings();
	const { toast } = useToast();
	const tregReady = providerReady('treg');
	const [providers, setProviders] = useState<TregProvider[]>([]);
	const [connections, setConnections] = useState<TregConnection[]>([]);
	const [loadingDirectory, setLoadingDirectory] = useState(true);
	const [directoryError, setDirectoryError] = useState('');
	const [directoryRetry, setDirectoryRetry] = useState(0);
	const [loadingConnections, setLoadingConnections] = useState(true);
	const [search, setSearch] = useState('');
	const [tab, setTab] = useState<DirectoryTab>('all');
	const [editing, setEditing] = useState<TregProvider | null>(null);
	const [disconnecting, setDisconnecting] = useState<TregConnection | null>(null);
	const [error, setError] = useState('');
	const [pendingOAuth, setPendingOAuth] = useState<{ state: string; service: string; url: string; popupOpened: boolean } | null>(null);
	const [openingResource, setOpeningResource] = useState<number | null>(null);
	const [resources, setResources] = useState<Record<number, TregResource[]>>({});
	const [selectedResource, setSelectedResource] = useState<Record<number, string>>({});
	const popupRef = useRef<Window | null>(null);

	const refreshConnections = useCallback(async () => {
		if (!tregReady) { setConnections([]); return; }
		setLoadingConnections(true);
		try {
			const response = await fetch('/api/treg/connections', { headers: accountHeaders(), cache: 'no-store' });
			const data = await readJson<{ connections: TregConnection[] }>(response, 'Could not load Treg connections.');
			setConnections(data.connections);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Could not load Treg connections.');
		} finally { setLoadingConnections(false); }
	}, [tregReady]);

	useEffect(() => {
		let cancelled = false;
		void fetch('/api/treg/connections/providers', { headers: accountHeaders(), cache: 'no-store' }).then((response) => readJson<{ providers: TregProvider[] }>(response, 'Could not load Treg providers.')).then((data) => {
			if (!cancelled) { setProviders(data.providers); setDirectoryError(''); }
		}).catch((cause: unknown) => {
			if (!cancelled) setDirectoryError(cause instanceof Error ? cause.message : 'Could not load Treg providers.');
		}).finally(() => { if (!cancelled) setLoadingDirectory(false); });
		return () => { cancelled = true; };
	}, [directoryRetry]);

	useEffect(() => {
		if (!tregReady) return;
		let cancelled = false;
		const loadConnections = async () => {
			try {
				const response = await fetch('/api/treg/connections', { headers: accountHeaders(), cache: 'no-store' });
				const data = await readJson<{ connections: TregConnection[] }>(response, 'Could not load Treg connections.');
				if (!cancelled) setConnections(data.connections);
			} catch (cause) {
				if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load Treg connections.');
			} finally {
				if (!cancelled) setLoadingConnections(false);
			}
		};
		void loadConnections();
		return () => { cancelled = true; };
	}, [tregReady]);

	useEffect(() => {
		if (!pendingOAuth || !tregReady) return;
		let cancelled = false;
		let attempts = 0;
		const check = async () => {
			attempts += 1;
			if (attempts > 96) {
				if (!cancelled) { setPendingOAuth(null); setError('Treg authorization timed out. You can try connecting the account again.'); }
				return;
			}
			try {
				const response = await fetch(`/api/treg/connections/oauth?state=${encodeURIComponent(pendingOAuth.state)}`, { headers: accountHeaders(), cache: 'no-store' });
				const status = await readJson<{ connected: boolean; status: string; message?: string }>(response, 'Could not check Treg authorization.');
				if (status.connected) {
					popupRef.current?.close(); popupRef.current = null;
					if (!cancelled) { setPendingOAuth(null); setError(''); await refreshConnections(); toast(`${providers.find((provider) => provider.service === pendingOAuth.service)?.displayName ?? 'Account'} connected to Treg.`, 'success'); }
				} else if (['failed', 'error', 'denied', 'cancelled'].includes(status.status)) {
					popupRef.current?.close(); popupRef.current = null;
					if (!cancelled) { setPendingOAuth(null); setError(status.message || 'Treg account authorization did not complete.'); }
				}
			} catch (cause) {
				if (!cancelled) { setPendingOAuth(null); setError(cause instanceof Error ? cause.message : 'Could not check Treg authorization.'); }
			}
		};
		const timer = window.setInterval(() => { void check(); }, 2500);
		void check();
		return () => { cancelled = true; window.clearInterval(timer); };
	}, [pendingOAuth, providers, refreshConnections, toast, tregReady]);

	const connectedByService = useMemo(() => connections.reduce<Record<string, TregConnection[]>>((result, connection) => {
		(result[connection.service] ??= []).push(connection); return result;
	}, {}), [connections]);
	const filtered = useMemo(() => {
		const query = search.trim().toLowerCase();
		return providers.filter((provider) => {
			if (tab === 'account' && !usesOAuth(provider)) return false;
			if (tab === 'key' && usesOAuth(provider)) return false;
			return !query || [provider.displayName, provider.service, provider.category, provider.summary].some((text) => text.toLowerCase().includes(query));
		});
	}, [providers, search, tab]);
	const accountCount = providers.filter(usesOAuth).length;
	const keyCount = providers.length - accountCount;
	const grouped = useMemo(() => filtered.reduce<Record<string, TregProvider[]>>((result, provider) => {
		(result[provider.category] ??= []).push(provider); return result;
	}, {}), [filtered]);

	async function startOAuth(provider: TregProvider) {
		setError('');
		const popup = window.open('about:blank', '_blank', 'popup,width=720,height=760');
		popupRef.current = popup;
		try {
			const response = await fetch('/api/treg/connections/oauth', { method: 'POST', headers: { ...accountHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ service: provider.service, ...(provider.capability ? { capability: provider.capability } : {}), name: provider.displayName }) });
			const data = await readJson<{ authorizationUrl: string; state: string }>(response, `Could not start ${provider.displayName} authorization.`);
			if (popup) popup.location.assign(data.authorizationUrl);
			setPendingOAuth({ state: data.state, service: provider.service, url: data.authorizationUrl, popupOpened: Boolean(popup) });
		} catch (cause) {
			popup?.close(); popupRef.current = null;
			setError(cause instanceof Error ? cause.message : `Could not start ${provider.displayName} authorization.`);
		}
	}

	async function disconnect(connection: TregConnection) {
		const response = await fetch(`/api/treg/connections/${connection.secretId}`, { method: 'DELETE', headers: accountHeaders() });
		await readJson(response, 'Could not disconnect this Treg provider.');
		setDisconnecting(null);
		await refreshConnections();
		toast(`${connection.displayName} disconnected from Treg.`, 'success');
	}

	async function loadResources(connection: TregConnection) {
		setOpeningResource(connection.secretId);
		setError('');
		try {
			const response = await fetch(`/api/treg/connections/${connection.secretId}/resources`, { headers: accountHeaders(), cache: 'no-store' });
			const data = await readJson<{ resources: TregResource[] }>(response, 'Could not load provider account resources.');
			setResources((current) => ({ ...current, [connection.secretId]: data.resources }));
			setSelectedResource((current) => ({ ...current, [connection.secretId]: connection.resource?.ref ?? data.resources[0]?.ref ?? '' }));
		} catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load provider account resources.'); }
		finally { setOpeningResource(null); }
	}

	async function saveResource(connection: TregConnection) {
		const ref = selectedResource[connection.secretId];
		const resource = resources[connection.secretId]?.find((item) => item.ref === ref);
		if (!ref || !resource) return;
		try {
			const response = await fetch(`/api/treg/connections/${connection.secretId}/resources`, { method: 'POST', headers: { ...accountHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ resource_ref: ref, resource_name: resource.name }) });
			await readJson(response, 'Could not save this provider account resource.');
			await refreshConnections();
			toast(`${resource.name} selected for ${connection.displayName}.`, 'success');
		} catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this provider account resource.'); }
	}

	return <div className="scrollbar-thin flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6 md:px-12 md:pt-10 md:pb-16">
		<div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6">
			<Link href="/app/settings" className="inline-flex w-fit items-center gap-2 rounded-md text-body-sm text-fg-muted hover:text-fg"><ArrowLeft aria-hidden="true" className="size-4" />Configuration</Link>
			<header className="flex flex-col gap-1">
				<h1 className="text-h4 text-fg">Treg connections</h1>
				<p className="max-w-3xl text-body-sm text-fg-muted">Connect provider accounts and API keys to your Treg team. Treg stores the credentials and injects them server-side. Connections are shared by the Treg team; Treg and upstream provider billing remain separate from Monid.</p>
			</header>

			{!tregReady && <section className="flex flex-wrap items-center gap-4 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3">
				<div className="min-w-0 flex-1"><h2 className="text-body-sm text-fg">Connect Treg to manage its providers</h2><p className="text-caption text-fg-muted">Your Treg API key is used only by the server to manage your Treg team’s connections.</p></div>
				<Button variant="brand" size="sm" onClick={() => openKeys('treg')}>Connect Treg</Button>
			</section>}

			{tregReady && <section aria-labelledby="connected-treg-accounts" className="rounded-xl border border-line-subtle bg-surface px-4 py-4">
				<div className="mb-3 flex flex-wrap items-center justify-between gap-3">
					<div><h2 id="connected-treg-accounts" className="text-body text-fg">Connected to your Treg team</h2><p className="text-caption text-fg-subtle">{loadingConnections ? 'Refreshing…' : `${connections.length} ${connections.length === 1 ? 'connection' : 'connections'}`}</p></div>
				</div>
				{connections.length === 0 && !loadingConnections ? <p className="text-body-sm text-fg-subtle">No provider accounts connected yet.</p> : <ul className="divide-y divide-line-subtle">
					{connections.map((connection) => {
						const provider = providers.find((item) => item.service === connection.service);
						const status = statusLabel(connection);
						const resourcePlural = connection.resourcePlural || provider?.resourcePlural;
						return <li key={connection.secretId} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
							<div className="flex min-w-0 flex-1 items-start gap-3">
								<span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-subtle bg-surface-secondary text-[12px] font-semibold text-fg-muted">{connection.displayName.slice(0, 1).toUpperCase()}</span>
								<div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2"><span className="text-body-sm font-medium text-fg">{connection.name || connection.displayName}</span><span className={clsx('inline-flex items-center gap-1 text-caption', status.className)}><CheckCircle2 aria-hidden="true" className="size-3.5" />{status.label}</span></div>
									<p className="truncate text-caption text-fg-subtle">{connection.displayName}{connection.identity ? ` · ${connection.identity}` : ''}{connection.expiresAt ? ` · expires ${new Date(connection.expiresAt).toLocaleDateString()}` : ''}</p>
									{connection.resource?.name && <p className="text-caption text-fg-subtle">Using {connection.resource.name}</p>}
								</div>
							</div>
							<div className="flex flex-wrap items-center gap-2 sm:justify-end">
								{resourcePlural && <Button size="xs" loading={openingResource === connection.secretId} onClick={() => void loadResources(connection)}>{connection.resource?.name ? 'Change account' : `Choose ${resourcePlural}`}</Button>}
								<Button size="xs" onClick={() => setDisconnecting(connection)}><Unplug aria-hidden="true" className="size-3.5" />Disconnect</Button>
							</div>
							{resources[connection.secretId] && <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:pl-12">
								<Field label={`Treg ${connection.resourceLabel || 'account'} resource`}>{(id) => <Select id={id} value={selectedResource[connection.secretId] ?? ''} onValueChange={(value) => setSelectedResource((current) => ({ ...current, [connection.secretId]: value }))}>
									{resources[connection.secretId].map((resource) => <option key={resource.ref} value={resource.ref}>{resource.name}{resource.detail ? ` · ${resource.detail}` : ''}</option>)}
								</Select>}</Field>
								<Button size="xs" variant="brand" disabled={!selectedResource[connection.secretId]} onClick={() => void saveResource(connection)}>Save resource</Button>
							</div>}
						</li>;
					})}
				</ul>}
			</section>}

			<section aria-labelledby="add-treg-connection" className="flex flex-col gap-4">
				<div className="flex flex-col gap-3 lg:flex-row lg:items-center">
					<h2 id="add-treg-connection" className="shrink-0 text-body text-fg">Add a connection <span className="ml-1 text-caption text-fg-subtle">{providers.length}</span></h2>
					<div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row">
						<label className="relative min-w-0 flex-1">
							<Search aria-hidden="true" className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fg-subtle" />
							<span className="sr-only">Filter Treg providers</span>
							<Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter providers, e.g. Apollo, Google Ads, video" className="pl-10" />
						</label>
						<Segmented value={tab} options={[
							{ value: 'all', label: <>All <span className="text-caption text-fg-subtle">{providers.length}</span></> },
							{ value: 'account', label: <>Your account <span className="text-caption text-fg-subtle">{accountCount}</span></> },
							{ value: 'key', label: <>API key <span className="text-caption text-fg-subtle">{keyCount}</span></> },
						]} onChange={setTab} label="Filter providers by connection type" />
					</div>
				</div>

				{loadingDirectory ? <div className="grid gap-3 sm:grid-cols-2"><div className="skeleton h-20 rounded-xl" /><div className="skeleton h-20 rounded-xl" /></div> : directoryError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/20 bg-danger-soft px-4 py-4"><p className="min-w-0 flex-1 text-body-sm text-danger">Could not load Treg’s provider directory. {directoryError}</p><Button size="xs" onClick={() => { setLoadingDirectory(true); setDirectoryError(''); setDirectoryRetry((attempt) => attempt + 1); }}>Retry</Button></div> : providers.length === 0 ? <p className="rounded-xl border border-line-subtle bg-surface px-4 py-8 text-center text-body-sm text-fg-subtle">Treg returned no providers in its directory.</p> : Object.keys(grouped).length === 0 ? <p className="rounded-xl border border-line-subtle bg-surface px-4 py-8 text-center text-body-sm text-fg-subtle">No providers match this search.</p> : Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([category, items]) => <section key={category} aria-label={category} className="flex flex-col gap-3">
					<h3 className="text-body-sm font-medium text-fg-muted">{category} <span className="ml-1 text-caption text-fg-subtle">{items.length}</span></h3>
					<div className="grid gap-3 lg:grid-cols-3">
						{items.map((provider) => {
							const oauth = usesOAuth(provider);
							const attached = connectedByService[provider.service] ?? [];
							const unavailable = provider.enabled === false || oauth && provider.configured === false;
							return <article key={provider.service} className="flex min-w-0 flex-col justify-between gap-3 rounded-xl border border-line-subtle bg-surface px-3.5 py-3 shadow-[0_2px_3px_-2px_rgb(0_0_0/0.06)] sm:flex-row sm:items-center">
								<div className="flex min-w-0 items-center gap-3">
									<span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line-subtle bg-surface-secondary text-[12px] font-semibold text-fg-muted">{provider.displayName.slice(0, 1).toUpperCase()}</span>
									<div className="min-w-0"><h4 className="truncate text-body-sm font-medium text-fg">{provider.displayName}</h4><p className="truncate text-caption text-fg-subtle">{attached.length ? `${attached.length} connected · ${provider.summary}` : oauth ? 'Your account' : 'API key'}{!attached.length && provider.summary ? ` · ${provider.summary}` : ''}</p></div>
								</div>
								{attached.length ? <span className="inline-flex shrink-0 items-center gap-1 text-caption text-success"><CheckCircle2 aria-hidden="true" className="size-3.5" />Connected</span> : unavailable ? <span className="max-w-40 text-right text-caption text-fg-subtle">{provider.enabled === false ? 'Unavailable in Treg' : 'Treg account connection is not configured'}</span> : <Button size="xs" onClick={() => oauth ? void startOAuth(provider) : setEditing(provider)} disabled={!tregReady || Boolean(pendingOAuth)} title={!tregReady ? 'Connect Treg first' : undefined}>
									{oauth ? <><ExternalLink aria-hidden="true" className="size-3.5" />Connect account</> : <><KeyRound aria-hidden="true" className="size-3.5" />Connect account</>}
								</Button>}
							</article>;
						})}
					</div>
				</section>)}
			</section>

			{pendingOAuth && <div role="status" className="fixed right-4 bottom-4 z-40 flex max-w-lg flex-col gap-2 rounded-xl border border-brand/20 bg-surface p-4 shadow-lg">
				<p className="text-body-sm text-fg">Waiting for Treg authorization…</p>
				{!pendingOAuth.popupOpened && <a href={pendingOAuth.url} target="_blank" rel="noopener noreferrer" className="text-caption text-brand underline">Open provider authorization</a>}
				<p className="text-caption text-fg-subtle">This page checks the connection status and refreshes when Treg confirms it.</p>
			</div>}
			{error && <p role="alert" className="rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-body-sm text-danger">{error}</p>}
		</div>

		{editing && <TregTokenDialog provider={editing} onClose={() => setEditing(null)} onConnected={async () => { setEditing(null); await refreshConnections(); toast(`${editing.displayName} connected to Treg.`, 'success'); }} />}
		{disconnecting && <ConfirmDialog title={`Disconnect ${disconnecting.displayName}?`} description="Treg removes this connection from your Treg team. Future calls will stop using its credential." confirmLabel="Disconnect" danger onClose={() => setDisconnecting(null)} onConfirm={() => disconnect(disconnecting)} />}
	</div>;
}

function TregTokenDialog({ provider, onClose, onConnected }: { provider: TregProvider; onClose: () => void; onConnected: () => Promise<void> }) {
	const [token, setToken] = useState('');
	const [extra, setExtra] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const canSubmit = token.trim().length > 0 && (!provider.needsExtraCredential || extra.trim().length > 0);

	async function save(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canSubmit || busy) return;
		setBusy(true); setError('');
		try {
			const response = await fetch('/api/treg/connections', { method: 'POST', headers: { ...accountHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ service: provider.service, token: token.trim() }) });
			const data = await readJson<{ connection: { secretId?: number; needsExtraCredential?: boolean } }>(response, `Treg could not verify the ${provider.displayName} credential.`);
			if (provider.needsExtraCredential || data.connection.needsExtraCredential) {
				if (!data.connection.secretId) throw new Error('Treg saved the primary credential but did not return a connection ID for the additional credential. Refresh the connection list and finish setup in Treg.');
				const extraResponse = await fetch(`/api/treg/connections/${data.connection.secretId}/extra-credential`, { method: 'POST', headers: { ...accountHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ value: extra.trim() }) });
				await readJson(extraResponse, 'Treg could not verify the additional credential.');
			}
			setToken(''); setExtra('');
			await onConnected();
		} catch (cause) { setError(cause instanceof Error ? cause.message : `Could not connect ${provider.displayName}.`); }
		finally { setBusy(false); }
	}

	return <Dialog title={`Connect ${provider.displayName}`} description={`Treg verifies this credential with ${provider.displayName} before saving it. The key is sent to Treg and is not stored in this app.`} onClose={() => { if (!busy) onClose(); }} size="md" footer={<><Button size="sm" disabled={busy} onClick={onClose}>Cancel</Button><Button size="sm" variant="brand" type="submit" form="treg-token-form" loading={busy} disabled={!canSubmit}>Connect</Button></>}>
		<form id="treg-token-form" onSubmit={(event) => void save(event)} className="flex flex-col gap-3">
			<Field label={provider.tokenLabel} required>{(id) => <Input id={id} type="password" autoComplete="off" spellCheck={false} autoFocus value={token} placeholder={provider.tokenPlaceholder} onChange={(event) => setToken(event.target.value)} />}</Field>
			{provider.needsExtraCredential && <Field label={provider.extraCredentialLabel} required help={provider.extraCredentialNote}>{(id) => <Input id={id} type="password" autoComplete="off" spellCheck={false} value={extra} onChange={(event) => setExtra(event.target.value)} />}</Field>}
			{provider.setupNote && <p className="text-caption text-fg-subtle">{provider.setupNote}</p>}
			{provider.setupSteps.length > 0 && <details className="text-caption text-fg-subtle"><summary className="cursor-pointer text-fg-muted">Setup steps</summary><ol className="mt-2 list-decimal space-y-1 pl-5">{provider.setupSteps.map((step, index) => <li key={index}>{step}</li>)}</ol></details>}
			{provider.setupUrl && <a href={provider.setupUrl} target="_blank" rel="noopener noreferrer" className="inline-flex w-fit items-center gap-1 text-caption text-brand hover:underline">{provider.setupActionLabel}<ExternalLink aria-hidden="true" className="size-3" /></a>}
			{error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-body-sm text-danger">{error}</p>}
		</form>
	</Dialog>;
}
