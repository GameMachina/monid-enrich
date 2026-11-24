import type { Metadata } from 'next';
import { AppShell } from '@/components/app/app-shell';
import { ShellSkeleton } from '@/components/app/shell-skeleton';
import { currentAccount, DEV_ISSUER } from '@/lib/server/auth';
import { contextSignInEnabled, managedAuthEnabled } from '@/lib/server/deployment';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { withDatabase, assertWorkspaceActive } from '@/lib/server/database';
import { WorkspaceError } from '@/lib/workspace';

export const metadata: Metadata = { title: 'Sheets', robots: { index: false, follow: false } };
export const instant = false;

async function AuthenticatedApp({ children }: { children: React.ReactNode }) {
	const account = await currentAccount();
	if (!account) redirect('/login');
	try { await withDatabase((database) => assertWorkspaceActive(database, account)); }
	catch (error) { if (error instanceof WorkspaceError && error.status === 410) redirect('/workspace-closed'); throw error; }
	return <AppShell account={account} contextSignIn={contextSignInEnabled() && account.issuer !== DEV_ISSUER} managedAuth={managedAuthEnabled()}>{children}</AppShell>;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
	return <Suspense fallback={<ShellSkeleton />}><AuthenticatedApp>{children}</AuthenticatedApp></Suspense>;
}
