import Link from 'next/link';
import { OrganizationSwitcher } from '@clerk/nextjs';
import { currentAccount } from '@/lib/server/auth';
import { managedAuthEnabled } from '@/lib/server/deployment';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

export default async function WorkspaceClosedPage() {
	return <Suspense fallback={<main className="grid min-h-dvh place-items-center px-6 text-body-sm text-fg-muted">Loading workspace…</main>}><WorkspaceClosedContent /></Suspense>;
}

async function WorkspaceClosedContent() {
	if (!await currentAccount()) redirect('/sign-in');
	return <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center justify-center gap-5 px-6 text-center">
		<h1 className="text-title text-fg">This workspace is closed</h1>
		<p className="text-body-sm text-fg-muted">Its sheets, settings, connected provider credentials, and agent keys were removed. Billing and provider usage receipts are retained for accounting. You can switch to another workspace below.</p>
		{managedAuthEnabled() ? <OrganizationSwitcher afterCreateOrganizationUrl="/app" afterSelectOrganizationUrl="/app" /> : <p className="text-body-sm text-fg-muted">Clear this site’s local data to start a new self-hosted browser workspace, or return to the <Link href="/" className="text-accent underline">project page</Link>.</p>}
	</main>;
}
