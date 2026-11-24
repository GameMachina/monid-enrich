import { z } from 'zod';
import { NO_STORE_HEADERS, jsonError } from '@/lib/server/credentials';
import { routeAccess } from '@/lib/server/provider-access';
import { tregConnectionRequest } from '@/lib/server/treg-connections';
import { workspaceAdminResponse } from '@/lib/server/request-admin';

export const maxDuration = 30;
type RouteContext = { params: Promise<{ secretId: string }> };
const idFrom = async (context: RouteContext) => {
	const raw = (await context.params).secretId;
	const parsed = z.coerce.number().int().positive().safeParse(raw);
	return parsed.success ? parsed.data : null;
};

export async function DELETE(request: Request, context: RouteContext) {
	const denied = await workspaceAdminResponse();
	if (denied) return denied;
	const access = await routeAccess(request);
	if (access instanceof Response) return access;
	const id = await idFrom(context);
	if (!id) return jsonError('Invalid Treg connection ID.', 400);
	try {
		await tregConnectionRequest(access.requireKey('treg'), `/connections/${id}`, { method: 'DELETE' });
		return Response.json({ disconnected: true }, { headers: NO_STORE_HEADERS });
	} catch (error) {
		const status = (error as { status?: number }).status ?? 502;
		return jsonError(error instanceof Error ? error.message : 'Could not disconnect this Treg account.', status);
	}
}

const renameInput = z.object({ name: z.string().trim().min(1).max(100) }).strict();
export async function PATCH(request: Request, context: RouteContext) {
	const denied = await workspaceAdminResponse();
	if (denied) return denied;
	const access = await routeAccess(request);
	if (access instanceof Response) return access;
	const id = await idFrom(context);
	if (!id) return jsonError('Invalid Treg connection ID.', 400);
	const parsed = renameInput.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return jsonError('Enter a connection name.', 400);
	try {
		await tregConnectionRequest(access.requireKey('treg'), `/connections/${id}`, { method: 'PATCH', body: JSON.stringify(parsed.data) });
		return Response.json({ renamed: true }, { headers: NO_STORE_HEADERS });
	} catch (error) {
		const status = (error as { status?: number }).status ?? 502;
		return jsonError(error instanceof Error ? error.message : 'Could not rename this Treg connection.', status);
	}
}
