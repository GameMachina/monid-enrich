'use client';

import { ExternalLink, Globe2, MoreHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { accountHeaders } from '@/lib/account-storage';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { MenuButton, type MenuItem } from '@/components/ui/menu';
import { useToast } from '@/components/ui/toast';

interface AgentWebConnectionState {
	connected: boolean;
	keyPrefix?: string;
	balanceUsd?: number;
	creditsRemaining?: number;
	actionPrice?: number;
	billingStatus?: string;
	needsReconnection?: boolean;
	usageError?: string;
}

async function readResponse(response: Response) {
	const body = await response.json().catch(() => ({})) as { error?: unknown };
	if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `Request failed (${response.status}).`);
	return body as AgentWebConnectionState;
}

const money = (value: number) => `$${value.toFixed(2)}`;

/** Member-owned AgentWeb account. The API key is sent to the server once and never returned to this component. */
export function AgentWebConnection() {
	const { toast } = useToast();
	const [state, setState] = useState<AgentWebConnectionState | null>(null);
	const [loading, setLoading] = useState(true);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [key, setKey] = useState('');
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState('');
	const [disconnecting, setDisconnecting] = useState(false);

	useEffect(() => {
		let cancelled = false;
		void fetch('/api/agentweb/connection', { cache: 'no-store', headers: accountHeaders() }).then(readResponse)
			.then((result) => { if (!cancelled) setState(result); })
			.catch((cause: unknown) => { if (!cancelled) setState({ connected: false, usageError: cause instanceof Error ? cause.message : 'Could not load the AgentWeb connection.' }); })
			.finally(() => { if (!cancelled) setLoading(false); });
		return () => { cancelled = true; };
	}, []);

	async function save() {
		setSaving(true); setError('');
		try {
			const result = await readResponse(await fetch('/api/agentweb/connection', { method: 'POST', headers: { ...accountHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ apiKey: key }) }));
			setState(result); setKey(''); setDialogOpen(false);
			toast('AgentWeb connected to your account.', 'success');
		} catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not connect AgentWeb.'); }
		finally { setSaving(false); }
	}

	async function disconnect() {
		setDisconnecting(true);
		try {
			setState(await readResponse(await fetch('/api/agentweb/connection', { method: 'DELETE', headers: accountHeaders() })));
			toast('AgentWeb disconnected from your account.', 'success');
		} catch (cause) { toast(cause instanceof Error ? cause.message : 'Could not disconnect AgentWeb.', 'error'); }
		finally { setDisconnecting(false); }
	}

	const menuItems: MenuItem[] = [
		{ label: 'Replace API key', onSelect: () => { setKey(''); setError(''); setDialogOpen(true); } },
		{ separator: true, label: '' },
		{ label: disconnecting ? 'Disconnecting…' : 'Disconnect', danger: true, onSelect: () => void disconnect() },
	];
	const connected = Boolean(state?.connected);

	return <>
		<section aria-labelledby="agentweb-connection-title" className="glass-card flex flex-col px-5 py-2">
			<div className="flex items-center gap-3 border-b border-line-subtle py-3">
				<span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg border border-line-subtle bg-white text-fg-muted"><Globe2 className="size-4" /></span>
				<div className="min-w-0 flex-1">
					<h2 id="agentweb-connection-title" className="text-body text-fg">AgentWeb</h2>
					<p className="text-caption text-fg-subtle">Web actions run as you and use your AgentWeb balance.</p>
				</div>
				{loading ? <span role="status" className="text-caption text-fg-subtle">Checking…</span> : connected
					? <span className={`max-w-[45%] text-right text-caption ${state?.needsReconnection ? 'text-warning' : 'text-success'}`}>{state?.needsReconnection ? 'Reconnect needed' : 'Connected'}</span>
					: <Button size="xs" onClick={() => { setError(''); setDialogOpen(true); }}>Connect</Button>}
				{connected && <MenuButton label="AgentWeb actions" align="right" items={menuItems} className="grid size-7 shrink-0 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-tint/[0.05] hover:text-fg max-md:size-11"><MoreHorizontal aria-hidden="true" className="size-4" /></MenuButton>}
			</div>
			{connected && <div className="flex flex-wrap items-center justify-between gap-2 py-3 text-caption">
				<span className="text-fg-muted">{state?.keyPrefix ? `Key ${state.keyPrefix}…` : 'Member account'}</span>
				<span className="flex items-center gap-2 text-fg-muted">
					{state?.balanceUsd !== undefined ? `${money(state.balanceUsd)} balance` : state?.creditsRemaining !== undefined ? `${state.creditsRemaining.toLocaleString()} credits` : state?.usageError ?? (state?.billingStatus ? `Billing ${state.billingStatus}` : 'Balance unavailable')}
					{state?.creditsRemaining !== undefined && state.balanceUsd !== undefined && <span>· {state.creditsRemaining.toLocaleString()} credits</span>}
				</span>
			</div>}
			{!connected && state?.usageError && <p role="status" className="py-2 text-caption text-danger">{state.usageError}</p>}
			{connected && state?.needsReconnection && <p role="alert" className="pb-3 text-caption text-warning">{state.usageError ?? 'Reconnect this AgentWeb key to run actions.'}</p>}
			{connected && state?.usageError && !state.needsReconnection && <p role="status" className="pb-3 text-caption text-fg-subtle">{state.usageError}</p>}
		</section>
		{dialogOpen && <Dialog
			title="Connect AgentWeb"
			description="Connect your own AgentWeb account. Actions are billed to your AgentWeb balance; this connection is personal to you, not shared with your workspace."
			onClose={() => { if (!saving) { setDialogOpen(false); setKey(''); setError(''); } }}
			footer={<Button variant="brand" size="sm" loading={saving} disabled={!key.trim()} onClick={() => void save()}>Connect</Button>}
		>
			<div className="flex flex-col gap-3">
				<Field label="AgentWeb API key" required help="Saved encrypted on this server. The key is never sent back to your browser after saving." labelAction={<a href="https://docs.agentweb.us/quickstart" target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-caption text-brand hover:underline">Set up AgentWeb <ExternalLink aria-hidden="true" className="size-3" /></a>}>
					{(id) => <Input id={id} type="password" autoComplete="off" spellCheck={false} placeholder="aw_…" value={key} onChange={(event) => setKey(event.target.value)} />}
				</Field>
				{error && <p role="alert" className="text-body-sm text-danger">{error}</p>}
			</div>
		</Dialog>}
	</>;
}
