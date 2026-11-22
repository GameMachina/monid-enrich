import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runOp } from '../../src/lib/server/enrich';
import { testAccess } from './access-fixture';

const access = testAccess({ keys: { monid: 'monid-secret' }, model: 'unused' });

test('email lookup and verification run through Monid and keep the run receipt in cell metadata', async (t) => {
	const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
	t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		const body = await request.json() as Record<string, unknown>;
		calls.push({ url: request.url, headers: request.headers, body });
		const lookup = request.url.endsWith('/run') && body.endpoint === '/email-finder';
		return Response.json({
			runId: lookup ? 'run-email' : 'run-verify', provider: lookup ? 'hunterio' : 'anyapi', endpoint: body.endpoint,
			status: 'COMPLETED', output: lookup
				? { data: { email: 'ada@example.com', status: 'valid', score: 91, sources: [{ uri: 'https://example.com/team' }] } }
				: { status: 'valid', score: 99 },
			cost: { value: lookup ? 0.0245 : 0.0066, currency: 'USD' }, billedUnits: 1,
		});
	});

	const found = await runOp(access, { kind: 'hunter', action: 'find', name: '{{Name}}', domain: '{{Website}}' }, { Name: 'Ada Lovelace', Website: 'https://www.example.com/about' });
	assert.equal(found.value, 'ada@example.com');
	assert.deepEqual(found.meta?.sources, ['https://example.com/team']);
	assert.equal(found.meta?.monidRuns?.[0]?.runId, 'run-email');
	assert.equal(found.meta?.monidRuns?.[0]?.costUsd, 0.0245);
	const input = calls[0]?.body.input as { queryParams: Record<string, string> };
	assert.deepEqual(input.queryParams, { full_name: 'Ada Lovelace', domain: 'example.com', first_name: 'Ada', last_name: 'Lovelace', max_duration: 10 });

	const verified = await runOp(access, { kind: 'hunter', action: 'verify', email: '{{Email}}' }, { Email: 'ada@example.com' });
	assert.equal(verified.value, 'valid');
	assert.equal(verified.meta?.monidRuns?.[0]?.runId, 'run-verify');
	assert.equal(calls.every((call) => call.url === 'https://api.monid.ai/v1/run'), true);
	assert.ok(calls.every((call) => call.headers.get('authorization') === 'Bearer monid-secret'));
	assert.ok(!JSON.stringify(calls).includes('monid-secret'));
});

test('mobile enrichment runs through Monid and keeps the provider receipt and cost', async (t) => {
	const calls: Array<{ url: string; headers: Headers; body: Record<string, unknown> }> = [];
	t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		const body = await request.json() as Record<string, unknown>;
		calls.push({ url: request.url, headers: request.headers, body });
		return Response.json({
			runId: 'run-mobile', provider: 'clay', endpoint: '/enrichment/mobile-phone', status: 'COMPLETED',
			output: { 'Mobile Phone': '+14155550123' }, cost: { value: 0.568, currency: 'USD' }, billedUnits: 1,
		});
	});

	const result = await runOp(access, { kind: 'person', field: 'mobile', name: '{{Name}}', company: '{{Company}}', profileUrl: '{{LinkedIn}}' }, {
		Name: 'Ada Lovelace', Company: 'Analytical Engines', LinkedIn: 'https://www.linkedin.com/in/ada-lovelace',
	});
	assert.equal(result.value, '+14155550123');
	assert.equal(result.meta?.monidRuns?.[0]?.runId, 'run-mobile');
	assert.equal(result.meta?.monidRuns?.[0]?.costUsd, 0.568);
	assert.equal(calls[0]?.url, 'https://api.monid.ai/v1/run');
	assert.equal(calls[0]?.headers.get('authorization'), 'Bearer monid-secret');
	assert.deepEqual(calls[0]?.body, {
		provider: 'clay', endpoint: '/enrichment/mobile-phone', input: { body: {
			'Social Profile URL': 'https://www.linkedin.com/in/ada-lovelace', 'Full Name': 'Ada Lovelace', 'Company Name': 'Analytical Engines',
		} },
	});
});

