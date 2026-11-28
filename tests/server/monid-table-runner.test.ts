import assert from 'node:assert/strict';
import { test } from 'node:test';
import { foundRowKey } from '../../src/lib/found-rows';
import { DEFAULT_TABLE_TYPES, TABLE_TYPE_ADAPTERS, tableTypeInputError, tableTypeRunnableError } from '../../src/lib/table-types';
import { mapMonidTableRows, runMonidTableSearch, validateTableOperationInput } from '../../src/lib/server/monid-table-runner';
import { registeredMonidOperations, type MonidOperationName, type MonidRun } from '../../src/lib/server/monid';
import type { PopulateEvent, PopulateRequest, TableTypeDefinition } from '../../src/lib/types';
import { PopulateRequestSchema } from '../../src/lib/types';
import { testAccess } from './access-fixture';

function type(id: string) {
	const result = DEFAULT_TABLE_TYPES.find((item) => item.id === id);
	assert.ok(result, `missing default table type: ${id}`);
	return result;
}

function request(id: string, options: { query?: string; target?: number; inputs?: Record<string, string> } = {}): PopulateRequest & { tableType: TableTypeDefinition } {
	const definition = type(id);
	return PopulateRequestSchema.parse({
		query: options.query ?? 'sample search query', entity: definition.entity, tableTypeId: definition.id,
		tableType: definition, target: options.target ?? 5, countries: [], inputs: options.inputs ?? {},
	}) as PopulateRequest & { tableType: TableTypeDefinition };
}

function monidRun(output: unknown): MonidRun {
	return { runId: 'test-run', provider: 'fixture', endpoint: 'fixture', status: 'completed', output };
}

test('every published default has a trusted operation, schema, result mapping, and stable row identity', () => {
	const published = DEFAULT_TABLE_TYPES.filter((item) => item.status === 'published');
	assert.ok(published.length >= 20);
	for (const definition of published) {
		assert.equal(tableTypeRunnableError(definition), null, definition.id);
		assert.ok(TABLE_TYPE_ADAPTERS[definition.id], definition.id);
		if (definition.entity === 'records') for (const operation of definition.operations) {
			assert.ok(registeredMonidOperations().includes(operation as MonidOperationName), `${definition.id} operation ${operation} is registered`);
			assert.throws(() => validateTableOperationInput(operation, {}), /Invalid inputs/, `${definition.id} operation ${operation} has a trusted input schema`);
		}
	}
	const drafts = DEFAULT_TABLE_TYPES.filter((item) => item.status === 'draft');
	assert.ok(drafts.length > 0);
	assert.ok(drafts.every((definition) => Boolean(tableTypeRunnableError(definition))));
});

test('operation schemas reject provider arguments outside the inspected contract', () => {
	assert.deepEqual(validateTableOperationInput('table.1688.search', {
		body: { query: 'steel bottles', beginPage: 1, pageSize: 60, language: 'en', currency: 'USD', exactMatch: false },
	}), { body: { query: 'steel bottles', beginPage: 1, pageSize: 60, language: 'en', currency: 'USD', exactMatch: false } });
	assert.throws(() => validateTableOperationInput('table.1688.search', {
		body: { query: 'steel bottles', beginPage: 1, pageSize: 61, language: 'en', currency: 'USD' },
	}), /Invalid inputs/);
	assert.throws(() => validateTableOperationInput('table.1688.search', {
		body: { query: 'steel bottles', beginPage: 1, pageSize: 10, language: 'en', currency: 'USD', endpoint: 'https://example.com' },
	}), /Unrecognized key/);
	assert.throws(() => validateTableOperationInput('unregistered.operation', {}), /no inspected input schema/);
	assert.match(tableTypeInputError(type('mobile-app-search'), { query: 'apps', inputs: { storefront: 'google', country: 'United States' } }) ?? '', /two-letter/);
	assert.match(tableTypeInputError(type('amazon-seller-offers'), { query: 'sellers', inputs: { asin: 'short', marketplace: 'us' } }) ?? '', /10-character Amazon ASIN/);
	assert.match(tableTypeInputError(type('software-reviews'), { query: 'reviews', inputs: { source: 'capterra', 'product-id': '1234' } }) ?? '', /product ID and product name/);
	assert.match(tableTypeInputError(type('import-export-companies'), { query: 'coffee', inputs: { 'trade-direction': 'imports', 'date-start': '2024-02-30', 'date-end': '2024-03-01' } }) ?? '', /valid start and end date/);
	assert.equal(tableTypeInputError(type('hs-code-activity'), { query: 'coffee', inputs: { 'trade-direction': 'imports', 'date-start': '2020-01-01', 'date-end': '2023-01-01' } }), null);
	assert.match(tableTypeInputError(type('hs-code-activity'), { query: 'coffee', inputs: { 'trade-direction': 'imports', 'date-start': '2020-01-01', 'date-end': '2023-01-02' } }) ?? '', /may not exceed three years/);
	assert.throws(() => validateTableOperationInput('table.tendata.importers', { body: { pageNo: 1, pageSize: 101, catalog: 'imports', startDate: '2026-01-01', endDate: '2026-01-02', productDesc: 'coffee' } }), /Invalid inputs/);
});

