import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { generateText } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import type { Account } from '../../src/lib/auth-identity';
import { PROVIDERS, type Provider } from '../../src/lib/organization-settings';
import { DEFAULT_MODEL } from '../../src/lib/types';
import { SESSION_COOKIE } from '../../src/lib/server/auth';
import { CONTEXT_CONNECTION_COOKIE } from '../../src/lib/server/context-connection';
import { BROWSER_POLICY, MCP_POLICY, mcpInputs, providerAccess, resolveGrant, serverKeyAvailability, type AccessInputs, type AccessPolicy } from '../../src/lib/server/provider-access';

const alice: Account = { issuer: 'https://identity.example.com', user: { id: 'alice', email: 'alice@example.com', email_verified: true }, organization: { id: 'one', name: 'One' }, partition: 'alice' };
const offered = (source: string) => Object.fromEntries(PROVIDERS.map((provider) => [provider, `${source}-${provider}`]));
type Offering = 'request' | 'vault' | 'connection' | 'server';

/** Every listed source offers a distinct key for every provider; the server is unlocked only when listed. */
const everyKey = (sources: Offering[]): AccessInputs => ({
	account: alice,
	headers: new Headers(sources.includes('request') ? Object.fromEntries(PROVIDERS.map((provider) => [`x-${provider}-key`, `request-${provider}`])) : {}),
	vault: sources.includes('vault') ? { keys: offered('vault'), preferences: {} } : null,
	connection: sources.includes('connection') ? 'connection-context' : null,
	server: { unlocked: sources.includes('server'), keys: offered('server'), trial: false },
});

test('only request and vault credentials are available to browser and MCP callers', () => {
	const table: Array<[string, AccessPolicy, Offering[], (provider: Provider) => string | undefined]> = [
		['browser: request overrides win', BROWSER_POLICY, ['request', 'vault', 'connection', 'server'], (p) => `request-${p}`],
		['browser: vault beats connection and server', BROWSER_POLICY, ['vault', 'connection', 'server'], (p) => `vault-${p}`],
		['browser: retired connection cookie and deployment keys are ignored', BROWSER_POLICY, ['connection', 'server'], () => undefined],
		['browser: deployment keys are not a credential source', BROWSER_POLICY, ['server'], () => undefined],
		['browser: locked server keys are never used', BROWSER_POLICY, [], () => undefined],
		['mcp: request overrides win', MCP_POLICY, ['request', 'vault', 'connection', 'server'], (p) => `request-${p}`],
		['mcp: vault', MCP_POLICY, ['vault', 'connection', 'server'], (p) => `vault-${p}`],
		['mcp: never the connection cookie or server keys', MCP_POLICY, ['connection', 'server'], () => undefined],
	];
	for (const [name, policy, sources, winner] of table) {
		const { keys } = resolveGrant(policy, everyKey(sources));
		assert.deepEqual(Object.fromEntries(PROVIDERS.map((p) => [p, keys[p]])), Object.fromEntries(PROVIDERS.map((p) => [p, winner(p)])), name);
	}
	const withVault = { ...everyKey(['connection', 'server']), vault: { keys: {}, preferences: {} } };
	assert.equal(resolveGrant(BROWSER_POLICY, withVault).keys.monid, undefined, 'a vault with no Monid key does not use retired connection cookies');
});

test('settings precedence per policy: model, classifier, endpoint and decider preference', () => {
	const headers = { 'x-openai-key': 'request-openai', 'x-openai-model': 'request-model', 'x-classifier-model': 'request-classifier', 'x-openai-base-url': 'https://request.example/v1', 'x-prefer-jev': 'false' };
	const vault = { keys: {}, preferences: { model: 'vault-model', classifierModel: 'vault-classifier', openaiBaseUrl: 'https://vault.example/v1', preferJev: true } };
	const server = { unlocked: true, keys: {}, model: 'server-model', baseUrl: 'https://server.example/v1', trial: false };
	const settings = (policy: AccessPolicy, inputs: AccessInputs) => {
		const grant = resolveGrant(policy, inputs);
		return [grant.model, grant.classifierModel, grant.openaiBaseUrl, grant.preferJev];
	};
	const keyOnly = new Headers({ 'x-openai-key': 'request-openai' });
	const table: Array<[string, AccessPolicy, AccessInputs, unknown[]]> = [
		['browser: request', BROWSER_POLICY, { headers: new Headers(headers), vault, server }, ['request-model', 'request-classifier', 'https://request.example/v1', false]],
		['browser: vault', BROWSER_POLICY, { headers: keyOnly, vault, server }, ['vault-model', 'vault-classifier', 'https://vault.example/v1', false]],
		['browser: server settings are ignored', BROWSER_POLICY, { headers: keyOnly, server }, [DEFAULT_MODEL, undefined, null, false]],
		['browser: locked server settings are ignored', BROWSER_POLICY, { headers: keyOnly, server: { ...server, unlocked: false } }, [DEFAULT_MODEL, undefined, null, false]],
		['mcp: request', MCP_POLICY, { headers: new Headers(headers), vault, server }, ['request-model', 'request-classifier', 'https://request.example/v1', false]],
		['mcp: vault', MCP_POLICY, { headers: keyOnly, vault, server }, ['vault-model', 'vault-classifier', 'https://vault.example/v1', false]],
		['mcp: never deployment settings', MCP_POLICY, { headers: keyOnly, server }, [DEFAULT_MODEL, undefined, null, false]],
	];
	for (const [name, policy, inputs, expected] of table) assert.deepEqual(settings(policy, inputs), expected, name);
	assert.equal(resolveGrant(BROWSER_POLICY, { headers: new Headers({ 'x-classifier-model': 'decisions' }) }).classifierModel, undefined, 'the decisions sentinel is not a model');
});

