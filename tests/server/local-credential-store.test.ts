import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { selfHostedAccount } from '../../src/lib/server/self-hosted';
import { localCredentialVault, updateLocalCredentials } from '../../src/lib/server/local-credential-store';

test('production self-hosted vault persists its generated key; ephemeral hosting requires a configured secret', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'monid-enrich-vault-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const names = ['NODE_ENV', 'VERCEL', 'AWS_LAMBDA_FUNCTION_NAME', 'NETLIFY', 'ENRICHABLE_LOCAL_VAULT_SECRET', 'ENRICHABLE_MCP_ENCRYPTION_SECRET', 'ENRICHABLE_LOCAL_VAULT_DIR'] as const;
	const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
	const actor = selfHostedAccount(`local.${randomBytes(32).toString('base64url')}`)!;
	const apiKey = 'monid_live_example_test_secret';
	Object.assign(process.env, { NODE_ENV: 'production' });
	process.env.VERCEL = '1';
	process.env.ENRICHABLE_LOCAL_VAULT_DIR = directory;
	for (const name of ['ENRICHABLE_LOCAL_VAULT_SECRET', 'ENRICHABLE_MCP_ENCRYPTION_SECRET'] as const) delete process.env[name];
	try {
		await assert.rejects(updateLocalCredentials(actor, { monid: apiKey }), /ephemeral deployment/);
		delete process.env.VERCEL;
		const status = await updateLocalCredentials(actor, { monid: apiKey });
		assert.equal(status.monid.connected, true);
		assert.equal((await localCredentialVault(actor)).keys.monid, apiKey);
		assert.equal((await readFile(join(directory, 'credentials.key'))).length, 32);
		assert.equal((await readFile(join(directory, 'credentials.json'), 'utf8')).includes(apiKey), false);
	} finally {
		for (const name of names) {
			const value = previous[name];
			if (value === undefined) Reflect.deleteProperty(process.env, name); else Reflect.set(process.env, name, value);
		}
	}
});
