import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import type { Account } from '../../src/lib/auth-identity';
import { closeEmbeddedWorkspaceDatabase, createDatabase, withDatabase } from '../../src/lib/server/database';
import { openEmbeddedDriver } from '../../src/lib/server/embedded-database';
import { WorkspaceStore } from '../../src/lib/server/workspace-store';

const actor: Account = { issuer: 'https://local-db-tests.invalid', organization: { id: 'local', name: 'Local workspace' }, user: { id: 'alice', email: 'alice@example.com', email_verified: true }, partition: 'alice' };

test('embedded workspace database initializes migrations and persists sheets across restarts', { timeout: 90_000 }, async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'monid-enrich-db-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const previousPath = process.env.ENRICHABLE_LOCAL_DATABASE_PATH, previousUrl = process.env.DATABASE_URL;
	process.env.ENRICHABLE_LOCAL_DATABASE_PATH = join(directory, 'database');
	process.env.DATABASE_URL = '';
	try {
		const sheet = { id: 'local-sheet', name: 'Local sheet', columns: [], filters: [], sort: null, createdAt: 1, updatedAt: 1 };
		await withDatabase((database) => new WorkspaceStore(database).create(actor, { sheet, rows: [] }));
		await closeEmbeddedWorkspaceDatabase();
		const opened = await openEmbeddedDriver({ dataDirectory: join(directory, 'database'), migrationsDirectory: resolve('migrations') });
		try {
			assert.deepEqual((await new WorkspaceStore(createDatabase(opened.driver)).list(actor)).map(({ sheet }) => sheet.id), ['local-sheet']);
		} finally { await opened.close(); }
	} finally {
		await closeEmbeddedWorkspaceDatabase();
		if (previousPath === undefined) delete process.env.ENRICHABLE_LOCAL_DATABASE_PATH; else process.env.ENRICHABLE_LOCAL_DATABASE_PATH = previousPath;
		if (previousUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousUrl;
	}
});
