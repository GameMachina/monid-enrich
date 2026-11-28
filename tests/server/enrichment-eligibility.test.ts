import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { Account } from '../../src/lib/auth-identity';
import { enrichmentEnabled } from '../../src/lib/server/enrichment-config';
import { includedRun, sharedRequest } from '../../src/lib/server/contextdevenrichmentwaterfall';
import { selfHostedAccount } from '../../src/lib/server/self-hosted';
import { serverKeyAvailability } from '../../src/lib/server/provider-access';
import { testAccess } from './access-fixture';

const account: Account = { issuer: 'https://identity.example.com', user: { id: 'user', email: 'user@example.com', email_verified: true }, organization: { id: 'org', name: 'Organization' }, partition: 'test' };

function setEnv(t: TestContext, values: Record<string, string>) {
	const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
	Object.assign(process.env, values);
	t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

test('the retired included-enrichment service stays disabled even if legacy secrets remain configured', async (t) => {
	setEnv(t, { NODE_ENV: 'production', ENRICHMENT_API_KEY: 'legacy-test-secret', ENRICHMENT_API_URL: 'https://gateway.example', DATABASE_URL: 'test' });
	assert.equal(enrichmentEnabled(account), false);
	assert.equal(enrichmentEnabled(), false);
	let calls = 0;
	t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('must not call a legacy enrichment service'); });
	const request = sharedRequest('monid', { name: 'Ada Lovelace', domain: 'example.com', company: '', profileUrl: '' });
	await assert.rejects(includedRun(testAccess({ account }), request), /Connect a Monid API key/);
	const availability = await serverKeyAvailability(new Request('https://enrich.example/api/keys/verify'));
	assert.equal(availability.enrichmentTrial, false);
	assert.equal(calls, 0);
});

test('localhost and standalone accounts also use an explicit Monid key instead of a hosted enrichment trial', async (t) => {
	setEnv(t, { NODE_ENV: 'development', ENRICHABLE_DEV_AUTH: 'true', ENRICHABLE_APP_URL: 'http://localhost:3000', ENRICHMENT_API_KEY: 'legacy-test-secret', ENRICHMENT_API_URL: 'https://gateway.example' });
	const local = selfHostedAccount(`local.${'a'.repeat(43)}`)!;
	assert.equal(enrichmentEnabled(local), false);
	assert.equal(enrichmentEnabled({ ...account, issuer: 'https://dev.enrichable.localhost' }), false);
	setEnv(t, { NODE_ENV: 'production' });
	assert.equal(enrichmentEnabled(local), false);
});
