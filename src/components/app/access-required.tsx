'use client';

import { Button } from '@/components/ui/button';
import { accountHeaders } from '@/lib/account-storage';
import { ArrowLeft, CheckCircle2, LockKeyhole, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Dialog, DialogError } from '@/components/ui/dialog';

type UnlockReason = 'sheets' | 'rows' | 'organization';

type BillingAccess = {
	configured: boolean;
	required: boolean;
	fullAccess: boolean;
	requiresPurchase: boolean;
	canManage: boolean;
	priceUsd: number;
	trial: null | { rowsUsed: number; rowLimit: number; sheetsUsed: number; sheetLimit: number };
};

/** A local, in-context purchase prompt for trial gates. Checkout itself is hosted by Stripe. */
export function AccessRequiredDialog({ unlock, onClose }: { unlock: UnlockReason; onClose: () => void }) {
	const [billing, setBilling] = useState<BillingAccess | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	useEffect(() => {
		const controller = new AbortController();
		void fetch('/api/billing', { headers: accountHeaders(), cache: 'no-store', signal: controller.signal })
			.then(async (response) => {
				const data = await response.json().catch(() => null) as BillingAccess | { error?: string } | null;
				if (!response.ok || !data || !('fullAccess' in data)) throw new Error((data as { error?: string } | null)?.error || 'Could not load access status.');
				if (!controller.signal.aborted) setBilling(data);
			})
			.catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load access status.'); })
			.finally(() => { if (!controller.signal.aborted) setLoading(false); });
		return () => controller.abort();
	}, []);

	async function checkout() {
		setBusy(true);
		setError('');
		try {
			const response = await fetch('/api/billing', { method: 'POST', headers: { ...accountHeaders(), 'idempotency-key': crypto.randomUUID() }, cache: 'no-store' });
			const data = await response.json().catch(() => null) as { url?: string; error?: string } | null;
			if (!response.ok || !data?.url) throw new Error(data?.error || 'Could not open Stripe Checkout.');
			window.location.assign(data.url);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Could not open Stripe Checkout.');
			setBusy(false);
		}
	}

	const additionalOrganization = unlock === 'organization' || Boolean(billing?.requiresPurchase);
	const title = additionalOrganization ? 'Unlock this organization' : 'Your free trial is complete';
	const description = additionalOrganization
		? 'Each organization has its own workspace and access. A one-time payment unlocks this organization for all its members.'
		: 'Your first organization includes one sheet and up to five populated rows. Pay once to unlock more sheets and larger searches in this organization.';
	const canManage = billing?.canManage !== false;
	return <Dialog
		title={title}
		description={description}
		onClose={() => { if (!busy) onClose(); }}
		size="sm"
		footer={<>
			<Button size="sm" onClick={onClose} disabled={busy}>Not now</Button>
			{canManage && <Button size="sm" variant="brand" loading={busy || loading} disabled={loading || !billing?.configured} onClick={() => void checkout()}><Sparkles className="size-4" />Continue to Stripe · $37 once</Button>}
		</>}
	>
		<div className="grid gap-4">
			<div className="flex items-start gap-3 rounded-xl border border-line-subtle bg-canvas p-4">
				<span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-10 text-brand"><LockKeyhole className="size-4" /></span>
				<div className="min-w-0">
					<p className="text-body-sm font-medium text-fg">One-time $37 USD payment</p>
					<p className="mt-1 text-caption text-fg-muted">Full access is applied to this organization after Stripe confirms payment. Monid provider usage is billed separately.</p>
					{billing?.trial && <p className="mt-2 text-caption text-fg-subtle">Trial used: {billing.trial.sheetsUsed}/{billing.trial.sheetLimit} sheet · {billing.trial.rowsUsed}/{billing.trial.rowLimit} populated rows.</p>}
				</div>
			</div>
			{loading && <p role="status" className="text-caption text-fg-subtle">Checking this organization’s access…</p>}
			{!loading && billing && !billing.configured && <DialogError>Stripe Checkout is not configured for this deployment yet. Your current trial access remains unchanged.</DialogError>}
			{!loading && !canManage && <p className="text-body-sm text-fg-muted">Ask a workspace owner or admin to unlock this organization.</p>}
			{error && <DialogError>{error}</DialogError>}
		</div>
	</Dialog>;
}

