# Production setup

This guide prepares a managed Monid Enrich deployment on Vercel. It does not deploy the app or create accounts for you. Run this once on an isolated staging project first. Keep self-hosted mode for a single operator or private instance; it is not the customer SaaS mode.

## Current deployment state

Audited 2026-11-27: the `monid-enrich` Vercel project is linked to `GameMachina/monid-enrich`. The protected Preview deployment for commit `da38087` is ready at `https://monid-enrich-e6cwmct5g-jalens-projects-5f6738d0.vercel.app`. Its build and full migration replay succeeded against the isolated, schema-only Neon `vercel-preview` branch. Preview uses self-hosted single-operator auth behind Vercel SSO and a preview-only encryption secret. Realtime, billing enforcement, and durable enrichment are disabled in this preview. The verified Vercel domain `https://monid-enrich.vercel.app` is attached to the project. No production deployment has been promoted or created.

Neon Postgres and Realtime are provisioned on the `production` branch and migrations have been applied. The branch's Realtime allowlist contains `http://localhost:3000` and `https://monid-enrich.vercel.app`. Vercel's Production environment has the production database URLs, Realtime endpoint and secret, stable vault encryption root, cron secret, app URL, and Realtime enable flag. Secret values are stored as sensitive Vercel variables. Customer identity and subscription billing remain unconfigured, so no customer-facing production deployment is ready.

The worker is scheduled every minute in `vercel.json`. Vercel Pro or Enterprise supports the required schedule; verify the deployed cron after launch. [Vercel’s Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) document the schedule constraints.

The production build command runs `check:production-config` before migrations. It rejects a production deploy unless live Clerk and Stripe credentials, a live Stripe Price, the stable app URL, Neon, the vault key, and durable worker settings are present. Preview builds skip this production-only gate. This prevents an incomplete deployment from being promoted while account setup is pending.

Clerk and Stripe are not configured, and customer-mode auth/billing are not enabled. Production intentionally has no `ENRICHABLE_AUTH_MODE`, Clerk keys, Stripe keys/price, billing enforcement flag, or durable-worker flag yet. Configure separate staging accounts first, add the required Clerk and Stripe settings, and run the staging verification below. The preview is for internal review, not customer use.

## Required services and settings

Use separate Clerk, Neon, Stripe, and Vercel environments for staging and production. Never attach a preview deployment to production customer data.

| Service | Configure | Notes |
| --- | --- | --- |
| Vercel | Node.js 22.23.4; project variables listed below | `vercel.json` checks production configuration, runs migrations, then builds and schedules `/api/internal/jobs/run` once a minute. This worker schedule requires Vercel Pro or Enterprise; Hobby supports only daily Cron schedules. See [Vercel Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing). |
| Neon/Postgres | Pooled `DATABASE_URL` for runtime; migration access available during build | Keep production, staging, and preview on separate branches/databases. Apply and review migrations on staging first. |
| Clerk | Publishable and secret keys; enable Organizations and configure sign-in/up | The Team screen uses Clerk's organization management UI. Verify invite, role, removal, recovery, and session behavior with test users. |
| Stripe | Secret key, webhook signing secret, one recurring Price ID, public app URL | Start in test mode. Configure the customer portal and the webhook events below. App subscriptions are separate from Monid wallet usage. |
| Vercel Cron | `CRON_SECRET` | Use a high-entropy secret of at least 32 characters. Vercel sends it as a bearer token to the worker route. |

Set these project variables in each relevant Vercel environment. `.env.example` is the local template; never commit actual values.

