import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MonidError, runMonid, runMonidOperation } from '../../src/lib/server/monid';
import { Spend } from '../../src/lib/server/enrich-failure';
import { actor } from './ledger-fixture';
import { closeEmbeddedWorkspaceDatabase, withDatabase } from '../../src/lib/server/database';

test('async Monid runs poll the returned receipt and never submit the operation twice', async (t) => {
	const originalTimeout = globalThis.setTimeout;
	t.mock.method(globalThis, 'setTimeout', ((callback: (...args: unknown[]) => void, _delay?: number, ...args: unknown[]) => originalTimeout(callback, 1, ...args)) as typeof setTimeout);
	const calls: Array<{ url: string; method: string; body?: unknown }> = [];
	t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		const url = request.url;
		const method = request.method;
		const body = method === 'POST' ? await request.json() : undefined;
		calls.push({ url, method, body });
		if (url.endsWith('/v1/run')) return Response.json({ runId: 'async-1', provider: 'context.dev', endpoint: '/company/search', status: 'RUNNING' }, { status: 202 });
		return Response.json({ runId: 'async-1', provider: 'context.dev', endpoint: '/company/search', status: 'COMPLETED', output: { results: [{ name: 'Acme', domain: 'acme.example' }] }, cost: { value: 0.04, currency: 'USD' }, billedUnits: 2, resultCount: 1, completedAt: '2026-11-22T00:00:00.000Z' });
	});
	const spend = new Spend();
	const run = await runMonid('monid-secret', 'context.dev', '/company/search', { body: { query: 'software companies' } }, { spend });
	assert.equal(run.output && (run.output as { results: unknown[] }).results.length, 1);
	assert.deepEqual(calls.map(({ url, method }) => [new URL(url).pathname, method]), [['/v1/run', 'POST'], ['/v1/runs/async-1', 'GET']]);
	assert.equal(calls[0]?.body && (calls[0].body as { provider: string }).provider, 'context.dev');
	assert.deepEqual(spend.monidRuns.map(({ runId, status, costUsd, billedUnits, resultCount }) => ({ runId, status, costUsd, billedUnits, resultCount })), [{ runId: 'async-1', status: 'COMPLETED', costUsd: 0.04, billedUnits: 2, resultCount: 1 }]);
	assert.equal(spend.paid, true);
});

test('typed app operations map to the inspected Monid routes and preserve request placement', async (t) => {
	const requests: Array<{ url: string; body: unknown }> = [];
	t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
		const request = new Request(input, init);
		requests.push({ url: request.url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
		return Response.json({ runId: `typed-${requests.length}`, status: 'COMPLETED', provider: 'monid', endpoint: '/ok', output: { status: 'good' }, cost: { value: 0.0066, currency: 'USD' } });
	});
	await runMonidOperation('monid-secret', 'company.search', { body: { query: 'EU fintech companies', mode: 'fast' } });
	await runMonidOperation('monid-secret', 'email.verify', { body: { email: 'person@example.org' } });
	assert.ok(requests.every(({ url }) => new URL(url).origin === 'https://api.monid.ai'));
	assert.deepEqual(requests.map(({ body }) => body), [
		{ provider: 'context.dev', endpoint: '/company/search', input: { body: { query: 'EU fintech companies', mode: 'fast' } } },
		{ provider: 'anyapi', endpoint: '/email.verify', input: { body: { email: 'person@example.org' } } },
	]);
});

test('an uncertain submit is not retried and retains a non retryable run outcome', async (t) => {
	let requests = 0;
	t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('socket reset'); });
	const spend = new Spend();
	await assert.rejects(runMonid('monid-secret', 'context.dev', '/company/search', { body: { query: 'software companies' } }, { spend }), (error: unknown) => error instanceof MonidError && error.uncertain && !error.runId);
	assert.equal(requests, 1);
	assert.equal(spend.monidRuns[0]?.status, 'UNCERTAIN');
	assert.equal(spend.paid, true, 'unknown provider status is treated as potentially billed');
});

