import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_TABLE_TYPES } from '../../src/lib/table-types';
import { TableTypeStore } from '../../src/lib/server/table-type-store';
import { WorkspaceError } from '../../src/lib/workspace';
import { testDatabase } from '../support/database';

test('local migration seeds the global table-type registry without publishing blocked types', async (t) => {
	const { database } = await testDatabase(t);
	const store = new TableTypeStore(database);
	const all = await store.listAll();
	assert.equal(all.length, DEFAULT_TABLE_TYPES.length);
	const runnable = await store.listRunnablePublished();
	for (const id of ['1688-wholesale-offers', 'yelp-reviews', 'tripadvisor-places', 'mobile-app-search', 'employer-career-jobs', 'funded-companies', 'rental-listings']) {
		assert.ok(runnable.some((definition) => definition.id === id), `${id} should be runnable`);
	}
	assert.ok(!runnable.some((definition) => definition.id === 'startup-jobs'));
	const blocked = all.find((entry) => entry.definition.id === 'startup-jobs');
	assert.ok(blocked);
	assert.equal(blocked.runnable, false);
	assert.match(blocked.readinessError ?? '', /stable job ID or URL/);
	await assert.rejects(store.resolvePublished('startup-jobs', 'records'), { status: 400 });
});

test('table-type admin edits cannot publish unsupported operations or route to unregistered operations', async (t) => {
	const { database } = await testDatabase(t);
	const store = new TableTypeStore(database);
	const startup = DEFAULT_TABLE_TYPES.find((definition) => definition.id === 'startup-jobs')!;
	await assert.rejects(store.update(startup.id, { ...startup, status: 'published' }), (error: unknown) => error instanceof WorkspaceError && error.status === 400 && /cannot be published/.test(error.message));
	await assert.rejects(store.create({ ...startup, id: 'untrusted-operation-draft', operations: ['https://example.invalid/anything'] }), (error: unknown) => error instanceof WorkspaceError && error.status === 400 && /registered Monid/.test(error.message));
	const edited = { ...DEFAULT_TABLE_TYPES.find((definition) => definition.id === '1688-wholesale-offers')!, operations: ['table.yelp.search'], status: 'published' as const };
	await assert.rejects(store.update(edited.id, edited), (error: unknown) => error instanceof WorkspaceError && error.status === 400 && /trusted Monid adapter/.test(error.message));
});
