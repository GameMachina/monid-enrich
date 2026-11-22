import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setStorageAccount } from '../src/lib/account-storage';
import { DEFAULT_SETTINGS, initializeOrganizationSettings, loadSettings, saveSettings } from '../src/lib/keys';

test('legacy browser credentials migrate into the encrypted server vault and are removed locally', async (t) => {
	const storage = new Map<string, string>();
	const settingsKey = 'enrichable.settings.v1.account.org-client-test';
	storage.set(settingsKey, JSON.stringify({ ...DEFAULT_SETTINGS, monidKey: 'monid_legacy_secret', openaiKey: 'sk-legacy-secret', contextKey: 'context-legacy-secret', model: 'gpt-5.4-mini' }));
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
	Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
	} } });
	setStorageAccount({ partition: 'org-client-test', sessionId: 'session-local-test' });
	const posts: Array<{ url: string; body: Record<string, unknown> }> = [];
	t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
		const url = String(input);
		if (init?.method === 'POST') posts.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
		if (url === '/api/organization-settings') return Response.json({ local: true });
		return Response.json({ ok: true });
	});
	try {
		assert.equal(await initializeOrganizationSettings(), false);
		assert.deepEqual(posts[0]?.body, { providers: { monid: 'monid_legacy_secret', openai: 'sk-legacy-secret' } });
		assert.equal(JSON.stringify(storage.get(settingsKey)).includes('monid_legacy_secret'), false);
		assert.equal(JSON.stringify(storage.get(settingsKey)).includes('sk-legacy-secret'), false);
		assert.equal(loadSettings().monidKey, '');
		assert.equal(loadSettings().openaiKey, '');
		await saveSettings({ monidKey: 'monid_new_secret' });
		assert.ok(!JSON.stringify([...storage]).includes('monid_new_secret'));
		assert.ok(!JSON.stringify(posts).includes('context-legacy-secret'));
		assert.ok(!JSON.stringify(posts).includes('hunter'));
	} finally {
		if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
		else Reflect.deleteProperty(globalThis, 'window');
	}
});