```text
ENRICHABLE_AUTH_MODE=clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_…
CLERK_SECRET_KEY=sk_…
CLERK_WEBHOOK_SIGNING_SECRET=whsec_…
DATABASE_URL=postgresql://…
ENRICHABLE_MCP_ENCRYPTION_SECRET=<stable random secret, 32+ characters>
# ENRICHABLE_MCP_ENCRYPTION_PREVIOUS_SECRET=<old root, only during rotation>
ENRICHABLE_APP_URL=https://your-production-host
ENRICHABLE_BILLING_REQUIRED=true
STRIPE_SECRET_KEY=sk_…
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_PRICE_ID=price_…
ENRICHABLE_DURABLE_ENRICHMENT=true
CRON_SECRET=<stable random secret, 32+ characters>
```

The Clerk publishable key is intentionally browser-visible; the Clerk secret, Stripe keys, cron secret, database URL, and encryption roots are server-only. Use distinct random secrets per environment. Migrations `025_credential_key_versions.sql` and `026_provider_billing_audit.sql` add key-version tracking and current audit actions. To rotate the managed vault root, first deploy this dual-key-capable code while keeping the current secret unchanged. Then set the new root as `ENRICHABLE_MCP_ENCRYPTION_SECRET` and the old root as `ENRICHABLE_MCP_ENCRYPTION_PREVIOUS_SECRET`, redeploy, and repeatedly call `POST /api/internal/credentials/rotate` with `Authorization: Bearer $CRON_SECRET` until every `remaining` count is zero. Allow the new deployment to fully replace all old instances, verify provider and MCP connections, then remove the previous secret and redeploy. Never overwrite the old root before the new code and previous-key setting are active.

Do not put a platform Monid key into the deployment environment for customer use. Workspace admins connect the workspace Monid API key in Configuration; OpenAI remains optional and user-configured. The app uses Clerk Organizations for workspace tenancy, but does not implement Monid OAuth or multi-tenant OAuth for connected data providers.

## Clerk setup

1. Create a dedicated Clerk application for staging and another for production.
2. Enable Organizations and configure organization membership roles. Set invitation, verification, password recovery, and session policies for the target users.
3. Add the exact production and staging origins to the Clerk application. Configure sign-in at `/sign-in` and sign-up at `/sign-up`.
4. Create a Clerk webhook endpoint at `https://your-host/api/clerk/webhook`. Subscribe to `organization_membership.created`, `organization_membership.updated`, `organization_membership.deleted`, `organization_invitation.created`, `organization_invitation.accepted`, and `organization_invitation.revoked`. Save the endpoint signing secret as `CLERK_WEBHOOK_SIGNING_SECRET` in that Vercel environment.
5. Set the environment-specific Clerk keys and webhook signing secret in Vercel. Confirm the Team page can create/select an organization and manage test members.
6. Test that a removed member loses access to existing tabs and every API route, that invitation and role events appear in **Configuration → Workspace activity**, and that a personal workspace cannot see an organization workspace.

## Stripe setup

