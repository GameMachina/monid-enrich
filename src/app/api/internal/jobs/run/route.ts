import { timingSafeEqual } from 'node:crypto';
import { processEnrichmentJobs } from '@/lib/server/enrichment-jobs';
import { durableEnrichmentEnabled } from '@/lib/server/deployment';

export const maxDuration = 300;

function authorized(request: Request) {
	const secret = process.env.CRON_SECRET;
	const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
	if (!secret || !provided) return false;
	const expectedBuffer = Buffer.from(secret), providedBuffer = Buffer.from(provided);
	return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function GET(request: Request) {
	if (!authorized(request)) return Response.json({ error: 'Unauthorized.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
	if (!durableEnrichmentEnabled()) return Response.json({ ok: true, processed: false, disabled: true }, { headers: { 'Cache-Control': 'no-store' } });
	try {
		const processed = await processEnrichmentJobs();
		return Response.json({ ok: true, processed }, { headers: { 'Cache-Control': 'no-store' } });
	} catch {
		return Response.json({ error: 'The enrichment worker could not claim a job.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
	}
}
