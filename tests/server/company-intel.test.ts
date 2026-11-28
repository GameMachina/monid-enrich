import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runOp } from '../../src/lib/server/enrich';
import { testAccess } from './access-fixture';
import { monidFixtureRequest, monidFixtureResponse } from './monid-fixture';

const access = testAccess({ keys: { context: 'saved-company-intel' }, model: 'test' });

test('a paid company lookup retains the full profile, including fields not requested', async (t) => {
	let calls = 0;
	const brand = { title: 'Example', description: 'Already paid for', employees: { exact: 42 }, address: { city: 'San Francisco' } };
	t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
		const request = new Request(input, options);
		const monid = await monidFixtureRequest(request);
		assert.equal(monid.endpoint, '/brand/retrieve');
		calls++;
		return monidFixtureResponse(monid, { brand }, { cost: { value: 0.01, currency: 'USD' } });
	});
	const result = await runOp(access, { kind: 'company', domain: '{{Domain}}', field: 'title' }, { Domain: 'company-intel-test.com' });
	assert.equal(result.error, undefined);
	assert.equal(result.value, 'Example');
	assert.equal(calls, 1);
	assert.equal(result.meta?.monidCostUsd, 0.01);
	assert.deepEqual(result.meta?.companyIntel, { domain: 'company-intel-test.com', input: 'company-intel-test.com', source: 'brand', data: brand });
});

test('funding lookups retain only the exact company match and its full saved intel', async (t) => {
	const match = { name: 'Funded', domain: 'funded-intel-test.com', description: 'Saved overview', employees: { count: 15 }, funding: { total_usd: 500000, stage: 'seed' } };
	t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
		const monid = await monidFixtureRequest(new Request(input, options));
		assert.equal(monid.endpoint, '/company/search');
		return monidFixtureResponse(monid, { results: [{ name: 'Wrong', domain: 'other.com' }, match], next_cursor: null }, { cost: { value: 0.02, currency: 'USD' } });
	});
	const result = await runOp(access, { kind: 'company', domain: 'funded-intel-test.com', field: 'funding_total' }, {});
	assert.equal(result.error, undefined);
	assert.equal(result.value, 500000);
	assert.deepEqual(result.meta?.companyIntel?.data, match);
	const missing = await runOp(access, { kind: 'company', domain: 'unmatched-intel-test.com', field: 'funding_total' }, {});
	assert.equal(missing.meta?.companyIntel, undefined);
});

test('a company named by the row is resolved and looked up under one run: both are billed, so a later refusal is final', async (t) => {
	let retrieve = 200;
	t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
		const monid = await monidFixtureRequest(new Request(input, init));
		if (monid.endpoint === '/company/search') {
			const name = String(monid.input.body?.query ?? '');
			return monidFixtureResponse(monid, { results: [{ name, domain: `${name.toLowerCase().replace(/\s+/g, '-')}.example` }], next_cursor: null }, { cost: { value: 0.01, currency: 'USD' } });
		}
		assert.equal(monid.endpoint, '/brand/retrieve');
		if (retrieve === 429) return Response.json({ error: 'slow down' }, { status: 429 });
		return monidFixtureResponse(monid, { brand: { title: 'Spend Labs' } }, { cost: { value: 0.01, currency: 'USD' } });
	});
	const op = { kind: 'company', domain: '{{Company}}', field: 'title' } as const;
	const found = await runOp(access, op, { Company: 'Spend Labs' });
	assert.equal(found.value, 'Spend Labs');
	assert.equal(found.meta?.monidCostUsd, 0.02, 'the name search and the brand lookup');
	retrieve = 429;
	const limited = await runOp(access, op, { Company: 'Spend Labs Two' });
	assert.deepEqual(limited.failure, { reason: 'rate_limited', retryable: false, provider: 'monid' }, 'rerunning would pay for the name search again');
});
