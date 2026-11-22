import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS } from '../src/lib/keys';
import { deriveConnections, mcpConfig } from '../src/components/app/providers';

test('connection inventory exposes Monid and optional user configured OpenAI only', () => {
	const connections = deriveConnections({
		settings: DEFAULT_SETTINGS,
		organization: null,
		server: { openai: false, monid: false, monidSaved: true },
		selfHosted: true,
		trialLimited: false,
	});
	assert.equal(connections.monid.state, 'connected');
	assert.equal(connections.openai.state, 'missing');
});

test('MCP config contains the app credential only, never provider keys', () => {
	const config = JSON.parse(mcpConfig('https://local.example/mcp', 'agent-secret', true));
	assert.deepEqual(config.mcpServers.monidEnrich.headers, { Authorization: 'Bearer agent-secret' });
	assert.equal(JSON.stringify(config).includes('monid-secret'), false);
	assert.equal(JSON.stringify(config).includes('openai-secret'), false);
});