test('1688 offer mapping uses a stable provider ID and maps the returned offer fields', () => {
	const rows = mapMonidTableRows('1688-wholesale-offers', { offers: [{ offerId: 'offer-42', title: 'Steel bottle', companyName: 'Bottle Factory', moq: 100, price: { formatted: '¥8–¥12' }, landingUrl: 'https://detail.1688.com/offer/42.html' }] });
	assert.equal(rows.length, 1);
	assert.equal(rows[0]?.['Offer ID'], 'offer-42');
	assert.equal(rows[0]?.Title, 'Steel bottle');
	assert.equal(rows[0]?.Supplier, 'Bottle Factory');
	assert.equal(rows[0]?.['Minimum order quantity'], 100);
	assert.equal(rows[0]?.Price, '¥8–¥12');
	assert.equal(rows[0]?.['Product URL'], 'https://detail.1688.com/offer/42.html');
	assert.equal(foundRowKey(rows[0]?.['Offer ID'] as string), foundRowKey('offer-42'));
});

test('1688 offer fallback identity is stable and optional fields map when supplied', () => {
	const offer = { title: 'Steel bottle', companyName: 'Bottle Factory', skuId: 'sku-7', priceRange: '$3-$5', stock: 400, reviewCount: 22, supplierLocation: 'Ningbo', landingUrl: 'https://detail.1688.com/offer/7.html' };
	const [first] = mapMonidTableRows('1688-wholesale-offers', { offers: [offer] });
	const [again] = mapMonidTableRows('1688-wholesale-offers', { offers: [{ ...offer }] });
	assert.equal(first?.['Offer key'], again?.['Offer key']);
	assert.equal(first?.['Review count'], 22);
	assert.equal(first?.['Price range'], '$3-$5');
	assert.equal(first?.Stock, 400);
	assert.equal(first?.['Supplier location'], 'Ningbo');
});

test('Yelp review mapping keeps the Yelp review identity and parent business URL', () => {
	const context = { name: 'Example Cafe', url: 'https://www.yelp.com/biz/example-cafe' };
	const rows = mapMonidTableRows('yelp-reviews', { reviews: [{ id: 'review-12', rating: 5, text: 'Excellent coffee', date: '2026-11-01', author_name: 'Reviewer' }] }, context);
	assert.equal(rows[0]?.['Review ID'], 'review-12');
	assert.equal(rows[0]?.Review, 'Excellent coffee');
	assert.equal(rows[0]?.Business, 'Example Cafe');
	assert.equal(rows[0]?.['Business URL'], context.url);
	assert.equal(foundRowKey(rows[0]?.['Review ID'] as string), foundRowKey('review-12'));
});

