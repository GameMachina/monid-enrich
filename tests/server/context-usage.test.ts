import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextUsage } from '../../src/lib/server/context';
import { GET } from '../../src/app/api/context/usage/route';

test('reads the actual remaining balance and period usage without caching', async (t) => {
	t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
		assert.equal(String(url), 'https://api.monid.ai/v1/wallet/balance');
		assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-monid');
		assert.equal(init?.cache, 'no-store');
		return Response.json({ balance: { value: 0, currency: 'USD' } });
	});
	assert.deepEqual(await contextUsage('test-monid'), { credits: 0 });
	const response = await GET(new Request('http://localhost/api/context/usage', { headers: { 'x-monid-key': 'test-monid' } }));
	assert.equal(response.status, 200);
	assert.match(response.headers.get('cache-control')!, /no-store/);
	assert.deepEqual(await response.json(), { credits: 0 });
});

test('usage failures do not become a zero balance', async (t) => {
	t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 403 }));
	const response = await GET(new Request('http://localhost/api/context/usage', { headers: { 'x-monid-key': 'test-monid' } }));
	assert.equal(response.status, 502);
	assert.ok((await response.json()).error);
});
