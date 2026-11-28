import type { Metadata } from 'next';
import { AppShell } from '@/components/app/app-shell';
import { ShellSkeleton } from '@/components/app/shell-skeleton';
import { currentAccount, DEV_ISSUER } from '@/lib/server/auth';
import { contextSignInEnabled, managedAuthEnabled } from '@/lib/server/deployment';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { withDatabase, assertWorkspaceActive } from '@/lib/server/database';
import { WorkspaceError } from '@/lib/workspace';
import { isPlatformAdmin } from '@/lib/server/platform-admin';
import { TableTypeStore } from '@/lib/server/table-type-store';
import type { TableTypeDefinition } from '@/lib/types';

export const metadata: Metadata = { title: 'Sheets', robots: { index: false, follow: false } };
export const instant = false;

async function AuthenticatedApp({ children }: { children: React.ReactNode }) {
	const account = await currentAccount();
	if (!account) redirect('/login');
	let tableTypes: TableTypeDefinition[];
	try { tableTypes = await withDatabase(async (database) => { await assertWorkspaceActive(database, account); return new TableTypeStore(database).listRunnablePublished(); }); }
	catch (error) { if (error instanceof WorkspaceError && error.status === 410) redirect('/workspace-closed'); throw error; }
	return <AppShell account={account} tableTypes={tableTypes} platformAdmin={isPlatformAdmin(account)} contextSignIn={contextSignInEnabled() && account.issuer !== DEV_ISSUER} managedAuth={managedAuthEnabled()}>{children}</AppShell>;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
	return <Suspense fallback={<ShellSkeleton />}><AuthenticatedApp>{children}</AuthenticatedApp></Suspense>;
}
