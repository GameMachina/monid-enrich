# Operations runbook

This runbook covers first response for a managed deployment. It does not replace a staffed on-call process; an incident owner and customer communication channel still need to be assigned before launch.

## Health and request failures

- `/api/health/live` reports that the Next.js process can answer.
- `/api/health/ready` checks database schema, hosted identity configuration, credential encryption, Stripe billing, and durable worker readiness. A `503` is expected if production setup is incomplete.
- API error responses include an `x-request-id`. Use the hosting logs and request ID to investigate; do not paste customer rows, credentials, tokens, or raw provider responses into public issues.
- Health output intentionally avoids connection strings and provider details. Check Vercel, Neon, Clerk, Stripe, Monid, or Treg operator dashboards as appropriate.

## Database or migration failure

1. Stop promoting the failing deployment. Do not point previews at production to work around it.
2. Check Vercel build logs and Neon project/branch health. Verify that `DATABASE_URL` targets the intended environment and migration role.
3. If the migration failed, inspect its transaction result and schema on staging before retrying. Migrations are intended to be repeatable, but a failed deployment is not proof that production is unchanged.
4. For data loss or corruption, restore to a separate Neon branch/database first. Compare data and record recovery time before changing the production connection.
5. Roll back application code only after confirming the older code can operate against the newer additive schema.

## Enrichment queue stalled

1. Check readiness, the Vercel Cron schedule, the production deployment, and that `CRON_SECRET` is configured for the cron environment.
2. Inspect `enrichable.enrichment_jobs` status and `updated_at` with workspace-safe operator access. Never copy row contents into incident chat.
3. Queued jobs should be picked up by the next worker run. Expired Monid jobs become `uncertain` if a paid request may have started; check Monid usage before any manual retry. Treg runs reuse their stored idempotency key according to the adapter behavior.
4. Do not reset a running lease or mark an uncertain job queued just to clear the dashboard. Reconcile provider status first; this can otherwise cause duplicate charges.
5. Jobs can be cancelled only before their provider request starts. Running work must finish or reach its timeout/error state.

The current worker processes cell jobs only. Find rows is not durable yet. A per-minute Vercel Cron schedule depends on an eligible Vercel plan.

## Provider usage mismatch

1. Use **Configuration → Provider usage** as a workspace admin to filter by provider, run status, time, member, sheet, or run ID. Each receipt carries a provider run/call ID when the upstream response supplied one.
2. Compare app receipt costs with the provider's own billing/usage page. An absent cost means the provider did not report one in the receipt; it does not mean the run was free.
3. Resolve uncertain or mismatched runs with the provider before retrying. Do not combine Monid and Treg totals or treat the app's product subscription as provider funds.
4. New cell runs include attribution IDs after migration `021_provider_usage_attribution.sql`; older receipts are not backfilled.

## Stripe webhook or subscription mismatch

1. Check Stripe's event delivery and the app's `stripe_webhook_events`/workspace subscription state.
2. Confirm the endpoint signing secret matches the environment and the event is for the expected Stripe customer/workspace mapping.
3. Stripe retries non-2xx webhook deliveries. Duplicate event IDs are deduplicated; do not delete receipt rows to force replay.
4. Confirm the current Stripe subscription in Stripe before repairing a local state. Do not change a subscription row from a client report.

## Encryption key exposure or loss

- If a credential or encryption root may be exposed, restrict deployment access and revoke affected upstream keys. Rotate the stable encryption root only with a rehearsed re-encryption procedure.
- If the encryption root is lost, restore the matching secret from the approved secret manager backup. Do not generate a replacement and overwrite the old value; saved provider credentials will no longer decrypt.
- Rotate compromised Clerk, Stripe, database, cron, Monid, Treg, OpenAI, AgentWeb, and MCP credentials at their source. Keep each provider and member/workspace billing record separate.

## Workspace export and closure

Workspace export is bounded to 50 MB and excludes credentials. Workspace closure requires a canceled app subscription and no running provider jobs, then soft-deletes the workspace while retaining provider usage receipts and Stripe reconciliation records; personal AgentWeb credentials are outside the workspace. Do not use this route as a legally complete account-erasure mechanism until backup and third-party retention procedures are defined.

## Security incident

1. Restrict the affected account, key, or deployment first; preserve minimal access logs and request IDs.
2. Revoke exposed credentials with the issuing service. If a Clerk session or membership was compromised, revoke it in Clerk and verify access is gone.
3. Scope affected workspaces and provider operations without exporting unnecessary row contents.
4. Record timeline, impact, containment, and follow-up in a private incident record. Use [GitHub private vulnerability reporting](https://github.com/GameMachina/monid-enrich/security/advisories/new) for security reports.
5. Notify affected customers through the operator's approved communication process; that process still needs to be established before launch.