1. In Stripe test mode, create the first recurring product/price and customer portal configuration.
2. Add a webhook endpoint at `https://your-host/api/stripe/webhook` and subscribe to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`.
3. Set the test secret, endpoint signing secret, price ID, and `ENRICHABLE_APP_URL` in the staging Vercel environment.
4. Verify checkout, portal return, cancellation, failed payment, webhook retries, and access after each subscription-state change.
5. Repeat with production Stripe objects only after staging passes. Never reuse test keys or test database records in production.

The current implementation supports one configured recurring price. It does not yet model multiple plans, usage tiers, tax policy, invoice workflows, or self-serve plan changes. Keep those as explicit product work before offering them.

## Database, migrations, and previews

The Vercel build command is `npm run check:production-config && npm run db:migrate && npm run build`. The production-only preflight runs before migrations; Preview skips that gate. The complete migration replay has been applied and rerun successfully against the isolated Preview branch. That check found and fixed historical provider and audit-event constraints that rejected existing rows during a later full replay. Production still needs its own release verification and a measured restore; do not treat Preview success as production recovery evidence. Migration `024_durable_populate_jobs.sql` adds the managed Find rows queue and seeds the 20 shared worker slots; migrations `025` and `026` add credential key versions and audit actions. Keep previews isolated from production. Local single-process development applies migrations to embedded PGlite on first database use, while `npm run db:migrate` requires a dedicated Neon `DATABASE_URL` or `DATABASE_URL_UNPOOLED`.

Neon backups/PITR, access roles, retention, and restore are configured in the Neon account, not by the app. Before onboarding customers, restore a backup to a separate database, record the time and data loss window, and document who can authorize recovery.

## Verify a release

Before a staged release:

1. Confirm `/api/health/live` returns `200`.
2. Confirm `/api/health/ready` returns `200` and all checks are true. In managed production this includes Postgres, vault encryption/key-version schema, Clerk, the Clerk webhook secret, Stripe billing, the durable-job migrations (including the Find rows queue and shared worker slots), provider-usage attribution, workspace audit schema, and the worker secret.
3. Create a test organization, invite a second test member, and verify admin/member route behavior.
4. Run a synthetic one-row Monid operation; check run ID, status, cost, and source metadata in the sheet. Do not treat successful UI display as billing reconciliation.
5. Start a cell run and a Find rows run separately, close the tab, then reopen it and confirm the job status reconnects and all committed rows/results are present. Queue cancellation only works before a provider request starts; an uncertain Find rows run must not be automatically retried.
6. Complete Stripe test checkout and cancellation; verify access changes only after the server-verified webhook state.
7. Export a synthetic workspace and close a disposable workspace; inspect the export and retention behavior.
8. Confirm backup restore, rollback, alerts, and incident ownership before inviting real customers.

Workspace owners and admins can review provider receipts in **Configuration → Provider usage**. New Monid runs include member and cell IDs; receipts from before migration `021_provider_usage_attribution.sql` are shown without attribution. Historical Treg receipts are retained for audit/export only and cannot be used for new runs. Costs are only what a provider reported to the app; reconcile against Monid's billing records before treating them as settled totals. **Configuration → Workspace activity** shows the latest 100 recorded exports, closure, shared-settings, provider connection updates, MCP-key and credential rotation, Clerk membership, invitations, and Stripe subscription events. It stores metadata only and never records provider credentials, OAuth state, checkout URLs, or row contents.

Health endpoints intentionally omit detailed infrastructure errors. Use Vercel, Neon, Stripe, and Clerk operator logs to investigate. See the [authorization review](authorization-review.md) for route boundaries and the [operations runbook](operations-runbook.md) for safe recovery guidance.

## Known launch gaps

- Managed Find rows and individual enrichment cells use durable Postgres jobs and a shared pool of up to 20 active provider workers. Self-hosted Find rows remains request-streamed. MCP bulk calls persist completed cell progress for same-key polling, but do not have an independent worker and do not resume automatically after interruption.
- Request-rate and queue limits do not enforce app-side hard dollar spend caps, concurrent spend reservations, or budget alerts. Managed Monid usage is charged to the connected workspace wallet. There is no exact app quote for dynamic provider routes. Confirm wallet limits with Monid and review every run receipt.
- Credential rotation code is staged and bounded, but no production rotation rehearsal has been performed. Keep the previous root available until the rotation endpoint reports zero remaining rows and a post-rotation connection check succeeds.
- Provider usage reporting does not reconcile receipts with Monid's billing ledger or distinguish estimated and settled cost states beyond the receipt status. Historical Treg receipts are read-only.
- Workspace activity records Monid connection updates and Stripe billing metadata. Personal AgentWeb connection events and provider-side billing reconciliation are not yet mirrored.
- There is no production backup/restore drill, centralized error monitoring, service SLO, status page, or staffed support process yet.
- Workspace export excludes credentials and is capped at 50 MB. Workspace closure retains provider usage receipts and Stripe reconciliation records. Personal AgentWeb credentials do not belong to workspace deletion.
- Privacy terms, customer terms, subprocessors/DPA, retention schedule, and legal hold policy must be reviewed and published by the operator.
