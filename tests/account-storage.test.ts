import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountHeaders, accountStorageKey, setStorageAccount } from '../src/lib/account-storage';

test('a verified account switch requires a full reload before storage scope or request headers can change', () => {
	assert.equal(setStorageAccount({ partition: 'org-one', sessionId: 'session-one' }), true);
	assert.equal(accountStorageKey('workspace'), 'workspace.account.org-one');
	assert.deepEqual(accountHeaders(), { 'x-enrichable-account': 'org-one', 'x-enrichable-session': 'session-one' });
	assert.equal(setStorageAccount({ partition: 'org-two', sessionId: 'session-two' }), false);
	assert.equal(accountStorageKey('workspace'), 'workspace.account.org-one');
	assert.deepEqual(accountHeaders(), { 'x-enrichable-account': 'org-one', 'x-enrichable-session': 'session-one' });
});
