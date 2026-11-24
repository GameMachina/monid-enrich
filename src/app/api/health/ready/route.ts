import { withDatabase } from '@/lib/server/database';
import { authMode, durableEnrichmentEnabled, durableWorkerConfigured, managedAuthEnabled } from '@/lib/server/deployment';
import { stripeConfigured } from '@/lib/server/stripe-billing';

export async function GET() {
	const production = process.env.NODE_ENV === 'production';
	const checks = { database: false, credentialEncryption: false, identity: false, billing: true, durableJobs: true };
	try {
		if (production && !process.env.DATABASE_URL?.trim()) throw new Error('Postgres is required in production.');
		const result = await withDatabase((database) => database.read("SELECT to_regclass('enrichable.workspaces') AS workspaces, to_regclass('enrichable.enrichment_jobs') AS enrichment_jobs"));
		checks.database = Boolean(result.rows[0]?.workspaces);
		if (durableEnrichmentEnabled()) checks.durableJobs = Boolean(result.rows[0]?.enrichment_jobs) && durableWorkerConfigured();
	} catch { checks.database = false; }
	checks.credentialEncryption = !production || !managedAuthEnabled() || Boolean(process.env.ENRICHABLE_MCP_ENCRYPTION_SECRET && process.env.ENRICHABLE_MCP_ENCRYPTION_SECRET.length >= 32);
	try {
		const mode = authMode();
		checks.identity = mode !== 'unconfigured' && (mode !== 'clerk' || Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY));
	} catch { checks.identity = false; }
	if (production && managedAuthEnabled()) checks.billing = stripeConfigured() && process.env.ENRICHABLE_BILLING_REQUIRED === 'true';
	if (production && managedAuthEnabled()) checks.durableJobs = checks.durableJobs && durableEnrichmentEnabled() && durableWorkerConfigured();
	const ready = Object.values(checks).every(Boolean);
	return Response.json({ status: ready ? 'ready' : 'not_ready', checks }, { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