test('Yelp Reviews resolves one listing, follows review page tokens, and attaches business provenance', async () => {
	const calls: Array<{ operation: MonidOperationName; input: Record<string, unknown> }> = [];
	const execute = async (_access: Parameters<typeof runMonidTableSearch>[0], operation: MonidOperationName, input: Record<string, unknown>) => {
		calls.push({ operation, input });
		if (operation === 'table.yelp.search') return monidRun({ results: [{ id: 'biz-1', name: 'Example Cafe', url: 'https://www.yelp.com/biz/example-cafe' }] });
		assert.equal(operation, 'table.yelp.reviews');
		const body = input.body as { page_token?: string };
		const start = body.page_token ? 10 : 0;
		const count = body.page_token ? 2 : 10;
		return monidRun({ reviews: Array.from({ length: count }, (_, index) => ({ id: `review-${start + index}`, rating: 5, text: `Review ${start + index}`, date: '2026-11-01', author_name: 'Reviewer' })), ...(body.page_token ? {} : { next_page_token: 'next-page' }) });
	};
	const events: PopulateEvent[] = [];
	await runMonidTableSearch(testAccess({ keys: { monid: 'fixture-key' } }), request('yelp-reviews', { query: 'Example Cafe', target: 12, inputs: { location: 'San Francisco' } }), (event) => { events.push(event); }, new AbortController().signal, execute);
	const rows = events.flatMap((event) => event.type === 'rows' ? event.rows : []);
	assert.deepEqual(calls.map((call) => call.operation), ['table.yelp.search', 'table.yelp.reviews', 'table.yelp.reviews']);
	assert.equal((calls[1]?.input.body as { url: string }).url, 'https://www.yelp.com/biz/example-cafe');
	assert.equal((calls[2]?.input.body as { page_token: string }).page_token, 'next-page');
	assert.equal(rows.length, 12);
	assert.ok(rows.every((row) => row['Business URL'] === 'https://www.yelp.com/biz/example-cafe'));
	const finalEvent = events.at(-1);
	assert.ok(finalEvent?.type === 'done');
	assert.deepEqual(finalEvent, { type: 'done', total: 12, message: 'Added 12 yelp reviews.' });
});

test('1688 pagination deduplicates repeated offers and stays within the requested count', async () => {
	const pages: number[] = [];
	const execute = async (_access: Parameters<typeof runMonidTableSearch>[0], operation: MonidOperationName, input: Record<string, unknown>) => {
		assert.equal(operation, 'table.1688.search');
		const body = input.body as { beginPage: number; pageSize: number };
		pages.push(body.beginPage);
		const offers = body.beginPage === 1 ? [{ offerId: 'offer-1', title: 'One' }, { offerId: 'offer-2', title: 'Two' }]
			: body.beginPage === 2 ? [{ offerId: 'offer-2', title: 'Duplicate' }]
			: [{ offerId: 'offer-3', title: 'Three' }];
		return monidRun({ offers, hasMore: body.beginPage < 3, totalCount: 4 });
	};
	const events: PopulateEvent[] = [];
	await runMonidTableSearch(testAccess({ keys: { monid: 'fixture-key' } }), request('1688-wholesale-offers', { target: 3 }), (event) => { events.push(event); }, new AbortController().signal, execute);
	const rows = events.flatMap((event) => event.type === 'rows' ? event.rows : []);
	assert.deepEqual(pages, [1, 2, 3]);
	assert.deepEqual(rows.map((row) => row['Offer ID']), ['offer-1', 'offer-2', 'offer-3']);
	const finalEvent = events.at(-1);
	assert.ok(finalEvent?.type === 'done');
	assert.equal(finalEvent.total, 3);
});

