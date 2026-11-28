import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APICallError } from 'ai';
import { describeError } from '../../src/lib/server/credentials';
import { testAccess } from './access-fixture';
import { contextClient, readPage } from '../../src/lib/server/context';
import { classifyFailure, Spend } from '../../src/lib/server/enrich-failure';
import { CreditBudgetError } from '../../src/lib/server/credit-ledger';
import { MonidError, runMonidOperation } from '../../src/lib/server/monid';
import { runOp } from '../../src/lib/server/enrich';
import { populatePeopleList } from '../../src/lib/server/populate-people-list';
import { monidFixtureRequest, monidFixtureResponse } from './monid-fixture';

const credentials = { openaiKey: 'secret-openai-key', monidKey: 'secret-monid-key' };
const access = testAccess({ keys: { openai: credentials.openaiKey, monid: credentials.monidKey }, model: 'test' });

test('structured validation errors stay readable and redact credentials', () => {
	const result = access.redact({ status: 400, error: { message: [{ path: ['highlightsParams', 'query'], message: `Too big: expected <=2000 characters ${credentials.monidKey}` }] } });
	assert.match(result, /highlightsParams.query: Too big/);
	assert.match(result, /\[redacted\]/);
	assert.match(result, /\(400\)$/);
	assert.ok(!result.includes(credentials.monidKey));
	assert.equal(describeError({ message: [{ message: 'Invalid query' }] }), 'Invalid query');
	assert.equal(access.redact({ message: {} }), 'Request failed');
	const longKey = 'credential-'.repeat(60);
	assert.ok(!testAccess({ keys: { openai: longKey } }).redact(new Error(longKey)).includes('credential-'));
});

test('web scraping sends bounded highlight instructions through Monid and parses its output', async (t) => {
	const prompt = 'Research this company. ' + 'Company reference data. '.repeat(250);
	t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
		const request = await monidFixtureRequest(new Request(input, options));
		assert.equal(request.provider, 'context.dev');
		assert.equal(request.endpoint, '/web/scrape');
		assert.equal(request.input.body?.highlightsParams && (request.input.body.highlightsParams as { query: string }).query, prompt.slice(0, 2000));
		return monidFixtureResponse(request, { url: 'https://example.com', markdown: { success: true, data: 'Company page' }, highlights: { success: true, data: ['Useful evidence'] } });
	});
	const page = await readPage(contextClient(credentials.monidKey), 'https://example.com', { query: prompt, maxChars: 8000 });
	assert.equal(page.text, 'Useful evidence');
	assert.ok(prompt.length > 2000);
});

test('failed people lookups redact the Monid key before saving an enrichment note', async (t) => {
	const events: import('../../src/lib/types').PopulateEvent[] = [];
	t.mock.method(globalThis, 'fetch', async () => Response.json({ message: `Rejected credential ${credentials.monidKey}` }, { status: 401 }));
	await populatePeopleList(access, { query: 'Ada Lovelace', entity: 'people', target: 1 }, [{ name: 'Ada Lovelace', firstName: 'Ada', lastName: 'Lovelace', companyDomain: 'example.com', companyName: null, email: null, profileUrls: [], city: null, region: null, country: null, school: null }], event => events.push(event), new AbortController().signal);
	assert.ok(!JSON.stringify(events).includes(credentials.monidKey));
	const row = events.flatMap(event => event.type === 'rows' ? event.rows : [])[0];
	assert.equal(row.Name, 'Ada Lovelace');
	assert.equal(row['Enrichment status'], 'Lookup failed');
	assert.match(String(row['Enrichment note']), /\[redacted\]/);
});

