import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import type { Account } from '../../src/lib/auth-identity';
import { createDatabase } from '../../src/lib/server/database';
import { openEmbeddedDriver } from '../../src/lib/server/embedded-database';
import { MemberSettingsStore } from '../../src/lib/server/member-settings-store';

const account = (id: string, member: string): Account => ({
	issuer: 'https://member-settings-tests.invalid',
	organization: { id, name: 'Workspace' },
	user: { id: member, email: `${member}@example.com`, email_verified: true },
	partition: member === 'alice' ? 'a'.repeat(64) : 'b'.repeat(64),
});

test('member mobile defaults are isolated, revision checked, and restricted by workspace routes', { timeout: 90_000 }, async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'monid-enrich-member-settings-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const opened = await openEmbeddedDriver({ dataDirectory: join(directory, 'database'), migrationsDirectory: resolve('migrations') });
	t.after(() => opened.close());
	const database = createDatabase(opened.driver);
	const store = new MemberSettingsStore(database);
	const alice = account('acme', 'alice');
	const bob = account('acme', 'bob');

	assert.deepEqual((await store.get(alice)).preferences, { defaultPhoneStrategy: 'leadmagic' });
	const saved = await store.patch(alice, { revision: 0, preferences: { defaultPhoneStrategy: 'clay' } });
	assert.equal(saved.revision, 1);
	assert.equal(saved.preferences.defaultPhoneStrategy, 'clay');
	assert.equal((await store.get(bob)).preferences.defaultPhoneStrategy, 'leadmagic');
	await assert.rejects(store.patch(alice, { revision: 0, preferences: { defaultPhoneStrategy: 'leadmagic' } }), /changed in another session/i);

	await database.transaction(async (sql, workspace) => {
		await sql.query('INSERT INTO enrichable.organization_settings (workspace_id) VALUES ($1) ON CONFLICT DO NOTHING', [workspace]);
		await sql.query('UPDATE enrichable.organization_settings SET preferences=$2::jsonb WHERE workspace_id=$1', [workspace, JSON.stringify({ mobilePhoneProviders: ['clay'] })]);
	}, { workspace: alice });
	await assert.rejects(store.patch(alice, { revision: 1, preferences: { defaultPhoneStrategy: 'leadmagic' } }), /provider disabled by the workspace/i);
});