test('a key goes only to its own source endpoint unless the caller supplies the key too', () => {
	const vault = (endpoint = '') => ({ keys: { openai: 'vault-openai' }, preferences: { openaiBaseUrl: endpoint } });
	const server = (baseUrl?: string) => ({ unlocked: true, keys: { openai: 'server-openai' }, baseUrl, trial: false });
	const other = 'https://other.example/v1';
	const table: Array<[string, AccessPolicy, AccessInputs, RegExp | string | null]> = [
		['request key may use the organization endpoint', BROWSER_POLICY, { headers: new Headers({ 'x-openai-key': 'own' }), vault: { keys: {}, preferences: { openaiBaseUrl: other } } }, other],
		['request key may override any endpoint', BROWSER_POLICY, { headers: new Headers({ 'x-openai-key': 'own', 'x-openai-base-url': other }), vault: vault('https://vault.example/v1') }, other],
		['vault key rejects a request endpoint', BROWSER_POLICY, { headers: new Headers({ 'x-openai-base-url': other }), vault: vault() }, /organization provider endpoint/],
		['vault key accepts its own endpoint again', BROWSER_POLICY, { headers: new Headers({ 'x-openai-base-url': 'https://vault.example/v1/' }), vault: vault('https://vault.example/v1') }, 'https://vault.example/v1'],
		['vault key cannot use a deployment endpoint', BROWSER_POLICY, { headers: new Headers(), vault: vault(), server: server('https://server.example/v1') }, null],
		['deployment key cannot override a request endpoint', BROWSER_POLICY, { headers: new Headers({ 'x-openai-base-url': other }), server: server() }, other],
		['deployment key cannot provide an organization endpoint', BROWSER_POLICY, { headers: new Headers(), vault: { keys: {}, preferences: { openaiBaseUrl: other } }, server: server() }, other],
		['deployment endpoint is not used without a request or vault key', BROWSER_POLICY, { headers: new Headers(), server: server('https://server.example/v1') }, null],
		['mcp vault key rejects a request endpoint', MCP_POLICY, { headers: new Headers({ 'x-openai-base-url': other }), vault: vault() }, /explicit OpenAI key/],
		['private literals are refused for any key', MCP_POLICY, { headers: new Headers({ 'x-openai-key': 'own', 'x-openai-base-url': 'http://10.0.0.1/v1' }) }, /public http\(s\) URL/],
	];
	for (const [name, policy, inputs, expected] of table) {
		if (expected instanceof RegExp) assert.throws(() => resolveGrant(policy, inputs), expected, name);
		else assert.equal(resolveGrant(policy, inputs).openaiBaseUrl, expected, name);
	}
});

test('browser and MCP never activate hosted OpenAI or TypeSafe trials', () => {
	const server = { unlocked: true, keys: { openai: 'server-openai', typesafe: 'server-typesafe' }, trial: true, typesafeTrial: true };
	for (const policy of [BROWSER_POLICY, MCP_POLICY]) {
		const grant = resolveGrant(policy, { account: alice, headers: new Headers(), server });
		assert.equal(grant.keys.openai, undefined);
		assert.equal(grant.keys.typesafe, undefined);
		assert.equal(grant.trialAccount, undefined);
		assert.equal(grant.typesafeTrialAccount, undefined);
	}
});

test('the MCP policy never reads browser cookies, deployment keys or the trial, even when they were gathered', async () => {
	const everything: AccessInputs = { account: alice, headers: new Headers(), connection: 'browser-context', server: { unlocked: true, keys: offered('server'), model: 'server-model', baseUrl: 'https://server.example/v1', trial: true } };
	const grant = resolveGrant(MCP_POLICY, everything);
	assert.deepEqual(grant.keys, {});
	assert.deepEqual([grant.trialAccount, grant.model, grant.openaiBaseUrl], [undefined, DEFAULT_MODEL, null]);
	const gathered = await mcpInputs(new Headers({ cookie: `${SESSION_COOKIE}=forged; ${CONTEXT_CONNECTION_COOKIE}=browser-credential`, 'x-enrichable-password': 'deployment-password' }), alice);
	assert.deepEqual(Object.keys(gathered).sort(), ['account', 'headers', 'vault'], 'the MCP gatherer collects no cookie or server state');
	assert.equal(gathered.account, alice);
});

