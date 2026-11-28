# Production setup

This guide prepares a managed Monid Enrich deployment on Vercel. It does not deploy the app or create accounts for you. Run this once on an isolated staging project first. Keep self-hosted mode for a single operator or private instance; it is not the customer SaaS mode.

## Current deployment state

Audited 2026-11-28: the `monid-enrich` Vercel project is linked to `GameMachina/monid-enrich`. The production app responds at `https://enrich.autonomousgtm.xyz` and `https://monid-enrich.vercel.app`; both readiness endpoints reported ready for the currently deployed code. This does not validate the uncommitted billing changes or their new trial migration. A protected Preview deployment for commit `da38087` was previously verified against the isolated, schema-only Neon `vercel-preview` branch.

Neon Postgres and Realtime are provisioned on the `production` branch. Vercel Production has Clerk, the production database, Realtime, durable-enrichment, the Monid Enrich domain, a Stripe webhook secret, and the live $37 one-time Price. Stripe's live webhook is enabled at `https://monid-enrich.vercel.app/api/stripe/webhook` and includes checkout completion, asynchronous checkout, refund, and dispute events. The legacy $37 Payment Link is inactive. **Production currently has no `STRIPE_SECRET_KEY`**, which the new workspace-bound Checkout Session implementation requires; its production preflight will refuse deployment until a live `sk_` or appropriately restricted `rk_` key is added. The current billing changes and migration have not been deployed.

The worker is scheduled every minute in `vercel.json`. Vercel Pro or Enterprise supports the required schedule; verify the deployed cron after launch. [Vercel’s Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) document the schedule constraints.

The production build command runs `check:production-config` before migrations. It rejects a production deploy unless live Clerk credentials, the Stripe API and webhook keys, the live $37 one-time Stripe Price, the stable app URL, Neon, the vault key, and durable worker settings are present. The inactive legacy Payment Link is not required for new workspace-bound Checkout Sessions. Preview builds skip this production-only gate.

Clerk production authentication is configured. The old Payment Link must remain inactive because it cannot bind a payment to the selected organization. The new Checkout Session flow sets the verified workspace ID in server-owned metadata and grants access only after the signed webhook confirms payment. Add the missing Production `STRIPE_SECRET_KEY` in Vercel before deploying this change; do not put the key in source control or chat.

## Required services and settings

The product name is **Monid Enrich**. Some environment variables retain the `ENRICHABLE_*` prefix from the original codebase as internal compatibility names; the app still reads those exact names.

Use separate Clerk, Neon, Stripe, and Vercel environments for staging and production. Never attach a preview deployment to production customer data.

