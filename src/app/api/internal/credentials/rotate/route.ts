import { timingSafeEqual } from 'node:crypto';
import { rotateCredentialBatch } from '@/lib/server/credential-rotation';
import { withDatabase } from '@/lib/server/database';
import { managedAuthEnabled } from '@/lib/server/deployment';
import { WorkspaceError } from '@/lib/workspace';

export const maxDuration = 60;

function authorized(request: Request) {
	const secret = process.env.CRON_SECRET?.trim();
	const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
	if (!secret || secret.length < 32 || !provided) return false;
	const expectedBuffer = Buffer.from(secret), providedBuffer = Buffer.from(provided);
	return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function POST(request: Request) {
	if (!authorized(request)) return Response.json({ error: 'Unauthorized.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
	if (!managedAuthEnabled()) return Response.json({ error: 'Credential rotation is available only for the managed database vault.' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
	try {
		const result = await withDatabase(rotateCredentialBatch);
		return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
	} catch (error) {
		const status = error instanceof WorkspaceError ? error.status : 503;
		const message = error instanceof WorkspaceError ? error.message : 'Credential rotation could not complete. Check the database logs and retry with both encryption keys configured.';
		return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
	}
}
