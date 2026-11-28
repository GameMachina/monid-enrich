import assert from 'node:assert/strict';
import { test } from 'node:test';
import { contextClient, webSearchCountries } from '../../src/lib/server/context';
import { monidFixtureRequest, monidFixtureResponse } from './monid-fixture';

test('country selections localize requests, deduplicate results, and preserve an unfiltered default', async (t) => {
	const bodies: Array<{ country?: string; numResults: number }> = [];
	t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
		const request = new Request(input, options);
		const monid = await monidFixtureRequest(request);
		assert.equal(request.url, 'https://api.monid.ai/v1/run');
		assert.equal(monid.endpoint, '/web/search');
		const body = monid.input.body as { country?: string; numResults: number };
		bodies.push(body);
		return monidFixtureResponse(monid, { results: [{ url: 'https://shared.example', title: 'Shared', description: '' }, { url: `https://${body.country}.example`, title: body.country, description: '' }] });
	});
	const result = await webSearchCountries(contextClient('test-key'), 'software', ['US', 'GB', 'US'], { numResults: 4 });
	assert.deepEqual(bodies.map((body) => body.country), ['us', 'gb']);
	assert.deepEqual(bodies.map((body) => body.numResults), [2, 2]);
	assert.equal(result.results.length, 3);
	await webSearchCountries(contextClient('test-key'), 'software', [], { numResults: 2 });
	assert.equal(bodies[2].country, undefined);
	await assert.rejects(webSearchCountries(contextClient('test-key'), 'software', ['ZZ']), /Unsupported country/);
	assert.equal(bodies.length, 3);
});
