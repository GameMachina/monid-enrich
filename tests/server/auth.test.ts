import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { readSession, SESSION_COOKIE } from '../../src/lib/server/auth';
import { SELF_HOSTED_ISSUER } from '../../src/lib/auth-identity';
import { GET as start } from '../../src/app/api/auth/start/route';
import { GET as callback } from '../../src/app/api/auth/callback/route';
import { proxy } from '../../src/proxy';

delete process.env.ENRICHABLE_DEV_AUTH;
const localToken = `local.${'w'.repeat(43)}`;

test('standalone workspaces use an opaque local session token', () => {
	const account = readSession(localToken);
	assert.ok(account);
	assert.equal(account.issuer, SELF_HOSTED_ISSUER);
	assert.equal(account.user.email_verified, true);
	assert.notEqual(account.user.id, localToken);
	assert.equal(readSession('local.short'), null);
	assert.equal(readSession(undefined), null);
});

test('upstream OAuth routes are disabled and make no network request', async (t) => {
	const request = t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected external request'); });
	assert.equal(start().status, 404);
	assert.equal(callback().status, 404);
	assert.equal(request.mock.callCount(), 0);
});

test('workspace APIs require the matching local session and same-origin writes', async () => {
	const account = readSession(localToken)!;
	const base = { cookie: `${SESSION_COOKIE}=${localToken}`, 'x-enrichable-account': account.partition, 'x-enrichable-session': account.sessionId, origin: 'https://local.example' };
	assert.equal((await proxy(new NextRequest('https://local.example/api/enrich'))).status, 401);
	assert.equal((await proxy(new NextRequest('https://local.example/api/enrich', { method: 'POST', headers: { ...base, 'x-enrichable-account': 'another-workspace' } }))).status, 409);
	assert.equal((await proxy(new NextRequest('https://local.example/api/enrich', { method: 'POST', headers: { ...base, 'x-enrichable-session': 'another-session' } }))).status, 409);
	assert.equal((await proxy(new NextRequest('https://local.example/api/enrich', { method: 'POST', headers: { ...base, origin: 'https://attacker.example' } }))).status, 403);
	assert.equal((await proxy(new NextRequest('https://local.example/api/enrich', { method: 'POST', headers: base }))).status, 200);
});

test('the app initializes a local workspace on first open', () => {
	const response = proxy(new NextRequest('https://local.example/app'));
	assert.equal(response.status, 307);
	assert.match(response.headers.get('set-cookie') ?? '', /enrichable\.session=local\./);
});
