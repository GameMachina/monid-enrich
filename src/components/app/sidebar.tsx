'use client';

import { OrganizationSwitcher, SignOutButton, UserButton } from '@clerk/nextjs';
import { CreditsRemaining } from './credits-remaining';
import { Logo } from '@/components/ui/logo';
import clsx from 'clsx';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, Folder, FolderPlus, LifeBuoy, ListTree, LogOut, Menu, MoreHorizontal, Pencil, Plus, Settings, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { GITHUB_URL } from '@/lib/constants';
import { SELF_HOSTED_ISSUER, type Account } from '@/lib/auth-identity';
import { db, refreshWorkspace } from '@/lib/db';
import type { Sheet, SheetFolder } from '@/lib/types';
import { DEFAULT_FOLDER_ID } from '@/lib/types';
import { ConfirmDialog, NameDialog } from '@/components/ui/dialog';
import { MenuButton } from '@/components/ui/menu';
import { useFolders } from './folders-context';
import { useToast } from '@/components/ui/toast';

const HELP_URL = `${GITHUB_URL}/blob/main/docs/usage.md`;

const NavigationContext = createContext<{ open: boolean; setOpen: (open: boolean) => void }>({ open: false, setOpen: () => {} });

/** The phone drawer's open state, shared by the drawer and the button each page puts in its header. */
export function NavigationProvider({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);
	const value = useMemo(() => ({ open, setOpen }), [open]);
	return <NavigationContext value={value}>{children}</NavigationContext>;
}

/** Opens the navigation drawer on phones. It sits in the page's header row, so it never floats over content. */
export function NavigationButton({ className }: { className?: string }) {
	const { open, setOpen } = useContext(NavigationContext);
	return (
		<button type="button" aria-label="Open navigation" aria-expanded={open} aria-controls="app-navigation" onClick={() => setOpen(true)} className={clsx('grid size-11 shrink-0 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-tint/[0.05] hover:text-fg md:hidden', className)}>
			<Menu className="size-4" strokeWidth={1.5} />
		</button>
	);
}

/** `size` sets the row's height and padding; the default fits a top-level row. */
function linkClass(active: boolean, size = 'h-11 md:h-8 pr-2 pl-3') {
	return clsx('group/link flex items-center gap-2.5 rounded-lg text-body-sm transition-colors duration-150', size, active ? 'bg-tint/[0.07] font-medium text-neutral-80' : 'text-fg-muted hover:bg-tint/[0.04] hover:text-fg');
}

function iconClass(active: boolean) {
	return clsx('size-4 shrink-0 transition-colors', active ? 'text-neutral-80' : 'text-fg-subtle group-hover/link:text-fg-muted');
}

