import { z } from 'zod';
import { SELF_HOSTED_ISSUER } from '@/lib/auth-identity';
import { NO_STORE_HEADERS, jsonError } from '@/lib/server/credentials';
import { browserAccess } from '@/lib/server/provider-access';
import { organizationPersistenceEnabled } from '@/lib/server/organization-store';
import { localCredentialStatus, updateLocalCredentials } from '@/lib/server/local-credential-store';

const inputSchema = z.object({ providers: z.object({ monid: z.string().max(512).nullable().optional(), openai: z.string().max(512).nullable().optional(), treg: z.string().max(512).nullable().optional() }).refine((value) => Object.keys(value).length > 0, 'Choose a connection to update.') });

export async function GET(request: Request) {
	try {
		const access = await browserAccess(request);
		if (!access.account || access.account.issuer !== SELF_HOSTED_ISSUER || organizationPersistenceEnabled(access.account)) return jsonError('This workspace uses the database credential vault.', 409);
		return Response.json({ providers: await localCredentialStatus(access.account) }, { headers: NO_STORE_HEADERS });
	} catch (error) {
		return jsonError(error instanceof Error ? error.message : 'Could not read saved connections.', 503);
	}
}

export async function POST(request: Request) {
	try {
		const body = inputSchema.safeParse(await request.json());
		if (!body.success) return jsonError(body.error.issues[0]?.message ?? 'Invalid connection update.', 400);
		const access = await browserAccess(request);
		if (!access.account || access.account.issuer !== SELF_HOSTED_ISSUER || organizationPersistenceEnabled(access.account)) return jsonError('This workspace uses the database credential vault.', 409);
		const providers: Partial<Record<'monid' | 'openai' | 'treg', string | null>> = body.data.providers;
		await updateLocalCredentials(access.account, providers);
		return Response.json({ ok: true }, { headers: NO_STORE_HEADERS });
	} catch (error) {
		return jsonError(error instanceof Error ? error.message : 'Could not save this connection.', 503);
	}
}
