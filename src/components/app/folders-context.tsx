'use client';

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { accountHeaders } from '@/lib/account-storage';
import { updateSheet } from '@/lib/db';
import type { SheetFolder } from '@/lib/types';

type FoldersContextValue = {
	folders: SheetFolder[];
	loading: boolean;
	error: string | null;
	refresh: () => Promise<void>;
	createFolder: (name: string) => Promise<SheetFolder>;
	renameFolder: (id: string, name: string) => Promise<void>;
	deleteFolder: (id: string) => Promise<number>;
	moveSheet: (sheetId: string, folderId: string) => Promise<void>;
};

const FoldersContext = createContext<FoldersContextValue | null>(null);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(path, { ...init, cache: 'no-store', headers: { 'content-type': 'application/json', ...accountHeaders() } });
	const body = await response.json() as T & { error?: string };
	if (!response.ok) throw new Error(body.error || 'Could not update folders.');
	return body;
}

export function FoldersProvider({ children }: { children: ReactNode }) {
	const [folders, setFolders] = useState<SheetFolder[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const refresh = useCallback(async () => {
		try {
			const next = await request<SheetFolder[]>('/api/folders');
			setFolders(next);
			setError(null);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : 'Could not load folders.');
		} finally { setLoading(false); }
	}, []);
	useEffect(() => {
		const initial = window.setTimeout(() => { void refresh(); }, 0);
		const refreshVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
		const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 30_000);
		window.addEventListener('focus', refreshVisible);
		document.addEventListener('visibilitychange', refreshVisible);
		return () => { window.clearTimeout(initial); window.clearInterval(timer); window.removeEventListener('focus', refreshVisible); document.removeEventListener('visibilitychange', refreshVisible); };
	}, [refresh]);
	const value = useMemo<FoldersContextValue>(() => ({
		folders, loading, error, refresh,
		async createFolder(name) { const folder = await request<SheetFolder>('/api/folders', { method: 'POST', body: JSON.stringify({ name }) }); await refresh(); return folder; },
		async renameFolder(id, name) { await request(`/api/folders/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) }); await refresh(); },
		async deleteFolder(id) { const result = await request<{ movedCount: number }>(`/api/folders/${encodeURIComponent(id)}`, { method: 'DELETE' }); await refresh(); return result.movedCount; },
		async moveSheet(sheetId, folderId) { await updateSheet(sheetId, { folderId }); await refresh(); },
	}), [folders, loading, error, refresh]);
	return <FoldersContext value={value}>{children}</FoldersContext>;
}

export function useFolders() {
	const value = useContext(FoldersContext);
	if (!value) throw new Error('Folder actions must be used inside FoldersProvider.');
	return value;
}
