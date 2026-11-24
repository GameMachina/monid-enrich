# Production setup

This guide prepares a managed Monid Enrich deployment on Vercel. It does not deploy the app or create accounts for you. Run this once on an isolated staging project first. Keep self-hosted mode for a single operator or private instance; it is not the customer SaaS mode.

## Required services and settings

Use separate Clerk, Neon, Stripe, and Vercel environments for staging and production. Never attach a preview deployment to production customer data.

| Service | Configure | Notes |
| --- | --- | --- |
| Vercel | Node.js 22.23.4; project variables listed below | `vercel.json` runs migrations before each build and schedules `/api/internal/jobs/run` once a minute. This worker schedule requires Vercel Pro or Enterprise; Hobby supports only daily Cron schedules. See [Vercel Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing). |
| Neon/Postgres | Pooled `DATABASE_URL` for runtime; migration access available during build | Keep production, staging, and preview on separate branches/databases. Apply and review migrations on staging first. |
| Clerk | Publishable and secret keys; enable Organizations and configure sign-in/up | The Team screen uses Clerk's organization management UI. Verify invite, role, removal, recovery, and session behavior with test users. |
| Stripe | Secret key, webhook signing secret, one recurring Price ID, public app URL | Start in test mode. Configure the customer portal and the webhook events below. App subscriptions are separate from Monid/Treg wallet charges. |
| Vercel Cron | `CRON_SECRET` | Use a high-entropy secret of at least 32 characters. Vercel sends it as a bearer token to the worker route. |

Set these project variables in each relevant Vercel environment. `.env.example` is the local template; never commit actual values.

```text
ENRICHABLE_AUTH_MODE=clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_…
CLERK_SECRET_KEY=sk_…
DATABASE_URL=postgresql://…
ENRICHABLE_MCP_ENCRYPTION_SECRET=<stable random secret, 32+ characters>
ENRICHABLE_APP_URL=https://your-production-host
ENRICHABLE_BILLING_REQUIRED=true
STRIPE_SECRET_KEY=sk_…
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_PRICE_ID=price_…
ENRICHABLE_DURABLE_ENRICHMENT=true
CRON_SECRET=<stable random secret, 32+ characters>
```

The Clerk publishable key is intentionally browser-visible; the Clerk secret, Stripe keys, cron secret, database URL, and encryption root are server-only. Use distinct random secrets per environment. Keep the encryption root stable and backed up: replacing it without a re-encryption procedure makes existing saved provider credentials unreadable.

Do not put a platform Monid or Treg key into the deployment environment for customer use. Workspace members connect their own workspace credentials in Configuration; AgentWeb credentials are personal to each member. OpenAI is optional and remains user-configured.

## Clerk setup

1. Create a dedicated Clerk application for staging and another for production.
2. Enable Organizations and configure organization membership roles. Set invitation, verification, password recovery, and session policies for the target users.
3. Add the exact production and staging origins to the Clerk application. Configure sign-in at `/sign-in` and sign-up at `/sign-up`.
4. Set the environment-specific Clerk keys in Vercel. Confirm the Team page can create/select an organization and manage test members.
5. Test that a removed member loses access to existing tabs and every API route, and that a personal workspace cannot see an organization workspace.

## Stripe setup

1. In Stripe test mode, create the first recurring product/price and customer portal configuration.
2. Add a webhook endpoint at `https://your-host/api/stripe/webhook` and subscribe to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`.
3. Set the test secret, endpoint signing secret, price ID, and `ENRICHABLE_APP_URL` in the staging Vercel environment.
4. Verify checkout, portal return, cancellation, failed payment, webhook retries, and access after each subscription-state change.
5. Repeat with production Stripe objects only after staging passes. Never reuse test keys or test database records in production.

The current implementation supports one configured recurring price. It does not yet model multiple plans, usage tiers, tax policy, invoice workflows, or self-serve plan changes. Keep those as explicit product work before offering them.

## Database, migrations, and previews

The Vercel build command is `npm run db:migrate && npm run build`. Migrations are additive and serialized, but this has not been exercised against a production account as part of this code change. Review new migration SQL, test it on staging, and keep previews isolated from production. Do not run migration commands against a customer database to troubleshoot a preview build.

Neon backups/PITR, access roles, retention, and restore are configured in the Neon account, not by the app. Before onboarding customers, restore a backup to a separate database, record the time and data loss window, and document who can authorize recovery.

## Verify a release

Before a staged release:

1. Confirm `/api/health/live` returns `200`.
2. Confirm `/api/health/ready` returns `200` and all checks are true. In managed production this includes Postgres, vault encryption, Clerk, Stripe billing, the durable-job migration, provider-usage attribution schema, and the worker secret.
3. Create a test organization, invite a second test member, and verify admin/member route behavior.
4. Run a synthetic one-row Monid and Treg operation separately; check provider, run ID, status, cost, and source metadata in the sheet. Do not treat successful UI display as billing reconciliation.
5. Start a cell run, close the tab, and verify the result is saved by the worker. Queue cancellation only works before a provider request starts.
6. Complete Stripe test checkout and cancellation; verify access changes only after the server-verified webhook state.
7. Export a synthetic workspace and close a disposable workspace; inspect the export and retention behavior.
8. Confirm backup restore, rollback, alerts, and incident ownership before inviting real customers.

Workspace owners and admins can review provider receipts in **Configuration → Provider usage**. The report keeps Monid and Treg charges separate, supports provider/status/date/member/sheet filters, and exports up to 10,000 matching rows. New cell runs include member and cell IDs; receipts from before migration `021_provider_usage_attribution.sql` are shown without attribution. Costs are only what a provider reported to the app; reconcile against each provider's billing records before treating them as settled totals. **Configuration → Workspace activity** shows the latest 100 recorded exports, closure, shared-settings, and MCP-key changes; Clerk membership and billing/provider lifecycle events are not yet mirrored there.

Health endpoints intentionally omit detailed infrastructure errors. Use Vercel, Neon, Stripe, and Clerk operator logs to investigate. See the [authorization review](authorization-review.md) for route boundaries and the [operations runbook](operations-runbook.md) for safe recovery guidance.

## Known launch gaps

- Find rows is still request/browser coordinated; only individual enrichment cells use the durable job table.
- Request-rate limits do not enforce hard dollar spend caps, concurrent spend reservations, or budget alerts.
- Provider usage reporting does not reconcile receipts with Monid/Treg billing ledgers or distinguish provider-specific estimated and settled cost states beyond the receipt status.
- Workspace activity does not yet include Clerk membership changes or billing/provider connection lifecycle events.
- There is no production backup/restore drill, centralized error monitoring, service SLO, status page, or staffed support process yet.
- Workspace export excludes credentials and is capped at 50 MB. Workspace closure retains provider usage receipts and Stripe reconciliation records. Personal AgentWeb credentials do not belong to workspace deletion.
- Privacy terms, customer terms, subprocessors/DPA, retention schedule, and legal hold policy must be reviewed and published by the operator.
