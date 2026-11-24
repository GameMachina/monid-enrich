import { z } from 'zod';
import { NO_STORE_HEADERS, jsonError } from '@/lib/server/credentials';
import { routeAccess } from '@/lib/server/provider-access';
import { tregConnectionRequest } from '@/lib/server/treg-connections';
import { workspaceAdminResponse } from '@/lib/server/request-admin';

export const maxDuration = 30;
type RouteContext = { params: Promise<{ secretId: string }> };
const idFrom = async (context: RouteContext) => {
	const parsed = z.coerce.number().int().positive().safeParse((await context.params).secretId);
	return parsed.success ? parsed.data : null;
};
const inputSchema = z.object({ value: z.string().trim().min(1).max(12_000) }).strict();

export async function POST(request: Request, context: RouteContext) {
	const denied = await workspaceAdminResponse();
	if (denied) return denied;
	const access = await routeAccess(request);
	if (access instanceof Response) return access;
	const id = await idFrom(context);
	if (!id) return jsonError('Invalid Treg connection ID.', 400);
	const parsed = inputSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return jsonError('Enter the additional provider credential.', 400);
	try {
		await tregConnectionRequest(access.requireKey('treg'), `/connections/${id}/extra-credential`, { method: 'POST', body: JSON.stringify(parsed.data) });
		return Response.json({ connected: true }, { headers: NO_STORE_HEADERS });
	} catch (error) {
		const status = (error as { status?: number }).status ?? 502;
		return jsonError(error instanceof Error ? error.message : 'Treg could not save the additional credential.', status);
	}
}
