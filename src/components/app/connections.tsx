'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { MoreHorizontal } from 'lucide-react';
import clsx from 'clsx';
import type { Provider } from '@/lib/organization-settings';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { MenuButton, type MenuItem } from '@/components/ui/menu';
import { useToast } from '@/components/ui/toast';
import { useSettings } from './settings-context';
import { ConnectionDialog, ProviderLogo } from './keys-dialog';
import { CONNECTION_ORDER, DATA_PROVIDER_IDS, formatExpiry, isReady, PROVIDER_INFO, type Connection } from './providers';
import { providerCheck, useVerification, type ProviderCheck } from './use-verification';

const TONE = { success: 'text-success', danger: 'text-danger', warning: 'text-warning', muted: 'text-fg-subtle' } as const;

function status(provider: Provider, connection: Connection, check?: ProviderCheck, hasDataProvider = false): { text: string; tone: keyof typeof TONE } {
	if (connection.state === 'missing') return { text: connection.detail ?? 'Not connected', tone: DATA_PROVIDER_IDS.includes(provider as 'monid' | 'treg') && !hasDataProvider ? 'warning' : 'muted' };
	if (connection.state === 'expired') return { text: 'Expired', tone: 'danger' };
	if (check && !check.ok) return { text: check.message ?? 'Needs attention', tone: 'danger' };
	if (connection.state === 'included') return { text: 'Included trial', tone: 'muted' };
	if (connection.state === 'deployment') return { text: 'Provided by deployment', tone: 'muted' };
	if (connection.state === 'saved' && !check) return { text: 'Saved', tone: 'muted' };
	return { text: 'Connected', tone: 'success' };
}

function detail(provider: Provider, connection: Connection) {
	const expiry = connection.source === 'signin' && connection.expiresAt ? ` · ${formatExpiry(connection.expiresAt)}` : '';
	return connection.state === 'missing' || connection.state === 'included' ? PROVIDER_INFO[provider].description : `${connection.detail ?? PROVIDER_INFO[provider].description}${expiry}`;
}

/** Every provider in one list: logo, status, and one action menu. Configured connections are checked (without inference) on load. */
export function Connections() {
	const { settings, connections, organization, server, disconnectProvider } = useSettings();
	const hasDataProvider = DATA_PROVIDER_IDS.some((provider) => isReady(connections[provider]));
	const { toast } = useToast();
	const [editing, setEditing] = useState<{ provider: Provider } | null>(null);
	const [disconnecting, setDisconnecting] = useState<Provider | null>(null);
	const [busy, setBusy] = useState(false);
	const checkable = useMemo(() => CONNECTION_ORDER.filter((provider) => PROVIDER_INFO[provider].verifiable && connections[provider].state !== 'missing' && connections[provider].state !== 'expired'), [connections]);
	const verification = useVerification(settings, checkable, { version: JSON.stringify([organization?.revision, server]) });

	function actions(provider: Provider, connection: Connection): MenuItem[] {
		const configured = connection.state === 'connected' || connection.state === 'saved' || connection.state === 'expired';
		return [
			{ label: configured ? 'Replace key' : 'Add key', onSelect: () => setEditing({ provider }) },
			...(configured ? [{ separator: true, label: '' }, { label: 'Disconnect', danger: true, onSelect: () => setDisconnecting(provider) }] : []),
		];
	}

	return (
		<section aria-labelledby="connections-title" className="glass-card flex flex-col px-5 py-2">
			<div className="flex flex-col gap-0.5 border-b border-line-subtle py-3">
				<h2 id="connections-title" className="text-body text-fg">Connections</h2>
				<p className="text-caption text-fg-subtle">Keys are encrypted on this server and scoped to this workspace.</p>
			</div>
			<ul className="divide-y divide-line-subtle">
				{CONNECTION_ORDER.map((provider) => {
					const connection = connections[provider];
					const label = status(provider, connection, providerCheck(verification.result, provider), hasDataProvider);
					return (
						<li key={provider} className="flex items-center gap-3 py-3">
							<ProviderLogo provider={provider} />
							<div className="flex min-w-0 flex-1 flex-col gap-0.5">
								{provider === 'treg' ? <Link href="/app/settings/connections/treg" className="w-fit text-body-sm text-fg hover:text-brand">{PROVIDER_INFO[provider].name}</Link> : <span className="text-body-sm text-fg">{PROVIDER_INFO[provider].name}</span>}
								<span className="truncate text-caption text-fg-subtle">{detail(provider, connection)}</span>
							</div>
							<span className={clsx('max-w-[45%] text-right text-caption break-words', TONE[label.tone])}>
								{label.text}
							</span>
							{provider === 'treg' && <Link href="/app/settings/connections/treg" className="shrink-0 rounded-md border border-line px-2.5 py-1 text-caption text-fg-muted transition-colors hover:border-line-strong hover:text-fg">Manage providers</Link>}
							{connection.state === 'missing'
				? <Button size="xs" onClick={() => setEditing({ provider })}>Connect</Button>
								: <MenuButton label={`${PROVIDER_INFO[provider].name} actions`} align="right" items={actions(provider, connection)} className="grid size-7 shrink-0 place-items-center rounded-md text-fg-subtle transition-colors hover:bg-tint/[0.05] hover:text-fg max-md:size-11"><MoreHorizontal aria-hidden="true" className="size-4" /></MenuButton>}
						</li>
					);
				})}
			</ul>
			<div className="mt-1 border-t border-line-subtle py-3">
				<h3 className="text-body-sm text-fg">Action integrations</h3>
				<p className="mt-0.5 text-caption text-fg-subtle">These will connect outreach services to action columns. They are not available to connect yet.</p>
				<ul className="mt-2 divide-y divide-line-subtle">
					{[
						{ name: 'HeyReach', detail: 'LinkedIn outreach' },
						{ name: 'Instantly', detail: 'Email outreach' },
						{ name: 'IDEAL email sequencer', detail: 'Email sequences' },
					].map((integration) => <li key={integration.name} className="flex items-center gap-3 py-2.5">
						<div className="min-w-0 flex-1"><p className="text-body-sm text-fg">{integration.name}</p><p className="text-caption text-fg-subtle">{integration.detail}</p></div>
						<span className="text-caption text-fg-subtle">Coming soon</span>
					</li>)}
				</ul>
			</div>
			{editing && <ConnectionDialog provider={editing.provider} onClose={() => setEditing(null)} />}
			{disconnecting && <ConfirmDialog
				title={`Disconnect ${PROVIDER_INFO[disconnecting].name}?`}
				description={`The encrypted workspace copy of this ${PROVIDER_INFO[disconnecting].name} key is removed. This does not revoke it at the provider.`}
				confirmLabel="Disconnect"
				danger
				loading={busy}
				onClose={() => { if (!busy) setDisconnecting(null); }}
				onConfirm={async () => {
					setBusy(true);
					try { await disconnectProvider(disconnecting); setDisconnecting(null); }
					catch (error) { toast(error instanceof Error ? error.message : 'Could not disconnect.', 'error'); }
					finally { setBusy(false); }
				}}
			/>}
		</section>
	);
}
