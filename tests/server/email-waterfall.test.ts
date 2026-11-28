import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ColumnOpSchema, type ColumnOp } from '../../src/lib/types';
import { opDependencies, renameOpReferences } from '../../src/lib/references';
import { emailCandidate, runEmailWaterfall, sharedRequest } from '../../src/lib/server/contextdevenrichmentwaterfall';
import { testAccess } from './access-fixture';
import { monidFixtureRequest, monidFixtureResponse } from './monid-fixture';

const op: Extract<ColumnOp, { kind: 'email-enrichment' }> = {
	kind: 'email-enrichment', name: '{{Name}}', company: '{{Company}}', domain: '{{Domain}}', profileUrl: '', providers: ['hunter', 'apollo'],
};
const row = { Name: 'Ada Lovelace', Company: 'Example', Domain: 'example.com' };
const access = () => testAccess({ keys: { monid: 'monid-test-key' }, model: 'unused' });

test('email candidates preserve verification, confidence and provider sources', () => {
	assert.deepEqual(emailCandidate('monid', { data: { email: 'ada@example.com', verification: { status: 'valid' }, score: 92, sources: [{ url: 'https://example.com/team' }] } }), {
		email: 'ada@example.com', verified: true, verificationStatus: 'valid', confidence: 0.92, sources: ['https://example.com/team'],
	});
	assert.equal(emailCandidate('monid', { data: { email: 'a***@example.com' } }).email, null);
});

test('email lookup uses the inspected Monid email-finder query', () => {
	const request = sharedRequest('monid', { name: 'Ada Lovelace', domain: 'example.com', company: 'Example', profileUrl: 'https://www.linkedin.com/in/ada' });
	assert.equal(request.operation, 'email.find');
	assert.deepEqual(request.input.queryParams, { full_name: 'Ada Lovelace', domain: 'example.com', max_duration: 10, first_name: 'Ada', last_name: 'Lovelace', linkedin_handle: 'ada' });
	assert.equal(request.boundUsd, 0.0245);
});

test('the email waterfall calls Monid routes in order, stops on a match, and records both receipts', async (t) => {
	const calls: Array<{ provider: string; endpoint: string; input: unknown }> = [];
	t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
		const request = await monidFixtureRequest(new Request(input, init));
		calls.push(request);
		const output = request.endpoint === '/email-finder'
			? { data: { email: null } }
			: { data: { email: 'ada@example.com', verification: { status: 'valid' }, score: 96, sources: ['https://example.com/team'] } };
		return monidFixtureResponse(request, output, { cost: { value: request.endpoint === '/email-finder' ? 0.003 : 0.004, currency: 'USD' } });
	});

	const result = await runEmailWaterfall(access(), op, row);
	assert.equal(result.value, 'ada@example.com');
	assert.deepEqual(calls.map(({ provider, endpoint }) => [provider, endpoint]), [['hunterio', '/email-finder'], ['apollo', '/people/match']]);
	assert.deepEqual(result.meta?.enrichment?.attempts.map(({ provider, status }) => [provider, status]), [['hunter', 'No email found'], ['apollo', 'Found']]);
	assert.equal(result.meta?.enrichment?.verified, true);
	assert.equal(result.meta?.monidRuns?.length, 2);
	assert.equal(result.meta?.monidCostUsd, 0.007);
	assert.deepEqual(result.meta?.sources, ['https://example.com/team']);
});

test('email lookup fails before HTTP without a Monid key or required identity', async (t) => {
	let calls = 0;
	t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('must not call Monid'); });
	await assert.rejects(runEmailWaterfall(testAccess(), op, row), /Add your Monid API key/);
	await assert.rejects(runEmailWaterfall(access(), op, { ...row, Name: '' }), /person name and company domain/);
	assert.equal(calls, 0);
});

test('invalid provider selections fail schema validation; mappings track row dependencies', () => {
	assert.equal(ColumnOpSchema.safeParse({ ...op, providers: ['hunter', 'hunter'] }).success, false);
	assert.equal(ColumnOpSchema.safeParse({ ...op, providers: [] }).success, false);
	assert.deepEqual(opDependencies(op), ['Name', 'Company', 'Domain']);
	assert.equal((renameOpReferences(op, 'Domain', 'Website') as typeof op).domain, '{{Website}}');
});
