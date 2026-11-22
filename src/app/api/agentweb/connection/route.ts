import { z } from 'zod';
import { apiRoute, readJson } from '@/lib/server/api-route';
import { AgentWebConnectionStore, agentWebUsage } from '@/lib/server/agentweb';
import { parseInput, WorkspaceError } from '@/lib/workspace';

export const GET = apiRoute('agentweb.connection.read', async ({ account, database }) => {
	const store = new AgentWebConnectionStore(database);
	const info = await store.info(account);
	if (!info) return { connected: false };
	try {
		return { ...info, ...(await agentWebUsage((await store.secret(account))!)) };
	} catch (error) {
		if (error instanceof WorkspaceError && error.status === 401) return { ...info, needsReconnection: true, usageError: error.message };
		return { ...info, usageError: error instanceof WorkspaceError ? error.message : 'Could not check AgentWeb usage.' };
	}
});

export const POST = apiRoute('agentweb.connection.save', async ({ account, database, request }) => {
	const { apiKey } = parseInput(z.object({ apiKey: z.string().trim().min(1).max(512) }), await readJson(request));
	const usage = await agentWebUsage(apiKey);
	const store = new AgentWebConnectionStore(database);
	await store.save(account, apiKey);
	const info = await store.info(account);
	return { ...info, ...usage };
});

export const DELETE = apiRoute('agentweb.connection.disconnect', async ({ account, database }) => {
	await new AgentWebConnectionStore(database).disconnect(account);
	return { connected: false };
});