| Service | Configure | Notes |
| --- | --- | --- |
| Vercel | Node.js 22.23.4; project variables listed below | `vercel.json` checks production configuration, runs migrations, then builds and schedules `/api/internal/jobs/run` once a minute. This worker schedule requires Vercel Pro or Enterprise; Hobby supports only daily Cron schedules. See [Vercel Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing). |
| Neon/Postgres | Pooled `DATABASE_URL` for runtime; migration access available during build | Keep production, staging, and preview on separate branches/databases. Apply and review migrations on staging first. |
| Clerk | Publishable and secret keys; enable Organizations and configure sign-in/up | The Team screen uses Clerk's organization management UI. Verify invite, role, removal, recovery, and session behavior with test users. |
| Stripe | API secret, webhook signing secret, active $37 USD one-time Price ID, public app URL | Server-created Checkout Sessions bind the payment to the selected organization and return to that app domain. Signed webhooks fulfill access. Start in Stripe test mode. Do not enable recurring billing or automatic tax unless separately required. Monid usage remains separate. |
| Trial and organization access | `ENRICHABLE_BILLING_EXEMPT_EMAILS` | The first Monid organization a user opens gets one sheet and five populated rows; usage is retained if sheets or rows are deleted. Later organizations have no trial and require their own $37 one-time purchase. The verified admin allowlist grants full access only to that user's first organization; access is shared with that organization's members. |
| Platform administration | `ENRICHABLE_PLATFORM_ADMIN_EMAILS` | Optional comma-separated list of additional verified Clerk emails allowed to edit global Monid table-type defaults. `jalendnelson@gmail.com` is the initial platform administrator. Workspace admin roles do not grant this access. |
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
ENRICHABLE_BILLING_EXEMPT_EMAILS=jalendnelson@gmail.com
STRIPE_SECRET_KEY=rk_… # Restricted key scoped to Checkout Sessions (recommended)
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_ONE_TIME_PRICE_ID=price_…
# STRIPE_PAYMENT_LINK_ID=plink_… # optional, only for historical Payment Link purchases
ENRICHABLE_DURABLE_ENRICHMENT=true
CRON_SECRET=<stable random secret, 32+ characters>
```

The Clerk publishable key is intentionally browser-visible; the Clerk secret, Stripe webhook signing secret, optional legacy Stripe API key, cron secret, database URL, and encryption roots are server-only. Use distinct random secrets per environment. Migrations `025_credential_key_versions.sql` and `026_provider_billing_audit.sql` add key-version tracking and current audit actions. To rotate the managed vault root, first deploy this dual-key-capable code while keeping the current secret unchanged. Then set the new root as `ENRICHABLE_MCP_ENCRYPTION_SECRET` and the old root as `ENRICHABLE_MCP_ENCRYPTION_PREVIOUS_SECRET`, redeploy, and repeatedly call `POST /api/internal/credentials/rotate` with `Authorization: Bearer $CRON_SECRET` until every `remaining` count is zero. Allow the new deployment to fully replace all old instances, verify provider and MCP connections, then remove the previous secret and redeploy. Never overwrite the old root before the new code and previous-key setting are active.

Do not put a platform Monid key into the deployment environment for customer use. Workspace admins connect the workspace Monid API key in Configuration; OpenAI remains optional and user-configured. The app uses Clerk Organizations for workspace tenancy, but does not implement Monid OAuth or multi-tenant OAuth for connected data providers.

## Clerk setup

1. In the [Clerk Dashboard](https://dashboard.clerk.com/), create an application named **Monid Enrich**. Use its Development instance for local/staging work and its Production instance for the customer domain, or maintain a separate staging application if you need stronger isolation.
2. Enable Organizations with membership optional so a user can start in a personal workspace and later switch to a team. Allow users to create organizations if that matches the launch plan. Configure email verification, password recovery, invitations, and session policies.
3. Add `monid-enrich.vercel.app` under the Production instance's domain settings. Configure sign-in at `/sign-in` and sign-up at `/sign-up`.
4. On the Production instance's **API keys** page, copy the `pk_live_…` Publishable Key and `sk_live_…` Secret Key. These map to `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`; never put the Secret Key in source control or a public variable.
5. In the Clerk Dashboard's **Webhooks** page, create `https://monid-enrich.vercel.app/api/clerk/webhook`. Subscribe to `organization_membership.created`, `organization_membership.updated`, `organization_membership.deleted`, `organization_invitation.created`, `organization_invitation.accepted`, and `organization_invitation.revoked`. Copy the endpoint's `whsec_…` Signing Secret into `CLERK_WEBHOOK_SIGNING_SECRET`.
6. In Vercel → Project Settings → Environment Variables, set Production `ENRICHABLE_AUTH_MODE=clerk` and those three Clerk values. Redeploy, then confirm the Team page can create/select an organization and manage test members.
7. Test that a removed member loses access to existing tabs and every API route, that invitation and role events appear in **Configuration → Workspace activity**, and that a personal workspace cannot see an organization workspace.

## Stripe setup

1. In Stripe test mode, create a $37 USD one-time product and Price. Do not enable recurring billing or automatic tax unless a separate tax review calls for it.
2. Add a webhook endpoint at `https://your-host/api/stripe/webhook` and subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, and the legacy subscription events if existing subscribers remain.
3. Set the test API secret, endpoint signing secret, one-time price ID, and `ENRICHABLE_APP_URL` in the staging Vercel environment.
4. Verify one-time Checkout, workspace-bound success/cancel URLs, successful and failed asynchronous payments, refunds, disputes, webhook retries, and workspace access after each state change. Confirm Stripe shows a non-recurring $37 USD Price. Verify that one test organization can use its first-org trial, a second org is paywalled, and a separate $37 Checkout unlocks only that org for all members.
5. Repeat with production Stripe objects only after staging passes. Never reuse test keys or test database records in production.

The hosted product uses one $37 USD non-recurring Price. Checkout Sessions are created by the app with the active workspace ID in trusted server-side metadata, so the webhook grants access to exactly the organization that started Checkout. The first organization a user opens receives a single-sheet, five-row trial; an additional organization has no trial and needs its own $37 purchase. Purchases unlock the whole workspace for all its members. The verified-email admin allowlist applies only to that user's first organization. Monid provider usage stays separately billed. The app does not configure automatic tax, subscriptions for new customers, usage tiers, or multiple plans. Existing legacy subscriptions remain visible and manageable until canceled in Stripe.

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

Workspace owners and admins can review provider receipts in **Configuration → Provider usage**. New Monid runs include member and cell IDs; receipts from before migration `021_provider_usage_attribution.sql` are shown without attribution. Historical Treg receipts are retained for audit/export only and cannot be used for new runs. Costs are only what a provider reported to the app; reconcile against Monid's billing records before treating them as settled totals. **Configuration → Workspace activity** shows the latest 100 recorded exports, closure, shared-settings, provider connection updates, MCP-key and credential rotation, Clerk membership, invitations, and Stripe purchase/refund events (plus any legacy subscription events). It stores metadata only and never records provider credentials, OAuth state, checkout URLs, or row contents.

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
