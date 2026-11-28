import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { generateText } from 'ai';
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici';
import { BROWSER_POLICY, resolveGrant } from '../../src/lib/server/provider-access';
import { openaiModel } from '../../src/lib/server/openai';

function configure(t: TestContext) {
	const values = { NODE_ENV: 'production', ENRICHABLE_APP_URL: 'https://self-hosted.example', ENRICHABLE_DEV_AUTH: '', ENRICHABLE_PASSWORD: 'app-password', ENRICHABLE_ALLOW_SERVER_KEYS_WITHOUT_PASSWORD: 'false', OPENAI_API_KEY: 'server-test-key', OPENAI_BASE_URL: '' };
	const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
	Object.assign(process.env, values);
	t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

test('browser grants never use deployment OpenAI secrets, even if legacy server settings exist', (t) => {
	configure(t);
	const grant = resolveGrant(BROWSER_POLICY, {
		headers: new Headers(),
		server: { unlocked: true, keys: { openai: 'server-test-key' }, baseUrl: 'https://server.example/v1', trial: true },
	});
	assert.equal(grant.keys.openai, undefined);
	assert.equal(grant.trialAccount, undefined);
	assert.equal(grant.openaiBaseUrl, null);
});

test('request and vault OpenAI keys stay bound to permitted endpoints', () => {
	const requestKey = resolveGrant(BROWSER_POLICY, { headers: new Headers({ 'x-openai-key': 'caller-test-key', 'x-openai-base-url': 'https://caller.example/v1/' }) });
	assert.equal(requestKey.keys.openai, 'caller-test-key');
	assert.equal(requestKey.openaiBaseUrl, 'https://caller.example/v1');
	const vault = { keys: { openai: 'vault-test-key' }, preferences: { openaiBaseUrl: 'https://vault.example/v1' } };
	assert.equal(resolveGrant(BROWSER_POLICY, { headers: new Headers(), vault }).openaiBaseUrl, 'https://vault.example/v1');
	assert.throws(() => resolveGrant(BROWSER_POLICY, { headers: new Headers({ 'x-openai-base-url': 'https://caller.example/v1' }), vault }), /explicit OpenAI key/);
});

test('custom OpenAI inference rejects redirects before reaching internal addresses', async (t) => {
	const previous = getGlobalDispatcher();
	const mock = new MockAgent();
	mock.disableNetConnect();
	setGlobalDispatcher(mock);
	t.after(async () => { setGlobalDispatcher(previous); await mock.close(); });
	mock.get('https://provider.example').intercept({ path: '/v1/chat/completions', method: 'POST' }).reply(307, '', { headers: { location: 'http://127.0.0.1:4444/private' } });
	let internalRequests = 0;
	mock.get('http://127.0.0.1:4444').intercept({ path: '/private', method: 'POST' }).reply(() => { internalRequests++; return { statusCode: 500, data: 'internal service' }; });
	await assert.rejects(generateText({ model: openaiModel('caller-test-key', 'test', 'https://provider.example/v1'), prompt: 'hello', maxRetries: 0 }));
	assert.equal(internalRequests, 0);
});