export function AccessRequired({ billingResult, sessionId, unlock }: { billingResult: 'success' | 'cancelled' | null; sessionId: string | null; unlock: 'sheets' | 'rows' | 'organization' }) {
	const router = useRouter();
	const [billing, setBilling] = useState<BillingAccess | null>(null);
	const [busy, setBusy] = useState(false);
	const [checking, setChecking] = useState(billingResult === 'success');
	const [error, setError] = useState('');
	const [notice, setNotice] = useState(billingResult === 'cancelled' ? 'Checkout was cancelled. No payment was made.' : '');

	async function load() {
		const response = await fetch('/api/billing', { headers: accountHeaders(), cache: 'no-store' });
		const data = await response.json().catch(() => null) as BillingAccess | { error?: string } | null;
		if (!response.ok || !data || !('fullAccess' in data)) throw new Error((data as { error?: string } | null)?.error || 'Could not load access status.');
		setBilling(data);
		return data;
	}

	useEffect(() => {
		let stopped = false;
		void (async () => {
			try {
				if (billingResult === 'success' && sessionId) {
					let confirmed = false;
					for (let attempt = 0; attempt < 20; attempt++) {
						if (stopped) return;
						const response = await fetch('/api/billing/claim', { method: 'POST', headers: { ...accountHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }), cache: 'no-store' });
						const result = await response.json().catch(() => null) as { error?: string } | null;
						if (response.ok) { confirmed = true; break; }
						if (response.status !== 409 || attempt === 19) throw new Error(result?.error || 'Payment completed, but access could not be confirmed yet.');
						await new Promise((resolve) => window.setTimeout(resolve, 1500));
					}
					if (!confirmed) throw new Error('Payment completed, but access could not be confirmed yet.');
				}
				const attempts = billingResult === 'success' ? 30 : 1;
				for (let attempt = 0; attempt < attempts; attempt++) {
					if (stopped) return;
					const current = await load();
					if (current.fullAccess) {
						if (!stopped) { setNotice('Payment confirmed. Lifetime access is active for this workspace.'); router.replace('/app'); router.refresh(); }
						return;
					}
					if (attempt + 1 < attempts) await new Promise((resolve) => window.setTimeout(resolve, 2000));
				}
				if (billingResult === 'success' && !stopped) setNotice('Stripe is still confirming your payment. Keep this page open or refresh in a moment.');
			} catch (cause) {
				if (!stopped) setError(cause instanceof Error ? cause.message : 'Could not load access status.');
			} finally { if (!stopped) setChecking(false); }
		})();
		return () => { stopped = true; };
	}, [billingResult, router, sessionId]);

	async function checkout() {
		setBusy(true); setError('');
		try {
			const response = await fetch('/api/billing', { method: 'POST', headers: { ...accountHeaders(), 'idempotency-key': crypto.randomUUID() }, cache: 'no-store' });
			const data = await response.json().catch(() => null) as { url?: string; error?: string } | null;
			if (!response.ok || !data?.url) throw new Error(data?.error || 'Could not open Stripe Checkout.');
			window.location.assign(data.url);
		} catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not open Stripe Checkout.'); setBusy(false); }
	}

	return <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-5 py-12">
		<section className="mx-auto w-full max-w-2xl rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-10" aria-labelledby="access-title">
			<button type="button" onClick={() => router.push('/app')} className="mb-8 inline-flex items-center gap-2 text-caption text-fg-muted hover:text-fg"><ArrowLeft className="size-4" />Back to your workspace</button>
			<div className="mb-4 grid size-11 place-items-center rounded-xl bg-blue-10 text-brand"><LockKeyhole className="size-5" /></div>
			<h1 id="access-title" className="text-h2 tracking-[-0.03em] text-fg">Unlock this organization</h1>
			<p className="mt-3 max-w-xl text-body text-fg-muted">{billing?.requiresPurchase
				? 'Only your first organization includes a free trial. This organization has its own workspace and needs its own one-time $37 purchase before sheets and searches are available.'
				: 'Your first organization includes one sheet and up to five populated rows. A one-time payment unlocks additional sheets and searches of up to 1,000 rows for this organization.'}</p>
			<div className="mt-6 rounded-xl border border-line-subtle bg-canvas p-4">
				<p className="text-body-sm font-medium text-fg">{billing?.requiresPurchase ? 'Additional organization · no trial' : unlock === 'sheets' ? 'Unlock another sheet' : unlock === 'rows' ? 'Unlock larger searches' : 'Unlock this organization'}</p>
				{billing?.trial && <p className="mt-1 text-caption text-fg-muted">Trial usage: {billing.trial.sheetsUsed}/{billing.trial.sheetLimit} sheet · {billing.trial.rowsUsed}/{billing.trial.rowLimit} populated rows.</p>}
				<p className="mt-2 text-caption text-fg-subtle">One $37 purchase unlocks this organization for all its members. Provider usage is separate; Monid charges this workspace’s wallet for searches and enrichment.</p>
			</div>
			<div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
				{billing?.canManage === false
					? <p className="text-body-sm text-fg-muted">Ask a workspace owner or admin to unlock full access.</p>
					: <Button size="md" variant="brand" loading={busy || checking} disabled={!billing?.configured || checking} onClick={() => void checkout()}><Sparkles className="size-4" />Pay $37 once</Button>}
				{checking && <span role="status" className="text-caption text-fg-subtle">Confirming payment with Stripe…</span>}
			</div>
			{billing && !billing.configured && <p role="status" className="mt-3 text-caption text-warning">Stripe Checkout is not configured for this deployment. {billing.requiresPurchase ? 'This organization stays locked until checkout is available.' : 'Your first-organization trial remains available.'}</p>}
			{notice && <p role="status" className="mt-3 flex items-center gap-2 text-caption text-success"><CheckCircle2 className="size-4" />{notice}</p>}
			{error && <p role="alert" className="mt-3 text-caption text-danger">{error}</p>}
		</section>
	</main>;
}
