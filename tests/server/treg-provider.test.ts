import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requiredProviders } from '../../src/lib/operations';
import { runOp } from '../../src/lib/server/enrich';
import type { ColumnOp } from '../../src/lib/types';
import { testAccess } from './access-fixture';

const emailOp: ColumnOp = {
	kind: 'email-enrichment',
	dataProvider: 'treg',
	name: '',
	company: '',
	domain: '',
	profileUrl: 'https://www.linkedin.com/in/ada-lovelace',
	providers: ['hunter'],
};

test('a Treg email column requires Treg and only calls the selected Treg endpoint', async (t) => {
	let requestCount = 0;
	t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
		requestCount++;
		assert.equal(String(input), 'https://treg.to/call/treg.people.email.find');
		assert.equal(new Headers(init?.headers).get('x-treg-token'), 'treg-secret');
		assert.equal(new Headers(init?.headers).get('x-monid-key'), null);
		assert.equal(new Headers(init?.headers).get('idempotency-key'), 'treg-email-retry-1');
		assert.deepEqual(JSON.parse(String(init?.body)), { linkedin_url: 'https://www.linkedin.com/in/ada-lovelace' });
		return Response.json({ output: { email: 'ada@example.com', confidence: 0.97, sources: ['https://example.com/profile'] }, _treg: { status: 'COMPLETED', cost_usd: 0.04, call_id: 'call-123' } });
	});
	assert.deepEqual(requiredProviders(emailOp), [['treg']]);
	const result = await runOp(testAccess({ keys: { treg: 'treg-secret' } }), emailOp, {}, { idempotencyKey: 'treg-email-retry-1' });
	assert.equal(requestCount, 1);
	assert.equal(result.value, 'ada@example.com');
	assert.equal(result.meta?.dataProvider, 'treg');
	assert.equal(result.meta?.tregCostUsd, 0.04);
	assert.equal(result.meta?.tregRuns?.[0]?.callId, 'call-123');
	assert.deepEqual(result.meta?.sources, ['https://example.com/profile']);
});

test('a Treg-selected operation never falls back to Monid when Treg is not connected', async (t) => {
	const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('No provider request should be sent.'); });
	const result = await runOp(testAccess({ keys: { monid: 'monid-secret' } }), emailOp, {});
	assert.equal(result.failure?.provider, 'treg');
	assert.equal(result.failure?.reason, 'credential_missing');
	assert.equal(fetch.mock.callCount(), 0);
});

test('unsupported Treg social networks are rejected before any provider call', async (t) => {
	const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unsupported Treg work must not call another provider.'); });
	const op: ColumnOp = { kind: 'social-enrichment', dataProvider: 'treg', name: 'Ada Lovelace', company: '', domain: '', profileUrl: '', email: '', platform: 'x', providers: ['web_search'] };
	const result = await runOp(testAccess({ keys: { treg: 'treg-secret', monid: 'monid-secret' } }), op, {});
	assert.equal(result.failure?.provider, 'treg');
	assert.match(result.error ?? '', /does not support X/);
	assert.equal(fetch.mock.callCount(), 0);
});
