import { withDatabase } from '@/lib/server/database';
import { authMode, durableEnrichmentEnabled, durableWorkerConfigured, managedAuthEnabled } from '@/lib/server/deployment';
import { stripeConfigured } from '@/lib/server/stripe-billing';

export async function GET() {
	const production = process.env.NODE_ENV === 'production';
	const checks = { database: false, credentialEncryption: false, identity: false, clerkWebhook: true, clerkWebhookSchema: false, billing: true, durableJobs: true, providerUsageAttribution: false, workspaceAudit: false };
	try {
		if (production && !process.env.DATABASE_URL?.trim()) throw new Error('Postgres is required in production.');
		const result = await withDatabase((database) => database.read(`SELECT to_regclass('enrichable.workspaces') AS workspaces, to_regclass('enrichable.enrichment_jobs') AS enrichment_jobs, to_regclass('enrichable.populate_jobs') AS populate_jobs, to_regclass('enrichable.durable_worker_slots') AS durable_worker_slots, (SELECT count(*)::int FROM enrichable.durable_worker_slots) AS worker_slot_count, to_regclass('enrichable.workspace_audit_events') AS workspace_audit_events, to_regclass('enrichable.clerk_webhook_events') AS clerk_webhook_events,
			EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='enrichable' AND table_name='monid_runs' AND column_name='actor_id') AS monid_usage_attribution,
			EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='enrichable' AND table_name='treg_runs' AND column_name='actor_id') AS treg_usage_attribution`));
		checks.database = Boolean(result.rows[0]?.workspaces);
		if (durableEnrichmentEnabled()) checks.durableJobs = Boolean(result.rows[0]?.enrichment_jobs && result.rows[0]?.populate_jobs && result.rows[0]?.durable_worker_slots && Number(result.rows[0]?.worker_slot_count) === 20) && durableWorkerConfigured();
		checks.providerUsageAttribution = Boolean(result.rows[0]?.monid_usage_attribution && result.rows[0]?.treg_usage_attribution);
		checks.workspaceAudit = Boolean(result.rows[0]?.workspace_audit_events);
		checks.clerkWebhookSchema = Boolean(result.rows[0]?.clerk_webhook_events);
	} catch { checks.database = false; }
	checks.credentialEncryption = !production || !managedAuthEnabled() || Boolean(process.env.ENRICHABLE_MCP_ENCRYPTION_SECRET && process.env.ENRICHABLE_MCP_ENCRYPTION_SECRET.length >= 32);
	checks.clerkWebhook = !production || !managedAuthEnabled() || Boolean(process.env.CLERK_WEBHOOK_SIGNING_SECRET?.startsWith('whsec_'));
	try {
		const mode = authMode();
		checks.identity = mode !== 'unconfigured' && (mode !== 'clerk' || Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY));
	} catch { checks.identity = false; }
	if (production && managedAuthEnabled()) checks.billing = stripeConfigured() && process.env.ENRICHABLE_BILLING_REQUIRED === 'true';
	if (production && managedAuthEnabled()) checks.durableJobs = checks.durableJobs && durableEnrichmentEnabled() && durableWorkerConfigured();
	const ready = Object.values(checks).every(Boolean);
	return Response.json({ status: ready ? 'ready' : 'not_ready', checks }, { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
