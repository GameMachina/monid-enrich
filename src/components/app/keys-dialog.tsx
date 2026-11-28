'use client';

import Image from 'next/image';
import { useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, ExternalLink, Eye, EyeOff, XCircle } from 'lucide-react';
import { trackEvent } from '@/lib/analytics';
import type { Settings } from '@/lib/keys';
import { providerField, type Provider } from '@/lib/organization-settings';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { useSettings } from './settings-context';
import { CONNECTION_ORDER, isConfigured, isReady, PROVIDER_INFO, type Connection } from './providers';
import { providerCheck, useVerification, type ProviderCheck } from './use-verification';

export function ProviderLogo({ provider }: { provider: Provider }) {
	return <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line-subtle bg-white"><Image src={PROVIDER_INFO[provider].logo} alt="" width={20} height={20} className="size-5 object-contain" /></span>;
}

/** Live check result under a key field. Never blocks saving. */
function CheckLine({ checking, check, error, provider }: { checking: boolean; check?: ProviderCheck; error?: string; provider: Provider }) {
	if (checking) return <p role="status" className="text-caption text-fg-subtle">Checking…</p>;
	if (error) return <p role="status" className="text-caption text-fg-subtle">{error}</p>;
	if (!check) return null;
	if (check.ok) return <p role="status" className="flex items-center gap-1 text-caption text-success"><CheckCircle2 aria-hidden="true" className="size-3.5" />Connected{provider === 'monid' && check.balanceUsd !== undefined ? ` · $${check.balanceUsd.toFixed(2)} wallet` : ''}</p>;
	return <>
		<p role="alert" className="flex items-start gap-1 text-caption text-danger"><XCircle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />{check.message ?? `${PROVIDER_INFO[provider].name} rejected this key.`}</p>
		{provider === 'openai' && check.issue === 'billing' && <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener noreferrer" className="text-caption text-brand hover:underline">Open OpenAI billing <ExternalLink aria-hidden="true" className="inline size-3" /></a>}
	</>;
}

function KeyField({ label, link, value, onChange, placeholder, help, required, autoFocus }: { label: string; link?: string; value: string; onChange: (value: string) => void; placeholder: string; help?: string; required?: boolean; autoFocus?: boolean }) {
	const [revealed, setRevealed] = useState(false);
	return (
		<Field label={label} required={required} help={help} labelAction={link && <a href={link} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-caption text-brand hover:underline">Get a key <ExternalLink aria-hidden="true" className="size-3" strokeWidth={1.75} /></a>}>
			{(id) => <div className="relative">
				<Input id={id} aria-label={label} autoFocus={autoFocus} required={required} type={revealed ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="pr-24" />
				<button type="button" aria-label={`${revealed ? 'Hide' : 'Reveal'} ${label}`} aria-pressed={revealed} onClick={() => setRevealed((current) => !current)} className="absolute inset-y-0 right-2 inline-flex items-center gap-1 rounded-md px-2 text-caption text-fg-subtle hover:bg-tint/[0.05] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand max-md:min-h-11">
					{revealed ? <EyeOff aria-hidden="true" className="size-3.5" /> : <Eye aria-hidden="true" className="size-3.5" />}
					<span>{revealed ? 'Hide' : 'Reveal'}</span>
				</button>
			</div>}
		</Field>
	);
}

function ProviderCard({ provider, status, children }: { provider: Provider; status?: ReactNode; children?: ReactNode }) {
	return (
		<section aria-label={PROVIDER_INFO[provider].name} className="rounded-xl border border-line-subtle bg-surface">
			<div className="flex items-center gap-3 px-3 py-2.5">
				<ProviderLogo provider={provider} />
				<span className="min-w-0 flex-1"><span className="block text-body-sm font-medium text-fg">{PROVIDER_INFO[provider].name}</span><span className="block text-caption text-fg-subtle">{PROVIDER_INFO[provider].description}</span></span>
				{status}
			</div>
			{children && <div className="flex flex-col gap-2 border-t border-line-subtle px-4 py-3">{children}</div>}
		</section>
	);
}

const ConnectedBadge = () => <span className="inline-flex shrink-0 items-center gap-1 text-caption text-success"><CheckCircle2 aria-hidden="true" className="size-3.5" />Connected</span>;

/** Configured providers after a save, for analytics. */
function configuredCount(connections: Record<Provider, Connection>, patch: Partial<Settings>) {
	return CONNECTION_ORDER.filter((provider) => isConfigured(connections[provider]) || Boolean(patch[providerField[provider]])).length;
}

/** A provider's key field with a live check of only that provider, so typing one key never repeats another's billed OpenAI inference test. */
function VerifiedKeyField({ provider, value, onChange, required, autoFocus, help }: { provider: Provider; value: string; onChange: (value: string) => void; required?: boolean; autoFocus?: boolean; help?: string }) {
	const { settings } = useSettings();
	const info = PROVIDER_INFO[provider];
	const trimmed = value.trim();
	const field = providerField[provider];
	const draft = useMemo(() => ({ ...settings, [field]: trimmed }) as Settings, [settings, field, trimmed]);
	const verification = useVerification(draft, trimmed && info.verifiable ? [provider] : [], { inference: provider === 'openai' });
	return <>
		<KeyField label={`${info.name} API key`} required={required} link={info.link} value={value} onChange={onChange} placeholder={info.placeholder} autoFocus={autoFocus} help={help} />
		<CheckLine provider={provider} checking={verification.checking} check={providerCheck(verification.result, provider)} error={verification.error} />
	</>;
}

type Workspace = ReturnType<typeof useSettings>;

/** What first-run setup asks for, given the workspace's connections and the trimmed keys typed so far. */
function setupNeeds({ connections }: Workspace, typed: { monidKey: string }, requiredProvider?: 'monid') {
	const askMonid = !isReady(connections.monid);
	const askOpenAI = !isReady(connections.openai);
	const hasMonid = !askMonid || Boolean(typed.monidKey);
	const missing = requiredProvider ? !hasMonid : !hasMonid;
	return { askMonid, askOpenAI, title: requiredProvider ? 'Connect Monid' : 'Connect a data provider', missing, typeable: askMonid || askOpenAI };
}

/** First run and key-requiring actions: only the two required connections, saved without waiting for live checks. */
export function KeysDialog({ onClose }: { onClose: () => void }) {
	const workspace = useSettings();
	const { update, connections, workspaceName, keysRequiredProvider } = workspace;
	const [monidKey, setMonidKey] = useState('');
	const [openaiKey, setOpenaiKey] = useState('');
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState('');
	const needs = setupNeeds(workspace, { monidKey: monidKey.trim() }, keysRequiredProvider);

	async function save() {
		setSaving(true); setSaveError('');
		const patch: Partial<Settings> = {};
		if (monidKey.trim()) patch.monidKey = monidKey.trim();
		if (openaiKey.trim()) patch.openaiKey = openaiKey.trim();
		try {
			await update(patch);
			trackEvent('keys_saved', { providers: configuredCount(connections, patch) });
			onClose();
		} catch (error) { setSaveError(error instanceof Error ? error.message : 'Could not save your connections.'); }
		finally { setSaving(false); }
	}

	return (
		<Dialog
			title={needs.title}
			description={`Connect Monid for company and people research and enrichment in ${workspaceName || 'your workspace'}. OpenAI is optional and only uses a key you provide.`}
			onClose={onClose}
			size="lg"
			footer={needs.typeable ? <Button variant="brand" size="sm" loading={saving} disabled={needs.missing} onClick={() => void save()}>Save and start</Button> : <Button size="sm" onClick={onClose}>Not now</Button>}
		>
			<div className="flex flex-col gap-3">
				<ProviderCard provider="monid" status={needs.askMonid ? <span className="text-caption text-fg-subtle">{keysRequiredProvider === 'monid' ? 'Required for this run' : 'Optional'}</span> : <ConnectedBadge />}>
					{needs.askMonid && <VerifiedKeyField provider="monid" required={keysRequiredProvider === 'monid'} value={monidKey} onChange={setMonidKey} autoFocus />}
				</ProviderCard>
				<ProviderCard provider="openai" status={needs.askOpenAI ? <span className="text-caption text-fg-subtle">Optional</span> : <OpenAIStatus included={connections.openai.state === 'included'} />}>
					{needs.askOpenAI && <VerifiedKeyField provider="openai" value={openaiKey} onChange={setOpenaiKey} />}
				</ProviderCard>
				<p className="text-caption text-fg-subtle">Monid powers company and people research and enrichment. OpenAI reasoning, classification, scoring, and natural-language row generation need your own OpenAI key.</p>
				{saveError && <p role="alert" className="text-body-sm text-danger">{saveError}</p>}
			</div>
		</Dialog>
	);
}

const OpenAIStatus = ({ included }: { included: boolean }) => included ? <span className="shrink-0 text-caption text-fg-subtle">Included trial</span> : <ConnectedBadge />;

/** Dialog copy for Configuration → Connections: the Logo Link override, or connecting/replacing a provider key. */
function connectionCopy(provider: Provider, replacing: boolean) {
	const info = PROVIDER_INFO[provider];
	return { title: `${replacing ? 'Replace' : 'Connect'} ${info.name}`, description: `${info.description}. Saved encrypted on this server and scoped to your workspace.` };
}

/** Configuration → Connections: add or replace one provider's key. */
export function ConnectionDialog({ provider, onClose }: { provider: Provider; onClose: () => void }) {
	const { update, connections } = useSettings();
	const info = PROVIDER_INFO[provider];
	const [key, setKey] = useState('');
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState('');
	const trimmed = key.trim();
	const field = providerField[provider];
	const copy = connectionCopy(provider, isConfigured(connections[provider]));

	async function save() {
		setSaving(true); setSaveError('');
		const patch: Partial<Settings> = {};
		if (trimmed) patch[field] = trimmed;
		try {
			await update(patch);
			if (trimmed) trackEvent('keys_saved', { providers: configuredCount(connections, patch) });
			onClose();
		} catch (error) { setSaveError(error instanceof Error ? error.message : 'Could not save this connection.'); }
		finally { setSaving(false); }
	}

	return (
		<Dialog
			title={copy.title}
			description={copy.description}
			onClose={onClose}
			footer={<Button variant="brand" size="sm" loading={saving} disabled={!trimmed} onClick={() => void save()}>Save</Button>}
		>
			<div className="flex flex-col gap-3">
				<VerifiedKeyField provider={provider} required value={key} onChange={setKey} autoFocus help={info.verifiable ? undefined : 'Checked on your first lookup; usage is billed through Monid.'} />
				{saveError && <p role="alert" className="text-body-sm text-danger">{saveError}</p>}
			</div>
		</Dialog>
	);
}
