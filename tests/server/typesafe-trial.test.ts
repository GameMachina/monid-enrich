import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testAccess } from './access-fixture';

test('legacy external-provider hooks cannot issue direct vendor requests', () => {
	const access = testAccess({ keys: { monid: 'monid-key' } });
	assert.throws(() => access.fetch('hunter'), /Direct vendor requests are disabled/);
	assert.throws(() => access.typesafe(), /no longer supported/);
	assert.equal(access.key('hunter'), 'monid-key', 'legacy operation aliases resolve only to Monid credentials');
});