/** Workspace folders organize sheets only; sheet data and search behavior remain independent. */
function FoldersNav({ pathname, onNavigate }: { pathname: string; onNavigate: () => void }) {
	const { folders, loading, error, createFolder, renameFolder, deleteFolder, moveSheet } = useFolders();
	const { toast } = useToast();
	const router = useRouter();
	const sheets = useLiveQuery(async () => (await db.sheets.toArray()).sort((a, b) => b.createdAt - a.createdAt || a.name.localeCompare(b.name)), []);
	const [expanded, setExpanded] = useState<Record<string, boolean>>({ [DEFAULT_FOLDER_ID]: true });
	const [nameDialog, setNameDialog] = useState<null | { kind: 'create' } | { kind: 'rename'; folder: SheetFolder }>(null);
	const [deleting, setDeleting] = useState<SheetFolder | null>(null);
	const defaultFolder = folders.find((folder) => folder.isDefault) ?? folders.find((folder) => folder.id === DEFAULT_FOLDER_ID);
	const navigateToCreate = (folderId: string) => { router.push(`/app?createSheet=1&folderId=${encodeURIComponent(folderId)}`); onNavigate(); };
	const toggle = (folderId: string) => setExpanded((current) => ({ ...current, [folderId]: !current[folderId] }));
	const folderSheets = (folderId: string) => (sheets ?? []).filter((sheet) => (sheet.folderId ?? DEFAULT_FOLDER_ID) === folderId);
	return (
		<div className="flex flex-col gap-0.5">
			<div className="flex items-center gap-1">
				<Link href="/app" onClick={onNavigate} aria-current={pathname === '/app' ? 'page' : undefined} className={clsx(linkClass(pathname === '/app', 'h-11 md:h-8 pr-2 pl-3'), 'flex-1')}>
					<Folder className={iconClass(pathname === '/app')} strokeWidth={1.75} />
					<span className="min-w-0 flex-1 truncate">Folders</span>
				</Link>
				<button type="button" aria-label="Create folder" title="Create folder" onClick={() => setNameDialog({ kind: 'create' })} className="grid size-9 shrink-0 place-items-center rounded-lg text-fg-subtle transition-colors hover:bg-tint/[0.05] hover:text-fg md:size-7">
					<FolderPlus className="size-4" strokeWidth={1.75} />
				</button>
			</div>
			{error && <p role="status" className="px-3 py-1.5 text-caption text-danger">{error}</p>}
			{loading && folders.length === 0 ? <p className="py-1.5 pl-[38px] text-caption text-fg-subtle">Loading folders…</p> : folders.length === 0 ? <p className="py-1.5 pl-[38px] text-caption text-fg-subtle">Create your first folder</p> : (
				<ul aria-label="Sheet folders" className="flex flex-col gap-0.5">
					{folders.map((folder) => {
						const folderOpen = Boolean(expanded[folder.id]);
						const items = folderSheets(folder.id);
						const active = pathname === '/app' && folder.isDefault;
						return <li key={folder.id} className="min-w-0">
							<div className="group/folder relative flex items-center">
								<button type="button" aria-expanded={folderOpen} aria-controls={`folder-sheets-${folder.id}`} onClick={() => toggle(folder.id)} className={clsx(linkClass(active, 'h-11 md:h-8 pr-9 pl-3'), 'min-w-0 flex-1')}>
									<Folder className={iconClass(active)} strokeWidth={1.75} />
									<span className="min-w-0 flex-1 truncate text-left">{folder.name}</span>
									<span className="shrink-0 text-caption text-fg-subtle">{folder.sheetCount}</span>
									<ChevronDown aria-hidden className={clsx('size-3.5 shrink-0 text-fg-subtle transition-transform duration-150 motion-reduce:transition-none', !folderOpen && '-rotate-90')} strokeWidth={1.75} />
								</button>
								<div className="absolute right-0 top-0 z-10 flex h-full items-center bg-canvas pl-1">
									<MenuButton label={`Actions for ${folder.name}`} align="right" className="grid size-7 place-items-center rounded-md text-fg-subtle opacity-0 transition-opacity hover:bg-tint/[0.05] hover:text-fg focus-visible:opacity-100 group-hover/folder:opacity-100" items={[
										{ label: 'New sheet here', icon: <Plus />, onSelect: () => navigateToCreate(folder.id) },
										{ label: 'Rename folder', icon: <Pencil />, onSelect: () => setNameDialog({ kind: 'rename', folder }) },
										...(!folder.isDefault ? [{ separator: true as const, label: '' }, { label: 'Delete folder', icon: <Trash2 />, danger: true, onSelect: () => setDeleting(folder) }] : []),
									]}><MoreHorizontal className="size-3.5" strokeWidth={1.75} /></MenuButton>
								</div>
							</div>
							<ul id={`folder-sheets-${folder.id}`} hidden={!folderOpen} className="flex flex-col gap-0.5">
								{items.length === 0 && <li className="py-1.5 pr-2 pl-[38px] text-caption text-fg-subtle">No sheets yet</li>}
								{items.map((sheet) => <FolderSheet key={sheet.id} sheet={sheet} current={pathname === `/app/sheets/${sheet.id}`} folders={folders} folder={folder} onNavigate={onNavigate} onMove={(folderId) => void moveSheet(sheet.id, folderId).then(() => toast(`Moved “${sheet.name}”`, 'success')).catch((cause) => toast(cause instanceof Error ? cause.message : 'Could not move sheet.', 'error'))} />)}
								<li><button type="button" onClick={() => navigateToCreate(folder.id)} className="flex h-10 w-full items-center gap-2 rounded-lg pr-2 pl-[38px] text-body-sm text-fg-muted transition-colors hover:bg-tint/[0.04] hover:text-fg md:h-7"><Plus className="size-3.5 shrink-0" strokeWidth={1.75} />New sheet</button></li>
							</ul>
						</li>;
					})}
				</ul>
			)}
			{nameDialog?.kind === 'create' && <NameDialog title="Create folder" initial="New folder" confirmLabel="Create folder" onClose={() => setNameDialog(null)} onSubmit={async (name) => { const folder = await createFolder(name); setExpanded((current) => ({ ...current, [folder.id]: true })); toast(`Created “${folder.name}”`, 'success'); setNameDialog(null); }} />}
			{nameDialog?.kind === 'rename' && <NameDialog title="Rename folder" initial={nameDialog.folder.name} confirmLabel="Save" onClose={() => setNameDialog(null)} onSubmit={async (name) => { await renameFolder(nameDialog.folder.id, name); toast(`Renamed folder to “${name}”`, 'success'); setNameDialog(null); }} />}
			{deleting && <ConfirmDialog title={`Delete “${deleting.name}”?`} description={`Its ${deleting.sheetCount} ${deleting.sheetCount === 1 ? 'sheet' : 'sheets'} will be moved to ${defaultFolder?.name ?? 'My Sheets'}. No sheet content will be deleted.`} confirmLabel="Move sheets and delete" danger onClose={() => setDeleting(null)} onConfirm={async () => { const moved = await deleteFolder(deleting.id); await refreshWorkspace().catch(() => {}); toast(`Deleted folder; moved ${moved} ${moved === 1 ? 'sheet' : 'sheets'} to ${defaultFolder?.name ?? 'My Sheets'}`, 'success'); setDeleting(null); }} />}
		</div>
	);
}