test('MCP rejects malformed overrides that the browser policy ignores', () => {
	const malformed: Array<Record<string, string>> = [{ 'x-openai-model': 'not a model!' }, { 'x-classifier-model': 'x'.repeat(101) }, { 'x-monid-key': 'k'.repeat(600) }];
	for (const headers of malformed) {
		assert.throws(() => resolveGrant(MCP_POLICY, { headers: new Headers(headers) }), /Invalid provider credential headers/);
		const grant = resolveGrant(BROWSER_POLICY, { headers: new Headers(headers) });
		assert.deepEqual([grant.model, grant.classifierModel, grant.keys.monid], [DEFAULT_MODEL, undefined, undefined]);
	}
});

test('redaction covers every provider in the list', () => {
	const secret = (provider: Provider) => `secret-${provider}-credential`;
	for (const provider of PROVIDERS) {
		const access = providerAccess(resolveGrant(BROWSER_POLICY, { headers: new Headers({ [`x-${provider}-key`]: secret(provider) }) }));
		assert.equal(access.key(provider), secret(provider));
		const message = access.redact({ status: 401, message: `Rejected ${secret(provider)}` });
		assert.ok(!message.includes(secret(provider)), provider);
		assert.match(message, /\[redacted\]/);
	}
	const all = providerAccess({ keys: Object.fromEntries(PROVIDERS.map((provider) => [provider, secret(provider)])) });
	const echoed = all.redact(new Error(PROVIDERS.map(secret).join(' ')));
	assert.ok(PROVIDERS.every((provider) => !echoed.includes(secret(provider))));
});

test('availability does not report deployment keys as connected workspace credentials', async (t) => {
	const env: Record<Provider, string> = { openai: 'OPENAI_API_KEY', monid: 'MONID_API_KEY' };
	setEnv(t, { ENRICHABLE_PASSWORD: '', ENRICHABLE_ALLOW_SERVER_KEYS_WITHOUT_PASSWORD: 'true', ENRICHABLE_OPENAI_TRIAL_ENABLED: 'false', ...Object.fromEntries(PROVIDERS.map((provider) => [env[provider], `server-${provider}`])) });
	const request = () => new Request('http://localhost/api/keys/verify', { headers: { 'x-monid-key': 'request-only' } });
	const open = await serverKeyAvailability(request());
	assert.deepEqual(PROVIDERS.filter((provider) => !open[provider]), PROVIDERS);
	assert.equal(open.monidSaved, false);
	assert.equal(open.openaiSaved, false);
	assert.ok(!JSON.stringify(open).includes('server-'), 'availability never echoes a key');
	process.env.ENRICHABLE_ALLOW_SERVER_KEYS_WITHOUT_PASSWORD = 'false';
	const locked = await serverKeyAvailability(request());
	assert.deepEqual(PROVIDERS.filter((provider) => !locked[provider]), PROVIDERS, 'deployment and request keys never count as saved workspace availability');
});

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

test('the OpenAI endpoint guard runs inside every model call and cannot be skipped', async (t) => {
	setEnv(t, { NODE_ENV: 'production', ENRICHABLE_ALLOW_LOCAL_BASE_URL: '' });
	let calls = 0, lookups = 0;
	const model = () => new MockLanguageModelV4({ doGenerate: async () => { calls++; return { content: [{ type: 'text', text: 'ok' }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] }; } });
	const at = (openaiBaseUrl: string, address: string) => providerAccess({ keys: { openai: 'test-key' }, openaiBaseUrl }, { openai: model, lookup: async () => { lookups++; return [{ address }]; } });
	const rebound = at('https://rebind.example/v1', '10.0.0.5');
	await assert.rejects(generateText({ model: rebound.openai(), prompt: 'hi', maxRetries: 0 }), /public host/, 'a public name resolving to a private address');
	await assert.rejects(rebound.openaiEndpoint(), /public host/);
	await assert.rejects(generateText({ model: at('http://169.254.169.254/latest', '169.254.169.254').openai(), prompt: 'hi', maxRetries: 0 }), /public http\(s\) URL/, 'a grant built without the resolver');
	assert.equal(calls, 0, 'no request reaches an unsafe endpoint, even through an in-memory model');
	const safe = at('https://models.example/v1', '203.0.113.10');
	lookups = 0;
	await generateText({ model: safe.openai(), prompt: 'one', maxRetries: 0 });
	await generateText({ model: safe.openai('other-model'), prompt: 'two', maxRetries: 0 });
	assert.equal(await safe.openaiEndpoint(), 'https://models.example/v1');
	assert.deepEqual([calls, lookups], [2, 1], 'the guard is checked once per access');
});

function setEnv(t: TestContext, values: Record<string, string>) {
	const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
	Object.assign(process.env, values);
	t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}