test('a Monid gateway timeout is marked uncertain and tells the user to check run history', async (t) => {
	let requests = 0;
	t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({ error: 'gateway timed out' }, { status: 504 }); });
	const spend = new Spend();
	await assert.rejects(runMonid('monid-secret', 'context.dev', '/brand/retrieve', { queryParams: { domain: 'example.com' } }, { spend }), (error: unknown) =>
		error instanceof MonidError && error.uncertain && /check Monid run history before retrying/i.test(error.message),
	);
	assert.equal(requests, 1);
	assert.equal(spend.monidRuns[0]?.status, 'UNCERTAIN');
	assert.equal(spend.paid, true, 'a timeout without a receipt could have been billed');
});

test('Monid validation failures preserve nested provider error messages', async (t) => {
	t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { details: [{ message: 'Social Profile URL must be a LinkedIn profile URL.' }] } }, { status: 400 }));
	await assert.rejects(runMonid('monid-secret', 'clay', '/enrichment/mobile-phone', { body: { 'Full Name': 'Jane Example' } }), (error: unknown) =>
		error instanceof MonidError && error.status === 400 && /Social Profile URL must be a LinkedIn profile URL/i.test(error.message),
	);
});

test('Monid provider errors preserve nested response messages and run receipts', async (t) => {
	t.mock.method(globalThis, 'fetch', async () => Response.json({
		runId: 'provider-400', provider: 'clay', endpoint: '/enrichment/mobile-phone', status: 'COMPLETED',
		providerResponse: { httpStatus: 400, error: { error: { message: 'The profile could not be matched.' } } },
		cost: { value: 0, currency: 'USD' },
	}));
	await assert.rejects(runMonid('monid-secret', 'clay', '/enrichment/mobile-phone', { body: { 'Full Name': 'Jane Example' } }), (error: unknown) =>
		error instanceof MonidError && error.status === 400 && error.runId === 'provider-400' && /profile could not be matched/i.test(error.message),
	);
});

test('local workspaces durably record only a hashed input and Monid receipt metadata', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'monid-run-store-'));
	const previousDatabaseUrl = process.env.DATABASE_URL;
	const previousDatabasePath = process.env.ENRICHABLE_LOCAL_DATABASE_PATH;
	delete process.env.DATABASE_URL;
	process.env.ENRICHABLE_LOCAL_DATABASE_PATH = join(directory, '.data', 'database');
	t.after(async () => {
		if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabaseUrl;
		if (previousDatabasePath === undefined) delete process.env.ENRICHABLE_LOCAL_DATABASE_PATH; else process.env.ENRICHABLE_LOCAL_DATABASE_PATH = previousDatabasePath;
		await closeEmbeddedWorkspaceDatabase();
		await rm(directory, { recursive: true, force: true });
	});
	t.mock.method(globalThis, 'fetch', async () => Response.json({ runId: 'local-1', provider: 'context.dev', endpoint: '/company/search', status: 'COMPLETED', createdAt: '2026-11-22T11:40:15.950Z', output: {}, cost: { value: 0.02, currency: 'USD' } }));
	await runMonid('monid-private-key', 'context.dev', '/company/search', { body: { query: 'private sample query' } }, { actor: actor('local'), spend: new Spend() });
	const [saved] = await withDatabase(async (database) => (await database.read(
		`SELECT run_id,status,input_hash,cost_usd::float8 AS cost_usd,created_at,error::text AS error FROM enrichable.monid_runs WHERE run_id=$1`, ['local-1'],
	)).rows);
	assert.ok(saved);
	assert.equal(saved.run_id, 'local-1');
	assert.equal(saved.status, 'COMPLETED');
	assert.equal(Number(saved.cost_usd), 0.02);
	assert.equal(Number(saved.created_at), Date.parse('2026-11-22T11:40:15.950Z'));
	assert.match(String(saved.input_hash), /^[a-f0-9]{64}$/);
	assert.doesNotMatch(JSON.stringify(saved), /monid-private-key|private sample query/);
});
