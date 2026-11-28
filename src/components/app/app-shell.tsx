'use client';

import { ToastProvider } from '@/components/ui/toast';
import { type ReactNode, Suspense, useEffect } from 'react';
import { accountStorageKey } from '@/lib/account-storage';
import { ACCOUNT_CHANGED_MESSAGE } from '@/lib/account-messages';
import { KeysDialog } from './keys-dialog';
import { SettingsProvider, useSettings } from './settings-context';
import { NavigationProvider, Sidebar } from './sidebar';
import { AccountBoundary, useSessionWarning } from './account-boundary';
import { SELF_HOSTED_ISSUER, type Account } from '@/lib/auth-identity';
import { FoldersProvider } from './folders-context';
import { TableTypesProvider } from './table-types-context';
import type { TableTypeDefinition } from '@/lib/types';

const SETUP_SEEN_KEY = 'enrichable.setup-seen.v1';
function setupSeen() {
	try { return window.localStorage.getItem(accountStorageKey(SETUP_SEEN_KEY)) === '1'; } catch { return false; }
}
function rememberSetupSeen() {
	try { window.localStorage.setItem(accountStorageKey(SETUP_SEEN_KEY), '1'); } catch { /* It opens again next visit. */ }
}

/** Opens setup once per browser; afterwards only key-requiring actions (and trial limits) open it. */
function KeysGate() {
	const { ready, hasKeys, keysOpen, closeKeys, openKeys } = useSettings();
	useEffect(() => {
		if (ready && !hasKeys && !setupSeen()) openKeys();
	}, [ready, hasKeys, openKeys]);
	if (!keysOpen) return null;
	return <KeysDialog onClose={() => { rememberSetupSeen(); closeKeys(); }} />;
}

/** Banners live inside the shell so they never push the full-height layout past the viewport. */
function ShellAlerts() {
	const warning = useSessionWarning();
	const { settingsError, retrySettings } = useSettings();
	if (!warning && !settingsError) return null;
	return (
		<div className="shrink-0">
			{warning && <p role="status" className="bg-warning-soft px-4 py-2 text-body-sm text-fg">{warning}</p>}
			{settingsError && <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-danger-soft px-4 py-2 text-body-sm text-danger">
				<span className="min-w-0 flex-1">{settingsError}</span>
				{settingsError === ACCOUNT_CHANGED_MESSAGE
					? <button type="button" onClick={() => window.location.reload()} className="font-medium underline-offset-4 hover:underline">Reload</button>
					: <button type="button" onClick={retrySettings} className="font-medium underline-offset-4 hover:underline">Retry</button>}
			</div>}
		</div>
	);
}

export function AppShell({ children, account, tableTypes, platformAdmin = false, contextSignIn = false, managedAuth = false }: { children: ReactNode; account: Account & { sessionId: string }; tableTypes: readonly TableTypeDefinition[]; platformAdmin?: boolean; contextSignIn?: boolean; managedAuth?: boolean }) {
	return (
		<AccountBoundary account={account}>
			<SettingsProvider logolinkPublicId={account.organization.logolink_public_id} selfHosted={account.issuer === SELF_HOSTED_ISSUER} workspaceAdmin={account.role === 'owner' || account.role === 'admin'} contextSignIn={contextSignIn} workspaceName={account.organization.name}>
				<ToastProvider>
				<TableTypesProvider tableTypes={tableTypes}>
					<NavigationProvider>
					<FoldersProvider>
					<div className="flex h-dvh overflow-clip bg-canvas pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
						<Suspense fallback={<aside className="hidden h-full w-[212px] shrink-0 md:block" />}>
						<Sidebar account={account} managedAuth={managedAuth} platformAdmin={platformAdmin} />
						</Suspense>
						<main className="relative flex min-w-0 flex-1 flex-col overflow-clip">
							<ShellAlerts />
							{children}
						</main>
					</div>
					</FoldersProvider>
					</NavigationProvider>
				</TableTypesProvider>
					<KeysGate />
				</ToastProvider>
			</SettingsProvider>
		</AccountBoundary>
	);
}
