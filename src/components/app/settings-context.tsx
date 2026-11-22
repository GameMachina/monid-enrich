'use client';

import { serverKeys, type ServerKeys } from '@/lib/api';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, saveOrganizationSettings, type Settings, subscribeSettings, initializeOrganizationSettings, refreshOrganizationSettings, organizationSettingsSnapshot, disconnectOrganizationProvider, organizationSettingsEnabled } from '@/lib/keys';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { providerField, type OrganizationSettings, type Provider } from '@/lib/organization-settings';
import { OPENAI_KEY_REQUIRED_EVENT } from '@/lib/ai-trial';
import { deriveConnections, isReady, type Connection } from './providers';
import { accountHeaders } from '@/lib/account-storage';
import { DEFAULT_MEMBER_PREFERENCES, type MemberPreferences } from '@/lib/member-settings';

interface SettingsContextValue {
	selfHosted: boolean;
	/** Legacy onboarding prop retained for hosts that have not removed the old consent route. */
	contextSignIn: boolean;
	workspaceName: string;
	trialLimitMessage: string | null;
	reportTrialLimit: (message: string) => void;
	settings: Settings;
	logolinkPublicId?: string;
	update: (patch: Partial<Settings>, expectedRevision?: number) => Promise<void>;
	organization: OrganizationSettings | null;
	memberPreferences: MemberPreferences;
	memberPreferencesError: string | null;
	updateMemberPreferences: (patch: Partial<MemberPreferences>) => Promise<void>;
	settingsError: string | null;
	retrySettings: () => void;
	disconnectProvider: (provider: Provider) => Promise<void>;
	server: ServerKeys | null;
	connections: Record<Provider, Connection>;
	ready: boolean;
	/** Monid is needed for data enrichment. OpenAI reasoning remains optional and reports its own connection state. */
	hasKeys: boolean;
	providerReady: (provider: Provider) => boolean;
	hasJev: boolean;
	keysOpen: boolean;
	openKeys: () => void;
	closeKeys: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const serverSnapshot = () => DEFAULT_SETTINGS;
type MemberSettingsSnapshot = { revision: number; preferences: MemberPreferences };

async function requestMemberSettings(method: 'GET' | 'PATCH', body?: unknown): Promise<MemberSettingsSnapshot> {
	const response = await fetch('/api/member-settings', { method, headers: { ...accountHeaders(), 'content-type': 'application/json' }, cache: 'no-store', ...(body ? { body: JSON.stringify(body) } : {}) });
	if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Could not load member preferences.');
	return await response.json() as MemberSettingsSnapshot;
}

export function SettingsProvider({ children, logolinkPublicId, selfHosted = false, contextSignIn = false, workspaceName = '' }: { children: ReactNode; logolinkPublicId?: string; selfHosted?: boolean; contextSignIn?: boolean; workspaceName?: string }) {
	const settings = useSyncExternalStore(subscribeSettings, loadSettings, serverSnapshot);
	const [settingsError, setSettingsError] = useState<string | null>(null);
	const [memberSettings, setMemberSettings] = useState<MemberSettingsSnapshot>({ revision: 0, preferences: DEFAULT_MEMBER_PREFERENCES });
	const memberSettingsRef = useRef(memberSettings);
	const [memberPreferencesError, setMemberPreferencesError] = useState<string | null>(null);
	const memberSave = useRef<Promise<void>>(Promise.resolve());
	const organization = organizationSettingsSnapshot();
	const [server, setServer] = useState<ServerKeys | null>(null);
	const [ready, setReady] = useState(false);
	const [keysOpen, setKeysOpen] = useState(false);
	const [trialLimitMessage, setTrialLimitMessage] = useState<string | null>(null);
	const promptedLimit = useRef<string | null>(null);
	const reportTrialLimit = useCallback((message: string) => {
		if (loadSettings().openaiKey || organizationSettingsSnapshot()?.providers.openai?.configured || promptedLimit.current === message) return;
		promptedLimit.current = message;
		setTrialLimitMessage(message);
		setKeysOpen(true);
	}, []);
	useEffect(() => {
		const listener = (event: Event) => reportTrialLimit((event as CustomEvent<string>).detail);
		window.addEventListener(OPENAI_KEY_REQUIRED_EVENT, listener);
		return () => window.removeEventListener(OPENAI_KEY_REQUIRED_EVENT, listener);
	}, [reportTrialLimit]);
	// One loader for the first load, background refreshes and Retry: a later success always clears the error and marks the app ready.
	const sync = useRef<() => Promise<void>>(async () => {});
	useEffect(() => {
		let cancelled = false;
		let loaded = false;
		sync.current = async () => {
			try {
				await (loaded ? refreshOrganizationSettings() : initializeOrganizationSettings());
				const [value, member] = await Promise.all([serverKeys(), requestMemberSettings('GET').catch((error: unknown) => {
					if (!cancelled) setMemberPreferencesError(error instanceof Error ? error.message : 'Could not load member preferences.');
					return null;
				})]);
				loaded = true;
				if (!cancelled) {
					setServer(value); setSettingsError(null); setReady(true);
					if (member) { memberSettingsRef.current = member; setMemberSettings(member); setMemberPreferencesError(null); }
				}
			} catch (error) { if (!cancelled) setSettingsError(error instanceof Error ? error.message : 'Could not load workspace settings.'); }
		};
		void sync.current();
		const focus = () => { void sync.current(); };
		const timer = setInterval(() => { if (document.visibilityState === 'visible') void sync.current(); }, 30_000);
		window.addEventListener('focus', focus);
		return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', focus); };
	}, [selfHosted]);
	const retrySettings = useCallback(() => { void sync.current(); }, []);
	const update = useCallback(async (patch: Partial<Settings>, expectedRevision?: number) => {
		if (expectedRevision !== undefined) await saveOrganizationSettings(patch, expectedRevision); else await saveSettings(patch);
		setServer(await serverKeys());
	}, []);
	const updateMemberPreferences = useCallback((patch: Partial<MemberPreferences>) => {
		const save = memberSave.current.catch(() => {}).then(async () => {
			const current = memberSettingsRef.current;
			try {
				const next = await requestMemberSettings('PATCH', { revision: current.revision, preferences: patch });
				memberSettingsRef.current = next; setMemberSettings(next); setMemberPreferencesError(null);
			} catch (error) {
				if (error instanceof Error && /changed in another session/i.test(error.message)) {
					try { const fresh = await requestMemberSettings('GET'); memberSettingsRef.current = fresh; setMemberSettings(fresh); } catch {}
				}
				throw error;
			}
		});
		memberSave.current = save;
		return save;
	}, []);
	const disconnectProvider = useCallback(async (provider: Provider) => {
		if (organizationSettingsEnabled()) await disconnectOrganizationProvider(provider);
		else await saveSettings({ [providerField[provider]]: '' });
		setServer(await serverKeys());
	}, []);
	const connections = useMemo(() => deriveConnections({ settings, organization, server, selfHosted, trialLimited: Boolean(trialLimitMessage) }), [settings, organization, server, selfHosted, trialLimitMessage]);
	// A key of the member's own replaces the trial, so its limit no longer applies.
	const activeTrialLimit = connections.openai.state === 'connected' || connections.openai.state === 'saved' ? null : trialLimitMessage;
	const hasKeys = isReady(connections.monid);
	const providerReady = useCallback((provider: Provider) => isReady(connections[provider]), [connections]);
	const hasJev = false;
	const openKeys = useCallback(() => setKeysOpen(true), []);
	const closeKeys = useCallback(() => setKeysOpen(false), []);
	const value = useMemo<SettingsContextValue>(() => ({ selfHosted, contextSignIn, workspaceName, settings, update, organization, memberPreferences: memberSettings.preferences, memberPreferencesError, updateMemberPreferences, settingsError, retrySettings, disconnectProvider, server, connections, ready, hasKeys, providerReady, hasJev, logolinkPublicId, keysOpen, trialLimitMessage: activeTrialLimit, reportTrialLimit, openKeys, closeKeys }), [selfHosted, contextSignIn, workspaceName, settings, update, organization, memberSettings.preferences, memberPreferencesError, updateMemberPreferences, settingsError, retrySettings, disconnectProvider, server, connections, ready, hasKeys, providerReady, hasJev, logolinkPublicId, keysOpen, activeTrialLimit, reportTrialLimit, openKeys, closeKeys]);
	return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
	const context = useContext(SettingsContext);
	if (!context) throw new Error('useSettings must be used inside SettingsProvider');
	return context;
}
