import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setStorageAccount } from '../src/lib/account-storage';
import { DEFAULT_SETTINGS, keyHeaders, loadSettings, saveSettings } from '../src/lib/keys';

test('browser storage retains preferences only and sends a credential only to the server vault', async (t) => {
	const storage = new Map<string, string>();
	const key = 'enrichable.settings.v1.account.persistence-test';
	storage.set(key, JSON.stringify({ ...DEFAULT_SETTINGS, openaiKey: 'sk-old-secret', monidKey: 'monid-old-secret', contextKey: 'context-old-secret', model: 'gpt-5.4-mini' }));
	let failWrites = false;
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
	Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
		getItem: (name: string) => storage.get(name) ?? null,
		setItem: (name: string, value: string) => { if (failWrites) throw new Error('Storage unavailable'); storage.set(name, value); },
		removeItem: (name: string) => storage.delete(name),
	} } });
	setStorageAccount({ partition: 'persistence-test', sessionId: 'test-session' });
	let posted: unknown;
	t.mock.method(globalThis, 'fetch', async (_input: string | URL | Request, init?: RequestInit) => {
		posted = JSON.parse(String(init?.body));
		return Response.json({ ok: true });
	});
	try {
		assert.equal(loadSettings().openaiKey, '', 'Legacy browser keys are never loaded into app state');
		assert.equal(keyHeaders()['x-openai-key'], undefined);
		assert.equal(keyHeaders()['x-monid-key'], undefined);
		assert.equal(loadSettings().model, 'gpt-5.4-mini');
		await saveSettings({ concurrency: 2 });
		const stored = JSON.parse(storage.get(key)!);
		assert.equal(stored.openaiKey, '');
		assert.equal(stored.monidKey, '');
		assert.equal(JSON.stringify(stored).includes('context-old-secret'), false);
		failWrites = true;
		await assert.rejects(saveSettings({ concurrency: 3 }), /Storage unavailable/);
		assert.equal(loadSettings().concurrency, 2, 'A failed browser preference write leaves the current snapshot unchanged');
		failWrites = false;
		await saveSettings({ monidKey: 'monid-new-secret' });
		assert.deepEqual(posted, { providers: { monid: 'monid-new-secret' } });
		assert.equal(JSON.stringify([...storage]).includes('monid-new-secret'), false);
	} finally {
		if (previous) Object.defineProperty(globalThis, 'window', previous);
		else Reflect.deleteProperty(globalThis, 'window');
	}
});