test('verified catalog mappings preserve source IDs, URLs, and stable fallback identities', () => {
	const [manufacturer] = mapMonidTableRows('suppliers-manufacturers', { results: [{ id: 'm-4', name: 'Parts Co', url: 'https://www.thomasnet.com/company/parts-co-4.html', text: 'Precision parts', address: 'Ohio', employees_count: '25-49' }] });
	assert.equal(manufacturer?.['Manufacturer key'], 'thomasnet:m-4');
	assert.equal(manufacturer?.['Profile URL'], 'https://www.thomasnet.com/company/parts-co-4.html');
	const [trade] = mapMonidTableRows('import-export-companies', { results: [{ importer: 'Coffee Import LLC', country: 'USA', sumOfUSD: '12500', tradeCount: 6 }] }, { tradeRole: 'importer' });
	assert.match(String(trade?.['Company key']), /^tendata:/);
	assert.equal(trade?.['Trade role'], 'Importer');
	assert.equal(trade?.['USD value'], 12500);
	const [code] = mapMonidTableRows('hs-code-activity', { results: [{ hsCode: '090121', descriptionEn: 'Roasted coffee', sumOfUSD: 20000, amountSharePct: 12.5 }] });
	assert.equal(code?.['HS code'], '090121');
	assert.equal(code?.Description, 'Roasted coffee');
	const [creator] = mapMonidTableRows('creator-influencers', { users: [{ user_id: 'tt-9', username: 'coffee.creator', display_name: 'Coffee Creator', follower_count: 1200 }] });
	assert.equal(creator?.['TikTok user ID'], 'tt-9');
	assert.equal(creator?.['Creator URL'], 'https://www.tiktok.com/@coffee.creator');
	const [product] = mapMonidTableRows('amazon-product-search', { organic_results: [{ asin: 'B09B8V1LZ3', title: 'Dock', url: 'https://amazon.com/dp/B09B8V1LZ3', price: '$99', rating: 4.5 }] });
	assert.equal(product?.ASIN, 'B09B8V1LZ3');
	assert.equal(product?.['Product URL'], 'https://amazon.com/dp/B09B8V1LZ3');
	const [seller] = mapMonidTableRows('amazon-seller-offers', { sellers: [{ seller_id: 'seller-2', seller_name: 'Warehouse', price: '$90', is_prime: true }] }, { asin: 'B09B8V1LZ3' });
	assert.equal(seller?.['Offer key'], 'amazon:B09B8V1LZ3:seller-2:');
	assert.equal(seller?.ASIN, 'B09B8V1LZ3');
});

test('Tendata importer runner advances pages, bounds each call, and deduplicates stable company rows', async () => {
	const pages: number[] = [];
	const execute = async (_access: Parameters<typeof runMonidTableSearch>[0], operation: MonidOperationName, input: Record<string, unknown>) => {
		assert.equal(operation, 'table.tendata.importers');
		const body = input.body as { pageNo: number; pageSize: number; catalog: string };
		pages.push(body.pageNo);
		assert.equal(body.catalog, 'imports');
		assert.equal(body.pageSize, body.pageNo === 1 ? 100 : 1);
		return monidRun({ results: body.pageNo === 1 ? Array.from({ length: 100 }, (_, index) => ({ importer: `Importer ${index}`, country: 'USA' })) : [{ importer: 'Another Importer', country: 'USA' }] });
	};
	const events: PopulateEvent[] = [];
	await runMonidTableSearch(testAccess({ keys: { monid: 'fixture-key' } }), request('import-export-companies', { query: 'green coffee', target: 101, inputs: { 'trade-direction': 'imports', 'date-start': '2026-01-01', 'date-end': '2026-03-01' } }), (event) => { events.push(event); }, new AbortController().signal, execute);
	const rows = events.flatMap((event) => event.type === 'rows' ? event.rows : []);
	assert.deepEqual(pages, [1, 2]);
	assert.equal(rows.length, 101);
	assert.equal(rows.at(-1)?.Company, 'Another Importer');
	assert.ok(events.some((event) => event.type === 'status' && event.message.includes('2 Monid calls')));
});

