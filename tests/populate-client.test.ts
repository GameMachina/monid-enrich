import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setStorageAccount } from '../src/lib/account-storage';
import { streamPopulate } from '../src/lib/populate-client';

test('resumed Find rows polling carries the active account and session scope', async (t) => {
	setStorageAccount({ partition: 'populate-account', sessionId: 'populate-session' });
	t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
		assert.equal(String(input), '/api/populate/jobs/job-123');
		const headers = new Headers(init?.headers);
		assert.equal(headers.get('x-enrichable-account'), 'populate-account');
		assert.equal(headers.get('x-enrichable-session'), 'populate-session');
		assert.equal(headers.has('x-monid-key'), false, 'job polling does not resend provider credentials');
		return Response.json({ jobId: 'job-123', status: 'succeeded', progress: 'Complete', added: 5, updated: 0 });
	});

	const result = await streamPopulate({ entity: 'companies', query: 'sample companies', target: 5 }, 'sheet-123', () => {}, undefined, { jobId: 'job-123' });
	assert.deepEqual(result, { completed: true, jobId: 'job-123', durable: true });
});