test('mobile enrichment requires the Monid endpoint’s identifying fields before calling the provider', async (t) => {
	const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected provider request'); });
	const result = await runOp(access, { kind: 'person', field: 'mobile' }, { LinkedIn: 'https://linkedin.com/in/ada' });
	assert.match(result.error ?? '', /full name/i);
	assert.equal(fetch.mock.callCount(), 0);
});

test('mobile waterfall runs the second Monid route only after a completed no-match and preserves both receipts', async (t) => {
	const calls: Array<{ endpoint: string; input: Record<string, unknown> }> = [];
	t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		const body = await request.json() as { endpoint: string; input: { body: Record<string, unknown> } };
		calls.push({ endpoint: body.endpoint, input: body.input.body });
		const isLeadMagic = body.endpoint === '/mobile_phone.leadmagic';
		return Response.json({
			runId: isLeadMagic ? 'run-leadmagic' : 'run-clay', provider: isLeadMagic ? 'anyapi' : 'clay', endpoint: body.endpoint,
			status: 'COMPLETED', output: isLeadMagic ? { mobile: null } : { 'Mobile Phone': '+14155550123' },
			cost: { value: isLeadMagic ? 0.2016 : 0.568, currency: 'USD' }, billedUnits: 1,
		});
	});

	const result = await runOp(access, { kind: 'person', field: 'mobile', phoneStrategy: 'leadmagic-then-clay', name: '{{Name}}', company: '{{Company}}', profileUrl: '{{LinkedIn}}' }, {
		Name: 'Ada Lovelace', Company: 'Analytical Engines', LinkedIn: 'https://www.linkedin.com/in/ada-lovelace',
	});
	assert.equal(result.value, '+14155550123');
	assert.deepEqual(calls.map(({ endpoint }) => endpoint), ['/mobile_phone.leadmagic', '/enrichment/mobile-phone']);
	assert.equal(calls[0]?.input.profileUrl, 'https://www.linkedin.com/in/ada-lovelace');
	assert.equal(result.meta?.monidRuns?.length, 2);
	assert.deepEqual(result.meta?.monidRuns?.map((run) => run.runId), ['run-leadmagic', 'run-clay']);
	assert.ok(Math.abs((result.meta?.monidCostUsd ?? 0) - 0.7696) < 0.000001);
	assert.deepEqual(result.meta?.sources, ['https://www.linkedin.com/in/ada-lovelace']);
});

test('mobile waterfall stops after a Monid timeout and never submits the fallback provider', async (t) => {
	const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ message: 'gateway timeout' }, { status: 504 }));
	const result = await runOp(access, { kind: 'person', field: 'mobile', phoneStrategy: 'leadmagic-then-clay', name: '{{Name}}', company: '{{Company}}', profileUrl: '{{LinkedIn}}' }, {
		Name: 'Ada Lovelace', Company: 'Analytical Engines', LinkedIn: 'https://www.linkedin.com/in/ada-lovelace',
	});
	assert.match(result.error ?? '', /timed out/i);
	assert.equal(fetch.mock.callCount(), 1);
	assert.equal(result.meta?.monidRuns?.[0]?.status, 'UNCERTAIN');
});

test('mobile waterfall respects the workspace provider allowlist before making a paid call', async (t) => {
	const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected provider request'); });
	const restricted = testAccess({ keys: { monid: 'monid-secret' }, allowedPhoneProviders: ['clay'] });
	const result = await runOp(restricted, { kind: 'person', field: 'mobile', phoneStrategy: 'leadmagic-then-clay' }, {});
	assert.match(result.error ?? '', /workspace has disabled/i);
	assert.equal(fetch.mock.callCount(), 0);
});