function FolderSheet({ sheet, current, folders, folder, onNavigate, onMove }: { sheet: Sheet; current: boolean; folders: SheetFolder[]; folder: SheetFolder; onNavigate: () => void; onMove: (folderId: string) => void }) {
	const moveItems = folders.filter((target) => target.id !== folder.id).map((target) => ({ label: target.name, checked: target.id === (sheet.folderId ?? DEFAULT_FOLDER_ID), onSelect: () => onMove(target.id) }));
	return <li className="group/sheet relative min-w-0">
		<Link href={`/app/sheets/${sheet.id}`} prefetch={false} onClick={onNavigate} aria-current={current ? 'page' : undefined} title={sheet.name} className={clsx(linkClass(current, 'h-11 md:h-7 pr-8 pl-[38px]'), 'min-w-0')}>
			<span className="min-w-0 flex-1 truncate">{sheet.name}</span>
		</Link>
		<MenuButton label={`Actions for ${sheet.name}`} align="right" className="absolute top-0 right-0 grid size-7 place-items-center rounded-md bg-canvas text-fg-subtle opacity-0 transition-opacity hover:bg-tint/[0.05] hover:text-fg focus-visible:opacity-100 group-hover/sheet:opacity-100" items={[
			{ label: 'Move to folder', icon: <Folder />, items: moveItems.length ? moveItems : [{ label: 'No other folders', disabled: true }] },
		]}><MoreHorizontal className="size-3.5" strokeWidth={1.75} /></MenuButton>
	</li>;
}

