'use client';

import { announce } from '@/components/ui/announcer';
import { Button, IconButton } from '@/components/ui/button';
import { buttonClassName } from '@/components/ui/button-class';
import type { RunHalt } from '@/lib/runner';
import type { FailureProvider } from '@/lib/types';
import { CirclePause, ExternalLink, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect } from 'react';

const MONID_BILLING_URL = 'https://app.monid.ai';
const PROVIDER_NAMES: Record<FailureProvider, string> = { monid: 'Monid', context: 'Monid', openai: 'OpenAI', typesafe: 'OpenAI', email: 'your data provider' };

/** What a fix needs to know: a halted run, a failed Find rows, or a failed key check. */
export type ConnectionIssue = { reason: string; provider?: FailureProvider };

const isCredential = (issue: ConnectionIssue) => issue.reason === 'credential_missing' || issue.reason === 'credential_invalid';
function headline(halt: RunHalt) {
	const name = halt.provider ? PROVIDER_NAMES[halt.provider] : 'A provider';
	switch (halt.reason) {
		case 'credits_exhausted': return halt.provider === 'email' ? 'Your email provider is out of credits' : `${halt.provider ? name : 'Your provider'} credits are used up`;
		case 'credential_missing': return halt.provider === 'email' ? 'Connect Monid to keep enriching' : `Add ${halt.provider ? `a ${name}` : 'an'} API key to keep enriching`;
		case 'credential_invalid': return `${name} rejected the API key`;
		case 'save_failed': return 'Results couldn’t be saved';
	}
}

export function ConnectionFix({ size = 'sm' }: { size?: 'xs' | 'sm' }) {
	return <Link href="/app/settings" className={buttonClassName('outline', size)}>Open Connections</Link>;
}

/** The fix for a failure no retry solves: Monid balance or connection settings. */
export function FailureFix({ issue, size = 'xs' }: { issue: ConnectionIssue; size?: 'xs' | 'sm' }) {
	if (issue.reason === 'credits_exhausted' && (issue.provider === 'monid' || issue.provider === 'context')) return <a href={MONID_BILLING_URL} target="_blank" rel="noopener noreferrer" className={buttonClassName('outline', size)}>Manage Monid balance<ExternalLink aria-hidden strokeWidth={1.75} /></a>;
	if (isCredential(issue) || issue.reason === 'credits_exhausted') return <ConnectionFix size={size} />;
	return null;
}

/** Shown when the runner paused this sheet because every further request would fail the same way. */
export function HaltedBanner({ halt, waiting, onRetry, onDismiss }: { halt: RunHalt; waiting: number; onRetry: () => void; onDismiss: () => void }) {
	const title = headline(halt);
	const detail = [
		'Enrichment paused',
		halt.failedCells > 0 && `${halt.failedCells.toLocaleString()} failed`,
		waiting > 0 && `${waiting.toLocaleString()} waiting`,
	].filter(Boolean).join(' · ');
	const announcement = `${title}. Enrichment paused.`;
	useEffect(() => announce(announcement), [announcement]);
	return (
		<div role="region" aria-label="Enrichment paused" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-warning-line bg-warning-soft py-2 pr-1.5 pl-3 text-body-sm text-warning-strong">
			<CirclePause aria-hidden className="size-4 shrink-0" strokeWidth={1.75} />
			<p className="min-w-0 flex-1 max-md:basis-[calc(100%-1.75rem)]" title={halt.message}>
				<span className="font-medium text-fg">{title}.</span>{' '}
				<span>{halt.reason === 'save_failed' ? halt.message : detail}</span>
			</p>
			<div className="ml-auto flex shrink-0 items-center gap-1.5 max-md:ml-7 max-md:w-[calc(100%-1.75rem)]">
				<FailureFix issue={halt} />
				<Button size="xs" variant="brand" onClick={onRetry}>{halt.reason === 'credits_exhausted' ? 'Retry failed' : 'Resume'}</Button>
				<IconButton size="sm" label={waiting > 0 ? 'Dismiss and stop waiting cells' : 'Dismiss'} onClick={onDismiss} className="text-warning-strong hover:text-fg max-md:ml-auto"><X /></IconButton>
			</div>
		</div>
	);
}
