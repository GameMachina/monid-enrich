import assert from 'node:assert/strict';
import { test } from 'node:test';
import { populateStream } from '../../src/lib/server/populate';
import { DEFAULT_TABLE_TYPES } from '../../src/lib/table-types';
import type { PopulateEvent } from '../../src/lib/types';
import { testAccess } from './access-fixture';

test('Companies, People, and Websites each stream five unique Monid fixture rows without OpenAI', async (t) => {
	t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
		const request = new Request(input, options);
		const body = await request.json() as { endpoint: string };
		const output = body.endpoint === '/company/search'
			? { results: Array.from({ length: 5 }, (_, index) => ({ name: `Company ${index}`, domain: `company-${index}.example` })) }
			: body.endpoint === '/people/search'
				? { results: Array.from({ length: 5 }, (_, index) => ({ name: `Person ${index}`, role: { title: 'Founder', company: { name: 'Example Co', domain: 'example.com' } }, location: { country_code: 'US' }, profiles: [`https://www.linkedin.com/in/person-${index}`], schools: [], skills: [] })) }
				: { results: Array.from({ length: 5 }, (_, index) => ({ url: `https://site-${index}.example`, title: `Website ${index}`, description: 'A fixture result' })) };
		return Response.json({ runId: `fixture-${body.endpoint}`, provider: 'context.dev', endpoint: body.endpoint, status: 'COMPLETED', resultCount: 5, output });
	});
	for (const id of ['companies', 'people', 'websites'] as const) {
		const tableType = DEFAULT_TABLE_TYPES.find((definition) => definition.id === id)!;
		const events: PopulateEvent[] = (await new Response(populateStream(testAccess({ keys: { monid: 'fixture-key' } }), {
			query: `five ${tableType.name} fixture records`, entity: id, tableTypeId: id, tableType, target: 5, countries: [],
		})).text()).trim().split('\n').map((line) => JSON.parse(line));
		const rows = events.flatMap((event) => event.type === 'rows' ? event.rows : []);
		assert.equal(rows.length, 5, id);
		assert.equal(new Set(rows.map((row) => row[tableType.identity.sourceField])).size, 5, `${id} identity`);
		assert.equal(events.at(-1)?.type, 'done', id);
	}
});