export function Sidebar({ account, managedAuth = false, platformAdmin = false }: { account: Account; managedAuth?: boolean; platformAdmin?: boolean }) {
	const pathname = usePathname() ?? '';
	const { open: mobileOpen, setOpen: setMobileOpen } = useContext(NavigationContext);
	const drawerRef = useRef<HTMLElement>(null);
	useEffect(() => {
		if (!mobileOpen || window.matchMedia('(min-width: 768px)').matches) return;
		const drawer = drawerRef.current;
		const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const desktop = window.matchMedia('(min-width: 768px)');
		const onResize = () => { if (desktop.matches) setMobileOpen(false); };
		const main = document.querySelector('main');
		const wasInert = main?.inert ?? false;
		if (main) main.inert = true;
		drawer?.querySelector<HTMLElement>('a, button')?.focus();
		const onKey = (event: KeyboardEvent) => {
			if (event.target instanceof HTMLElement && event.target.closest('[role="dialog"], [role="menu"]')) return;
			if (event.key === 'Escape') { event.preventDefault(); setMobileOpen(false); }
			if (event.key !== 'Tab') return;
			const controls = [...(drawer?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])].filter((element) => element.getClientRects().length > 0);
			const first = controls[0], last = controls[controls.length - 1];
			if (!drawer?.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
			else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
			else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
		};
		document.addEventListener('keydown', onKey);
		desktop.addEventListener('change', onResize);
		return () => {
			if (main) main.inert = wasInert;
			document.removeEventListener('keydown', onKey);
			desktop.removeEventListener('change', onResize);
			trigger?.focus();
		};
	}, [mobileOpen, setMobileOpen]);
	// The drawer is modal, so its own links are the only way to change pages while it's open.
	const close = () => setMobileOpen(false);
	const configurationActive = pathname.startsWith('/app/settings');
	const adminActive = pathname === '/app/admin' || pathname.startsWith('/app/admin/organizations');
	const tableTypesActive = pathname.startsWith('/app/admin/table-types');

	const content = (
		<>
			<div className="flex h-11 items-center gap-2 pl-3 md:h-8">
				<Link href="/app" onClick={close} className="flex items-center gap-2">
					<Logo size={18} />
					<span className="text-body-sm font-semibold text-fg">Monid Enrich</span>
				</Link>
				<button type="button" aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="ml-auto grid size-11 place-items-center md:size-8 rounded-lg text-fg-subtle hover:bg-tint/[0.04] md:hidden">
					<X className="size-4" strokeWidth={1.5} />
				</button>
			</div>
			{managedAuth && <div className="mt-4 px-1"><OrganizationSwitcher hidePersonal={false} /></div>}
			<nav aria-label="App" className="mt-5 flex flex-col gap-0.5">
				<FoldersNav pathname={pathname} onNavigate={close} />
				{platformAdmin && <Link href="/app/admin" onClick={close} aria-current={adminActive ? 'page' : undefined} className={linkClass(adminActive)}>
					<ShieldCheck className={iconClass(adminActive)} strokeWidth={1.75} />
					<span className="min-w-0 flex-1 truncate">Admin</span>
				</Link>}
				{platformAdmin && <Link href="/app/admin/table-types" onClick={close} aria-current={tableTypesActive ? 'page' : undefined} className={linkClass(tableTypesActive)}>
					<ListTree className={iconClass(tableTypesActive)} strokeWidth={1.75} />
					<span className="min-w-0 flex-1 truncate">Table Types</span>
				</Link>}
			</nav>
			<div className="min-h-6 flex-1" />
			<div className="flex flex-col gap-0.5">
				<a href={HELP_URL} target="_blank" rel="noopener noreferrer" className={linkClass(false)}>
					<LifeBuoy className={iconClass(false)} strokeWidth={1.75} />
					<span className="min-w-0 flex-1 truncate">Help</span>
				</a>
				<Link href="/app/settings" onClick={close} aria-current={configurationActive ? 'page' : undefined} className={linkClass(configurationActive)}>
					<Settings className={iconClass(configurationActive)} strokeWidth={1.75} />
					<span className="min-w-0 flex-1 truncate">Configuration</span>
				</Link>
				{managedAuth && <Link href="/app/team" onClick={close} aria-current={pathname.startsWith('/app/team') ? 'page' : undefined} className={linkClass(pathname.startsWith('/app/team'))}>
					<Users className={iconClass(pathname.startsWith('/app/team'))} strokeWidth={1.75} />
					<span className="min-w-0 flex-1 truncate">Team</span>
				</Link>}
				{managedAuth
					? <SignOutButton redirectUrl="/sign-in"><button type="button" className={linkClass(false, 'h-11 md:h-8 pr-2 pl-3 w-full')}>
						<LogOut className={iconClass(false)} strokeWidth={1.75} />
						<span className="min-w-0 flex-1 truncate text-left">Sign out</span>
					</button></SignOutButton>
					: account.issuer !== SELF_HOSTED_ISSUER && <form action="/api/auth/logout" method="post" className="w-full">
						<button type="submit" className={linkClass(false, 'h-11 md:h-8 pr-2 pl-3 w-full')}>
							<LogOut className={iconClass(false)} strokeWidth={1.75} />
							<span className="min-w-0 flex-1 truncate text-left">Sign out</span>
						</button>
					</form>}
				<div className="mt-3 flex flex-col">
					<CreditsRemaining />
				</div>
				{account.issuer === SELF_HOSTED_ISSUER
					? <p className="mt-4 border-t border-hairline px-3 pt-4 text-caption text-fg-subtle">Self-hosted</p>
					: managedAuth ? <div className="mt-4 flex items-center gap-2 border-t border-hairline px-3 pt-4 text-caption text-fg-muted">
						<div className="min-w-0 flex-1"><p className="truncate font-medium">{account.user.name || account.user.email || 'Account'}</p><p className="mt-0.5 truncate text-fg-subtle" title={account.organization.name}>{account.organization.name}</p></div>
						<UserButton />
					</div>
					: <div className="mt-4 flex items-center gap-2 border-t border-hairline px-3 pt-4 text-caption text-fg-muted">
						<div className="min-w-0 flex-1">
							<p className="truncate font-medium" title={account.user.email}>{account.user.name || account.user.email || 'Account'}</p>
							<p className="mt-0.5 truncate text-fg-subtle" title={account.organization.name}>{account.organization.name}</p>
						</div>
					</div>}
			</div>
		</>
	);

	return (
		<>
			<div aria-hidden onClick={() => setMobileOpen(false)} className={clsx('fixed inset-0 z-40 bg-scrim transition-opacity md:hidden', !mobileOpen && 'pointer-events-none opacity-0')} />
			<aside ref={drawerRef} id="app-navigation" aria-label="Workspace navigation" className={clsx('scrollbar-thin flex h-full w-[212px] shrink-0 flex-col overflow-y-auto bg-canvas px-5 pt-6 pb-5', 'max-md:fixed max-md:top-[max(0.5rem,env(safe-area-inset-top))] max-md:bottom-[max(0.5rem,env(safe-area-inset-bottom))] max-md:left-[max(0.5rem,env(safe-area-inset-left))] max-md:z-50 max-md:h-auto max-md:w-[min(19rem,calc(100vw-1rem))] max-md:overscroll-contain max-md:rounded-shell max-md:bg-surface max-md:shadow-[var(--shadow-floating)] max-md:transition-[translate,visibility] max-md:duration-200 motion-reduce:transition-none', mobileOpen ? 'max-md:translate-x-0' : 'max-md:invisible max-md:-translate-x-[calc(100%+1rem)]')}>
				{content}
			</aside>
		</>
	);
}