test('Software Reviews resolves a provider product and pages review records with product provenance', async () => {
	const calls: Array<{ operation: MonidOperationName; input: Record<string, unknown> }> = [];
	const execute = async (_access: Parameters<typeof runMonidTableSearch>[0], operation: MonidOperationName, input: Record<string, unknown>) => {
		calls.push({ operation, input });
		if (operation === 'table.g2.search-software') return monidRun({ products: [{ slug: 'project-tool', name: 'Project Tool', url: 'https://www.g2.com/products/project-tool' }] });
		assert.equal(operation, 'table.g2.reviews');
		const page = (input.queryParams as { page: number }).page;
		const count = page === 1 ? 10 : 5;
		return monidRun({ reviews: Array.from({ length: count }, (_, index) => ({ author: `Reviewer ${page}-${index}`, date: '2026-11-01', title: `Review ${page}-${index}`, detailed_feedback: { likes: `Pro ${index}`, dislikes: `Con ${index}` }, rating: 4 })) });
	};
	const events: PopulateEvent[] = [];
	await runMonidTableSearch(testAccess({ keys: { monid: 'fixture-key' } }), request('software-reviews', { query: 'Project Tool reviews', target: 15, inputs: { source: 'g2' } }), (event) => { events.push(event); }, new AbortController().signal, execute);
	const rows = events.flatMap((event) => event.type === 'rows' ? event.rows : []);
	assert.deepEqual(calls.map((call) => call.operation), ['table.g2.search-software', 'table.g2.reviews', 'table.g2.reviews']);
	assert.deepEqual(calls.slice(1).map((call) => (call.input.queryParams as { page: number }).page), [1, 2]);
	assert.equal(rows.length, 15);
	assert.ok(rows.every((row) => row.Product === 'Project Tool' && row['Product slug'] === 'project-tool' && row['Product URL'] === 'https://www.g2.com/products/project-tool'));
	assert.equal(new Set(rows.map((row) => row['Review key'])).size, 15);
});

test('Capterra direct review lookup uses product name and ID without inventing a product URL', async () => {
	const calls: Array<{ operation: MonidOperationName; input: Record<string, unknown> }> = [];
	const execute = async (_access: Parameters<typeof runMonidTableSearch>[0], operation: MonidOperationName, input: Record<string, unknown>) => {
		calls.push({ operation, input });
		return monidRun({ reviews: [{ author: 'A Reviewer', date: '2026-11-01', title: 'Useful tool', review: 'Good workflow', rating: 5 }] });
	};
	const events: PopulateEvent[] = [];
	await runMonidTableSearch(testAccess({ keys: { monid: 'fixture-key' } }), request('software-reviews', { query: 'Asana reviews', target: 1, inputs: { source: 'capterra', 'product-id': '1234', 'product-name': 'Asana Project Management' } }), (event) => { events.push(event); }, new AbortController().signal, execute);
	assert.equal(calls.length, 1);
	assert.equal(calls[0]?.operation, 'table.capterra.reviews');
	assert.deepEqual(calls[0]?.input.queryParams, { product_id: '1234', product_name: 'Asana Project Management', page: 1 });
	const row = events.flatMap((event) => event.type === 'rows' ? event.rows : [])[0];
	assert.equal(row?.Product, 'Asana Project Management');
	assert.equal(row?.['Product URL'], null);
	assert.match(String(row?.['Review key']), /^review:/);
});

test('Amazon seller lookup is single-call and never exceeds its verified US scope', async () => {
	let count = 0;
	const execute = async (_access: Parameters<typeof runMonidTableSearch>[0], operation: MonidOperationName, input: Record<string, unknown>) => {
		count++;
		assert.equal(operation, 'table.amazon.sellers');
		assert.deepEqual(input.body, { asin: 'B09B8V1LZ3', location_name: 'United States', language_name: 'English (United States)' });
		return monidRun({ sellers: [{ seller_id: 'seller-1', seller_name: 'Example', price: '$12' }] });
	};
	const events: PopulateEvent[] = [];
	await runMonidTableSearch(testAccess({ keys: { monid: 'fixture-key' } }), request('amazon-seller-offers', { target: 100, inputs: { asin: 'b09b8v1lz3', marketplace: 'us' } }), (event) => { events.push(event); }, new AbortController().signal, execute);
	assert.equal(count, 1);
	assert.equal(events.flatMap((event) => event.type === 'rows' ? event.rows : []).length, 1);
});

