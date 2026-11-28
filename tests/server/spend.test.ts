import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { APICallError, generateText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { Spend, trackedFetch } from '../../src/lib/server/enrich-failure';
import { runMonidOperation } from '../../src/lib/server/monid';
import { testAccess } from './access-fixture';
import { monidFixtureRequest, monidFixtureResponse } from './monid-fixture';

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

test('Monid run receipts record provider, cost, usage, and stable run identity', async (t) => {
	t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
		const request = await monidFixtureRequest(new Request(input, init));
		return monidFixtureResponse(request, { results: [{ url: 'https://example.com' }] }, {
			runId: 'run-1', resultCount: 1, billedUnits: 1, cost: { value: 0.0125, currency: 'USD' },
		});
	});
	const spend = new Spend();
	const run = await runMonidOperation('monid-test-key', 'web.search', { body: { query: 'example', numResults: 1 } }, { spend });
	assert.equal(run.runId, 'run-1');
	assert.equal(spend.paid, true);
	assert.equal(spend.costUsd, 0.0125);
	assert.deepEqual(spend.monidRuns, [{ runId: 'run-1', provider: 'context.dev', endpoint: '/web/search', status: 'COMPLETED', costUsd: 0.0125, billedUnits: 1, price: undefined, resultCount: 1, completedAt: undefined }]);
});

test('Monid 429 refusal is recorded as unbilled and remains safe to retry', async (t) => {
	t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
		const request = await monidFixtureRequest(new Request(input, init));
		return monidFixtureResponse(request, null, {
			providerResponse: { httpStatus: 429, error: { message: 'slow down' } },
			cost: { value: 0, currency: 'USD' },
		});
	});
	const spend = new Spend();
	await assert.rejects(runMonidOperation('monid-test-key', 'web.search', { body: { query: 'example', numResults: 1 } }, { spend }), /slow down/);
	assert.equal(spend.paid, false);
	assert.equal(spend.costUsd, 0);
	assert.equal(spend.monidRuns[0]?.status, 'COMPLETED');
});

test('a missing Monid run receipt is uncertain, charged conservatively, and never resubmitted', async (t) => {
	let calls = 0;
	t.mock.method(globalThis, 'fetch', async () => {
		calls++;
		return Response.json({ status: 'COMPLETED', output: { results: [] } });
	});
	const spend = new Spend();
	await assert.rejects(runMonidOperation('monid-test-key', 'web.search', { body: { query: 'example', numResults: 1 } }, { spend }), /no run ID.*not retried/i);
	assert.equal(calls, 1);
	assert.equal(spend.paid, true);
	assert.equal(spend.monidRuns[0]?.status, 'UNCERTAIN');
});

test('the HTTP spend tracker treats a 429 as unbilled and other responses as potentially billed', async (t: TestContext) => {
	const spend = new Spend();
	const transport = t.mock.fn(async (input: RequestInfo | URL) => new Response(null, { status: String(input).includes('429') ? 429 : 503 }));
	const fetch = trackedFetch(transport as typeof globalThis.fetch, spend);
	await fetch('https://provider.example/429');
	assert.equal(spend.paid, false);
	await fetch('https://provider.example/503');
	assert.equal(spend.paid, true);
});

test('OpenAI: a model call is paid once it answers or fails after reaching OpenAI; a refusal or unsent call is not', async () => {
	const failed = (statusCode?: number, cause?: unknown) => new APICallError({ message: 'Failed', url: 'https://api.openai.com/v1/responses', requestBodyValues: {}, statusCode, cause, isRetryable: true });
	const call = (doGenerate: () => Promise<never> | Promise<object>) => {
		const spend = new Spend();
		const access = testAccess({ keys: { openai: 'spend-openai' } }, { openai: () => new MockLanguageModelV4({ doGenerate: doGenerate as never }) }).withSpend(spend);
		return generateText({ model: access.openai(), prompt: 'Hi', maxRetries: 0 }).then(() => spend, () => spend);
	};
	assert.equal((await call(async () => ({ content: [{ type: 'text', text: 'ok' }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] }))).paid, true);
	assert.equal((await call(async () => { throw failed(503); })).paid, true);
	assert.equal((await call(async () => { throw failed(429); })).paid, false);
	assert.equal((await call(async () => { throw failed(undefined, Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })); })).paid, false);
	assert.equal((await call(async () => { throw failed(undefined, Object.assign(new Error('reset'), { code: 'ECONNRESET' })); })).paid, true);
});