test('failures are classified from error types and status codes, not message text', () => {
	const openai = (statusCode: number, responseBody = '') => new APICallError({ message: 'Request failed', url: 'https://api.openai.com/v1/responses', requestBodyValues: {}, statusCode, responseBody, isRetryable: statusCode === 429 || statusCode >= 500 });
	assert.deepEqual(classifyFailure(openai(429)), { reason: 'rate_limited', retryable: true, provider: 'openai' });
	assert.deepEqual(classifyFailure(openai(429, '{"error":{"code":"insufficient_quota"}}')), { reason: 'credits_exhausted', retryable: false, provider: 'openai' });
	assert.deepEqual(classifyFailure(openai(504)), { reason: 'timeout', retryable: false, provider: 'openai' });
	assert.deepEqual(classifyFailure(openai(401)), { reason: 'credential_invalid', retryable: false, provider: 'openai' });
	assert.deepEqual(classifyFailure(new MonidError('wallet empty', 402)), { reason: 'credits_exhausted', retryable: false, provider: 'monid' });
	assert.deepEqual(classifyFailure(new MonidError('slow down', 429)), { reason: 'rate_limited', retryable: true, provider: 'monid' });
	assert.deepEqual(classifyFailure(new MonidError('uncertain run', undefined, undefined, true)), { reason: 'provider_error', retryable: false, provider: 'monid' });
	assert.deepEqual(classifyFailure(new CreditBudgetError('openai', 'rate_limited')), { reason: 'rate_limited', retryable: true, provider: 'openai' });
	assert.equal(classifyFailure(new Error('429 rate limit timed out')), undefined, 'English never decides the outcome');
});

test('an uncertain Monid response is recorded and never resubmitted', async (t) => {
	const spend = new Spend();
	let calls = 0;
	t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ status: 'COMPLETED', output: { results: [] } }); });
	await assert.rejects(runMonidOperation(credentials.monidKey, 'web.search', { body: { query: 'Acme', numResults: 5 } }, { spend }), /no run ID.*not retried/i);
	assert.equal(calls, 1);
	assert.equal(spend.paid, true);
	assert.equal(spend.monidRuns[0].status, 'UNCERTAIN');
});

test('runOp returns stable Monid failures for invalid inputs and missing OpenAI credentials', async () => {
	const invalid = await runOp(access, { kind: 'search', query: '{{Missing}}', pick: 'url', numResults: 5 }, {});
	assert.deepEqual(invalid.failure, { reason: 'input_invalid', retryable: false, provider: 'monid' });
	const missing = await runOp(testAccess({ keys: { monid: credentials.monidKey }, model: 'test' }), { kind: 'ai', prompt: 'Who?', output: 'text', research: 'none' }, {});
	assert.deepEqual(missing.failure, { reason: 'credential_missing', retryable: false, provider: 'openai' });
	assert.match(missing.error!, /Add your OpenAI API key/);
});

test('Monid network failures do not repeat billable submissions', async (t) => {
	let calls = 0;
	t.mock.method(globalThis, 'fetch', async () => { calls++; throw new DOMException('The operation timed out.', 'TimeoutError'); });
	const result = await runOp(access, { kind: 'search', query: 'Acme', pick: 'url', numResults: 1 }, {});
	assert.equal(calls, 1);
	assert.deepEqual(result.failure, { reason: 'provider_error', retryable: false, provider: 'monid' });
});

test('OpenAI calls remain metered and a timeout is never repeated', async (t) => {
	let calls = 0;
	t.mock.method(globalThis, 'fetch', async () => { calls++; return Response.json({ error: { message: 'Gateway Timeout' } }, { status: 504 }); });
	const result = await runOp(access, { kind: 'ai', prompt: 'Who founded {{Company}}?', output: 'text', research: 'none' }, { Company: 'Acme' });
	assert.equal(calls, 1);
	assert.deepEqual(result.failure, { reason: 'timeout', retryable: false, provider: 'openai' });
});

test('runOp persists the selected Monid provider on structured failures', async (t) => {
	let calls = 0;
	t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
		calls++;
		const request = await monidFixtureRequest(new Request(input, init));
		return monidFixtureResponse(request, { results: [] }, { providerResponse: { httpStatus: 429, error: { message: 'slow down' } }, cost: { value: 0, currency: 'USD' } });
	});
	const result = await runOp(access, { kind: 'search', query: 'Acme', pick: 'url', numResults: 1 }, {});
	assert.equal(calls, 1);
	assert.deepEqual(result.failure, { reason: 'rate_limited', retryable: true, provider: 'monid' });
});