test('each runnable records type returns five uniquely identified rows through the bounded runner', async () => {
	const types = DEFAULT_TABLE_TYPES.filter((definition) => definition.entity === 'records' && definition.status === 'published' && tableTypeRunnableError(definition) === null);
	assert.ok(types.length >= 20);
	const fixtureItems = (id: string) => Array.from({ length: 5 }, (_, index) => ({
		id: `${id}-${index}`, offerId: `${id}-offer-${index}`, product_id: `${id}-product-${index}`, asin: `B0ABCDEF0${index}`,
		trackId: String(100000 + index), place_id: String(200000 + index), objectID: `${id}-org-${index}`,
		name: `${id} record ${index}`, title: `${id} title ${index}`, text: `${id} review ${index}`, review: `${id} review ${index}`,
		url: `https://example.test/${id}/${index}`, profile_url: `https://example.test/${id}/profile/${index}`,
		username: `${id}-user-${index}`, importer: `${id} importer ${index}`, exporter: `${id} exporter ${index}`,
		hsCode: `85414${index}`, rating: 5, date: `2026-11-${String(index + 1).padStart(2, '0')}`,
		author_name: `${id} author ${index}`, reviewer_name: `${id} reviewer ${index}`, seller_id: `${id}-seller-${index}`,
	}));
	const inputValues: Record<string, string> = {
		store: 'allbirds', location: 'Austin, Texas', 'business-url': 'https://www.yelp.com/biz/sample-business',
		'place-id': '12345', coordinates: '30.2672,-97.7431', board: 'stripe', 'investor-domain': 'a16z.com',
		'app-id': '123456789', 'product-slug': 'notion', 'product-id': '1234', 'product-name': 'Notion',
		'date-start': '2026-01-01', 'date-end': '2026-11-01', 'hs-code': '854140',
		'country-origin': 'CHN', 'country-destination': 'USA', asin: 'B09B8V1LZ3',
	};
	for (const definition of types) {
		const inputs: Record<string, string> = {};
		for (const spec of definition.requiredInputs) {
			if (spec.key === 'query' || spec.key === 'countries') continue;
			if (spec.type === 'select') inputs[spec.key] = spec.options?.[0]?.value ?? '';
			else if ((spec.required || ['location', 'business-url', 'place-id', 'app-id', 'product-slug'].includes(spec.key)) && inputValues[spec.key]) inputs[spec.key] = inputValues[spec.key]!;
		}
		const items = fixtureItems(definition.id);
		const output = Object.fromEntries([
			'offers', 'products', 'local_results', 'results', 'reviews', 'search_results', 'jobs', 'agents', 'hits',
			'listings', 'homes', 'companies', 'deals', 'investors', 'funds', 'users', 'items', 'organic_results', 'sellers',
		].map((key) => [key, items]));
		const events: PopulateEvent[] = [];
		await runMonidTableSearch(
			testAccess({ keys: { monid: 'fixture-key' } }),
			request(definition.id, { query: `five ${definition.name} fixture rows`, target: 5, inputs }),
			(event) => { events.push(event); },
			new AbortController().signal,
			async () => monidRun(output),
		);
		const rows = events.flatMap((event) => event.type === 'rows' ? event.rows : []);
		assert.equal(rows.length, 5, definition.id);
		const keys = rows.map((row) => foundRowKey(typeof row[definition.identity.sourceField] === 'string' ? row[definition.identity.sourceField] as string : null));
		assert.ok(keys.every(Boolean), `${definition.id} emits its configured identity`);
		assert.equal(new Set(keys).size, 5, `${definition.id} fixture rows deduplicate independently`);
	}
});
