import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextClient } from '../../src/lib/server/context';
import { Spend } from '../../src/lib/server/enrich-failure';
import { lookupPerson } from '../../src/lib/server/person-lookup';
import { monidFixtureRequest, monidFixtureResponse } from './monid-fixture';

const candidate = { name: 'Theo Browne', profiles: ['https://linkedin.com/in/t3gg'], role: { company: { name: 'T3' } } };
const notFound = { request_id: 'lookup', match: { status: 'not_found', person: null, score: null } };

test('an unresolved supplied name searches and enriches the unique matching profile', async (t) => {
	const calls: string[] = [];
	const spend = new Spend();
	let run = 0;
	t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
		const request = new Request(input, options);
		const monid = await monidFixtureRequest(request);
		calls.push(monid.endpoint);
		const cost = [0.02, 0.03, 0.04][run] ?? 0;
		const receipt = { runId: `lookup-${run++}`, cost: { value: cost, currency: 'USD' } };
		if (monid.endpoint === '/people/search') return monidFixtureResponse(monid, { request_id: 'search', results: [candidate] }, receipt);
		assert.equal(monid.endpoint, '/people/enrich');
		if (!monid.input.body?.social_urls) return monidFixtureResponse(monid, notFound, receipt);
		assert.deepEqual(monid.input.body.social_urls, candidate.profiles);
		return monidFixtureResponse(monid, { request_id: 'match', match: { status: 'candidate', score: 1, person: { avatar_url: 'https://cdn.example/theo.png' } } }, receipt);
	});
	const response = await lookupPerson(contextClient('test', undefined, spend), { name: { first: 'Theo', last: 'Browne' }, company: { name: 'T3' } }, 'Theo Browne');
	assert.equal(response.match.status, 'candidate');
	assert.deepEqual(calls, ['/people/enrich', '/people/search', '/people/enrich']);
	assert.equal(spend.costUsd, 0.09);
});

test('ambiguous names and wrong employers never attach a search candidate photo', async (t) => {
	for (const [index, results] of [[candidate, { ...candidate, profiles: ['https://linkedin.com/in/another'] }], [{ ...candidate, role: { company: { name: 'Other' } } }]].entries()) {
		let enrichCalls = 0;
		const mock = t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
			const request = new Request(input, options);
			const monid = await monidFixtureRequest(request);
			if (monid.endpoint === '/people/search') return monidFixtureResponse(monid, { request_id: 'search', results });
			assert.equal(monid.endpoint, '/people/enrich');
			enrichCalls++;
			return monidFixtureResponse(monid, notFound);
		});
		const response = await lookupPerson(contextClient(`test-ambiguous-${index}`), { name: { first: 'Theo', last: 'Browne' }, company: { name: 'T3' } }, 'Theo Browne');
		assert.equal(response.match.status, 'not_found');
		assert.equal(enrichCalls, 1);
		mock.mock.restore();
	}
});
