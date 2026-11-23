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

test('Treg company enrichment uses its routed profile endpoint without calling Monid', async (t) => {
	const fetch = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
		assert.equal(String(input), 'https://treg.to/call/treg.companies.enrich');
		assert.equal(new Headers(init?.headers).get('x-treg-token'), 'treg-secret');
		assert.equal(new Headers(init?.headers).get('x-monid-key'), null);
		assert.equal(new Headers(init?.headers).get('x-treg-route-max-cost'), '0.25');
		assert.deepEqual(JSON.parse(String(init?.body)), { domain: 'example.com' });
		return Response.json({ output: { name: 'Example', domain: 'example.com', description: 'Company profile', industry: 'Software', employees: '51-200', linkedin_url: 'https://linkedin.com/company/example' }, _treg: { status: 'COMPLETED', cost_usd: 0.12, call_id: 'call-company' } });
	});
	const op: ColumnOp = { kind: 'company', dataProvider: 'treg', domain: '{{Domain}}', field: 'description' };
	const result = await runOp(testAccess({ keys: { treg: 'treg-secret', monid: 'monid-secret' } }), op, { Domain: 'example.com' });
	assert.equal(result.value, 'Company profile');
	assert.equal(result.meta?.dataProvider, 'treg');
	assert.equal(result.meta?.tregCostUsd, 0.12);
	assert.equal(result.meta?.tregRuns?.[0]?.callId, 'call-company');
	assert.equal(fetch.mock.callCount(), 1);
});

test('Treg company funding maps financing events and preserves their source URLs', async (t) => {
	t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		assert.equal(new URL(request.url).pathname, '/call/predictleads.companies.financing_events');
		assert.equal(new URL(request.url).searchParams.get('company_id_or_domain'), 'example.com');
		assert.equal(new URL(request.url).searchParams.get('limit'), '1000');
		assert.equal(new Headers(request.headers).get('x-treg-route-max-cost'), '0.04');
		assert.equal(new Headers(request.headers).get('x-monid-key'), null);
		return Response.json({ output: { data: [
			{ id: 'round-a', attributes: { effective_date: '2023-04-01', financing_type: 'funding round', financing_type_normalized: 'series_a', amount_normalized: 5_000_000, source_urls: ['https://news.example/round-a'] } },
			{ id: 'round-b', attributes: { effective_date: '2024-07-10', financing_type: 'funding round', financing_type_normalized: 'series_b', amount_normalized: 15_000_000, source_urls: ['https://news.example/round-b'] } },
		] }, _treg: { status: 'COMPLETED', cost_usd: 0.04, call_id: 'call-funding' } });
	});
	const op: ColumnOp = { kind: 'company', dataProvider: 'treg', domain: '{{Domain}}', field: 'funding_total' };
	const result = await runOp(testAccess({ keys: { treg: 'treg-secret', monid: 'monid-secret' } }), op, { Domain: 'example.com' });
	assert.equal(result.value, 20_000_000);
	assert.deepEqual(result.meta?.sources, ['https://news.example/round-a', 'https://news.example/round-b', 'https://example.com']);
	assert.equal(result.meta?.dataProvider, 'treg');
	assert.equal(result.meta?.tregCostUsd, 0.04);
	assert.equal(result.meta?.tregRuns?.[0]?.callId, 'call-funding');
});

test('Treg company phone extraction uses the inspected brand query schema and keeps analyzed pages', async (t) => {
	t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
		assert.equal(String(input), 'https://treg.to/call/branddev.brand.ai.query');
		assert.equal(new Headers(init?.headers).get('x-treg-route-max-cost'), '0.02534');
		assert.deepEqual(JSON.parse(String(init?.body)), { domain: 'example.com', data_to_extract: [{ datapoint_name: 'company_phone_number', datapoint_description: 'The main publicly listed telephone number for this company, including country code when available.', datapoint_example: '+1 650 555 0100', datapoint_type: 'text' }] });
		return Response.json({ output: { domain: 'example.com', urls_analyzed: ['https://example.com/contact'], data_extracted: [{ datapoint_name: 'company_phone_number', datapoint_value: '+1 650 555 0100' }] }, _treg: { status: 'COMPLETED', cost_usd: 0.02534, call_id: 'call-company-phone' } });
	});
	const op: ColumnOp = { kind: 'company', dataProvider: 'treg', domain: '{{Domain}}', field: 'phone' };
	const result = await runOp(testAccess({ keys: { treg: 'treg-secret', monid: 'monid-secret' } }), op, { Domain: 'example.com' });
	assert.equal(result.value, '+1 650 555 0100');
	assert.deepEqual(result.meta?.sources, ['https://example.com/contact', 'https://example.com']);
	assert.equal(result.meta?.tregRuns?.[0]?.callId, 'call-company-phone');
});

test('Treg ticker lookup matches the exact company name and records both Treg calls', async (t) => {
	const fetch = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init), url = new URL(request.url);
		assert.equal(new Headers(request.headers).get('x-monid-key'), null);
		if (url.pathname.endsWith('/treg.companies.enrich')) {
			assert.deepEqual(await request.json(), { domain: 'example.com' });
			return Response.json({ output: { name: 'Example Inc.', domain: 'example.com' }, _treg: { status: 'COMPLETED', cost_usd: 0.03, call_id: 'call-ticker-company' } });
		}
		assert.equal(url.pathname, '/call/finnhub.symbol.search');
		assert.equal(url.searchParams.get('q'), 'Example Inc.');
		return Response.json({ output: { result: [{ description: 'Example Inc', displaySymbol: 'EXMP' }, { description: 'Example Holdings', displaySymbol: 'EXH' }] }, _treg: { status: 'COMPLETED', cost_usd: 0, call_id: 'call-ticker-search' } });
	});
	const op: ColumnOp = { kind: 'company', dataProvider: 'treg', domain: '{{Domain}}', field: 'ticker' };
	const result = await runOp(testAccess({ keys: { treg: 'treg-secret', monid: 'monid-secret' } }), op, { Domain: 'example.com' });
	assert.equal(result.value, 'EXMP');
	assert.equal(result.meta?.tregCostUsd, 0.03);
	assert.deepEqual(result.meta?.tregRuns?.map((run) => run.callId), ['call-ticker-company', 'call-ticker-search']);
	assert.equal(fetch.mock.callCount(), 2);
});

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

test('Treg social search uses its web route for X without calling Monid', async (t) => {
	const fetch = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
		assert.equal(String(input), 'https://treg.to/call/treg.web.search');
		assert.equal(new Headers(init?.headers).get('x-treg-token'), 'treg-secret');
		assert.equal(new Headers(init?.headers).get('x-monid-key'), null);
		assert.match(String(init?.body), /site:x\.com/);
		return Response.json({ output: { results: [{ url: 'https://x.com/ada', title: 'Ada Lovelace' }] }, _treg: { status: 'COMPLETED', cost_usd: 0.02, call_id: 'call-social' } });
	});
	const op: ColumnOp = { kind: 'social-enrichment', dataProvider: 'treg', name: 'Ada Lovelace', company: '', domain: '', profileUrl: '', email: '', platform: 'x', providers: ['web_search'] };
	const result = await runOp(testAccess({ keys: { treg: 'treg-secret', monid: 'monid-secret' } }), op, {});
	assert.equal(result.value, 'https://x.com/ada');
	assert.equal(result.meta?.dataProvider, 'treg');
	assert.equal(result.meta?.tregRuns?.[0]?.callId, 'call-social');
	assert.equal(fetch.mock.callCount(), 1);
});
