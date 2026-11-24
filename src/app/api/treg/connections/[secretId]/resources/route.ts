import { z } from 'zod';
import { NO_STORE_HEADERS, jsonError } from '@/lib/server/credentials';
import { routeAccess } from '@/lib/server/provider-access';
import { normalizeTregResources, tregConnectionRequest } from '@/lib/server/treg-connections';
import { workspaceAdminResponse } from '@/lib/server/request-admin';

export const maxDuration = 30;
type RouteContext = { params: Promise<{ secretId: string }> };
const idFrom = async (context: RouteContext) => {
	const parsed = z.coerce.number().int().positive().safeParse((await context.params).secretId);
	return parsed.success ? parsed.data : null;
};

export async function GET(request: Request, context: RouteContext) {
	const access = await routeAccess(request);
	if (access instanceof Response) return access;
	const id = await idFrom(context);
	if (!id) return jsonError('Invalid Treg connection ID.', 400);
	try {
		const value = await tregConnectionRequest(access.requireKey('treg'), `/connections/${id}/resources`);
		return Response.json({ resources: normalizeTregResources(value) }, { headers: NO_STORE_HEADERS });
	} catch (error) {
		const status = (error as { status?: number }).status ?? 502;
		return jsonError(error instanceof Error ? error.message : 'Could not load Treg account resources.', status);
	}
}

const resourceInput = z.object({ resource_ref: z.string().trim().min(1).max(1000), resource_name: z.string().trim().max(250).optional() }).strict();
export async function POST(request: Request, context: RouteContext) {
	const denied = await workspaceAdminResponse();
	if (denied) return denied;
	const access = await routeAccess(request);
	if (access instanceof Response) return access;
	const id = await idFrom(context);
	if (!id) return jsonError('Invalid Treg connection ID.', 400);
	const parsed = resourceInput.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return jsonError('Choose an account resource.', 400);
	try {
		await tregConnectionRequest(access.requireKey('treg'), `/connections/${id}/resource`, { method: 'POST', body: JSON.stringify(parsed.data) });
		return Response.json({ saved: true }, { headers: NO_STORE_HEADERS });
	} catch (error) {
		const status = (error as { status?: number }).status ?? 502;
		return jsonError(error instanceof Error ? error.message : 'Could not select the Treg account resource.', status);
	}
}
