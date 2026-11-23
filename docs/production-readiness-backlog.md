# Production readiness backlog

**Scope:** The managed, multi-customer SaaS version of Monid Enrich. Self-hosted installs remain a separate deployment mode. This backlog is an audit of the current repository and the [Encore SaaS starter article](https://dev.to/encore/build-a-production-ready-saas-app-that-will-scale-e16), reviewed 2026-11-24. It is a work plan, not a claim that the app is already ready to sell.

## Status at a glance

The app has a substantial product and technical foundation: a Vercel/Neon deployment path, serialized migrations, workspace-scoped persistence, encrypted hosted credentials, signed hosted sessions, revision-aware sheet writes, provider receipts, and CI with lint, type checks, unit/server tests, a build, secret scanning, and limited browser smoke coverage. See [deployment](deploy.md), [hosted operations](hosted.md), and [development](development.md).

The article is a useful SaaS feature checklist: frontend and backend, customer identity and organizations, subscriptions, payment webhooks, and a Vercel deployment flow. Its example uses Encore, Next.js, Clerk, and Stripe. This repository already uses Next.js API routes and Vercel/Neon, so adopting Encore or Clerk is not itself a requirement; the required outcome is reliable tenancy, billing, and operations. The article does not replace the security, privacy, recovery, support, or load-readiness work below.

### Verified gaps and constraints

- Hosted sign-in is a custom Context.dev OAuth integration restricted to `enrichable.io` and `www.enrichable.io`; self-hosted mode uses a browser workspace cookie and does not provide customer accounts or cross-device recovery. It is not a general-purpose signup and organization lifecycle for this fork.
- There is no Monid Enrich subscription checkout, plan catalog, entitlement system, or application billing webhook. Monid and Treg provider balances/top-ups are separate from a future app subscription.
- Enrichment execution is coordinated by a browser runner and bounded API requests. The development guide explicitly says there is **no durable enrichment worker**. A closed tab or serverless timeout must not be the reliability boundary for customer bulk work.
- A self-hosted browser workspace keeps manually entered provider keys in browser local storage. The hosted organization credential vault is encrypted server-side; production customer credentials must use the hosted/server-side path.
- Treg connections, supported operations, and billing are distinct from Monid. Treg's team-level spend caps and usage-by-tag invoicing are not configured by this app today; see [Treg gaps](treg-provider.md).
- There is no documented production backup/restore drill, customer data retention/deletion program, service SLO/alert policy, or launch support/on-call process.
- CI is a good baseline, but the browser smoke job is deliberately narrow and uses mocked endpoints. It is not a production integration, load, restore, or security test.

## P0 — required before onboarding paying customers

Each item should have an owner and target release before work begins. “Done when” is the acceptance gate.

### P0.1 Decide the hosted tenancy and identity model

Implement customer-facing identity for this product rather than assuming the official Enrichable OAuth domain. Define account creation, organization/workspace creation, member invitations, sign-in recovery, session revocation, and the relationship between a person, workspace, and billing owner. Choose a maintained identity service or document and security-review a first-party flow.

**Done when:** a new customer can register, create a workspace, invite a teammate, leave/revoke access, recover access, and sign out; expired/revoked membership stops working across existing tabs and API calls. Hosted and self-hosted auth modes have explicit tests and setup docs.

### P0.2 Finish tenant authorization and credential ownership rules

Audit every page, API route, MCP tool, realtime subscription, connection-management endpoint, and usage report for workspace scoping. Define which credentials are personal, workspace-shared, or operator-owned. Enforce role checks for billing, member management, secret changes, and destructive operations. Add explicit CSRF/origin protections for cookie-authenticated mutations and abuse limits for unauthenticated or expensive entry points. Review server-side URL fetching for SSRF protections.

**Done when:** automated cross-workspace tests prove one workspace cannot read, edit, enrich, export, or spend from another workspace; every privileged action checks role on the server; cookie-authenticated writes reject hostile origins; provider secrets and raw upstream payloads never reach browser responses or logs.

### P0.3 Add product plans, checkout, webhooks, and entitlements

Add an application billing model if this will be a paid hosted SaaS: plans, trial/cancel/past-due states, checkout, customer portal, invoices, and server-enforced entitlements. Verify webhook signatures, persist and deduplicate event IDs, handle event reordering/retries, and reconcile provider state. Show the product subscription separately from Monid, Treg, and user-supplied OpenAI charges; do not combine balances.

**Done when:** a test customer can subscribe, upgrade/downgrade, cancel, recover from failed payment, and see correct access after webhook retries; API and UI enforce the same plan limits; no app feature trusts a client-reported plan or payment status. If the product will remain free/self-hosted only, record that decision and remove this item from the launch gate.

### P0.4 Move long and bulk enrichment to durable jobs

Create persisted jobs for Find rows, bulk cell runs, and other long work. Use a durable queue/worker with transactional enqueue, leases, progress, cancellation, bounded concurrency, retries, and dead-letter/reconciliation paths. Keep the sheet as the visible trust surface, but make persisted job state authoritative across tab closure, deploys, and function timeouts. Reuse operation fingerprints and provider idempotency keys; never create a new paid call just because a poll or save failed.

**Done when:** closing a browser, restarting a worker, or deploying during a run does not lose results or duplicate a billed call; users can resume/cancel and see per-row status; stale leases recover safely; terminal failures and uncertain charges are inspectable and reconcilable.

### P0.5 Put hard spend and abuse controls around every paid path

Define workspace/member request limits, per-operation maximum cost, active-run limits, and daily/monthly spend caps. Apply server-side preflight checks before provider calls, reserve and settle known usage, retain uncertain charges for reconciliation, and add circuit breakers for exhausted balance, repeated provider failures, and abnormal spend. Keep Monid, Treg, OpenAI, and any future app-funded allowance ledgers separate. Decide whether Treg is user/workspace-owned or platform-funded before enabling a shared platform Treg key.

**Done when:** concurrent requests cannot overspend a cap; every run records its selected provider, workspace, operation, cost/usage, status, and provider run ID where available; users can see a clear estimate/cap before execution and understand who is billed; alerts fire before an operator-funded budget is exhausted.

### P0.6 Establish production database and recovery procedures

Keep production on managed Postgres; do not use embedded PGlite for a multi-user or multi-instance hosted service. Separate production, staging, and preview databases/branches and credentials. Confirm connection pooling and serverless connection behavior under load. Define backup/PITR retention, restore access, migration ownership, and a tested recovery point/time objective. Review the current “migrate during Vercel build” workflow for preview and concurrent production builds; use a controlled release migration step if build-time migration cannot meet the required deployment safety.

**Done when:** a restore to an isolated database has been demonstrated and timed; backup retention and RPO/RTO are documented; migrations are backward-compatible across rolling deployments and fail closed; previews cannot read or mutate production data; deployment rollback steps are documented.

### P0.7 Complete production security and secret lifecycle review

Threat-model auth, workspace isolation, spreadsheet imports/formulas, OAuth callbacks, provider adapters, file/URL retrieval, MCP, and billing. Verify dependency and container/build provenance controls, security headers/CSP, cookie flags, input/output limits, and rate limits. Define credential encryption-key rotation and recovery: the current hosted vault depends on a stable shared encryption root, and changing it without re-encryption makes saved credentials unreadable. Add a process for rotating/revoking user and operator keys without downtime.

**Done when:** a documented security review has no unresolved critical/high findings; a credential/key rotation has been rehearsed on staging; secrets are absent from Git history, browser bundles, logs, traces, and error responses; vulnerability reports have a working private contact and response target.

### P0.8 Publish privacy terms and implement customer data lifecycle

Document what row data and prompts go to each provider, what the app stores, subprocessors, retention, and customer responsibilities. Add customer-visible data export and workspace/account deletion with clear treatment of backups, provider-side retention, usage ledgers, and legal holds. Publish Privacy Policy, Terms, and, if required for target customers, a DPA and subprocessors list. Confirm lawful use and retention for prospect/contact data and social profile results.

**Done when:** customers can export and request deletion without manual SQL; deletion is tenant-safe and completed within a stated period; provider/data handling is disclosed at connection and product level; legal documents match actual processing and billing behavior.

### P0.9 Add service health, observability, and incident response

The app already returns request IDs and redacts unexpected server errors. Add centralized structured logs, exception reporting, latency/error dashboards, database and queue health, provider status/error/cost metrics, and alerts with customer/workspace-safe identifiers. Establish service SLOs, an incident owner/on-call path, status communication, and runbooks for database failure, stuck jobs, provider outage, key exposure, and billing mismatch.

**Done when:** an operator can find a failed run from its request/run ID without seeing secrets or raw sensitive rows; alerts detect elevated errors, queue age, DB saturation, and budget anomalies; a simulated incident has an owner, mitigation steps, and customer communication path.

### P0.10 Define a release and customer-support gate

Expand the current CI baseline with production-like staging checks for signup/auth, tenant isolation, paid workflow limits, migrations, provider failures, long jobs, and customer data export/deletion. Add dependency/security scanning and a release checklist. Create a support channel, issue severity definitions, response expectations, and customer-facing setup/troubleshooting docs before enabling public signup.

**Done when:** every release passes staging smoke and migration checks; no test uses production data or paid customer credentials; a support request can be routed and tracked; a rollback and incident owner are named for each release.

## P1 — required for a dependable general-availability release

### P1.1 Team administration and auditability

Add workspace member/role management, invitation expiry/revocation, credential change history, and audit events for membership, billing, provider connections, exports, and destructive actions. Keep audit payloads free of raw secrets and unnecessary prospect data.

### P1.2 Provider capability and connection reliability

Maintain a capability matrix derived from current Monid/Treg catalogs and OAuth/API-key support. Make unsupported operations clear before a column is run; test OAuth start/callback, state/PKCE, callback allowlists, secret save/revoke, provider-directory changes, and upstream 401/403/429/5xx behavior. For each provider, document billing owner, usage visibility, idempotency semantics, and recovery from uncertain runs.

### P1.3 Usage and cost reporting

Give workspace admins searchable, exportable usage records by provider, operation, member, sheet, time, status, and cost where available. Explain estimates versus settled and uncertain cost. Add reconciliation for provider usage that differs from app receipts. Do not show Treg balance as Monid balance or app subscription as provider credits.

### P1.4 Onboarding and activation

Build a first-run path for workspace creation, imports, a sample sheet, provider connection, a safe five-row trial run, and expected-cost preview. Provide actionable connection and provider error guidance and a route to support. Make the free/sample experience usable without entering an OpenAI key.

### P1.5 Scale and data-integrity verification

Set supported sheet, row, column, import, and export sizes based on measured performance rather than copied reference limits. Load-test concurrent edits, revision conflicts, bulk runs, realtime subscriptions, export generation, and database pool behavior. Test IndexedDB cache recovery and multi-tab synchronization with large sheets and offline/reconnect transitions.

### P1.6 Accessibility, browser support, and responsive behavior

Run keyboard-only and screen-reader reviews for the grid, menus, dialogs, connection/OAuth flows, and status details. Check contrast and reduced-motion behavior. Publish supported browser/device versions and verify the core workflow on mobile/tablet if those are in scope.

### P1.7 Service and customer documentation

Document account setup, provider billing boundaries, supported operations, import/export formats, data retention, limitations, known provider gaps, status page, and support escalation. Keep docs aligned with the capability catalog and deployment configuration.

## P2 — scale and enterprise work, prioritize from evidence

- Separate API and worker deployments, or adopt a dedicated backend framework such as Encore, only if measured release cadence, ownership, or scaling pressure justifies the split. The current Next.js API route architecture is not a blocker by itself.
- Add enterprise identity (SAML/SSO, SCIM), advanced roles, organization policy controls, and customer audit-log exports when target contracts require them.
- Add multi-region/read-replica strategy, partitioning/archival, and higher-volume job scheduling after load tests identify the bottlenecks.
- Add customer-configurable retention policies, data residency controls, and analytics opt-out/reporting where customer or regulatory requirements demand them.
- Add formal disaster-recovery exercises, availability reporting, and capacity/cost forecasts as usage grows.

## Recommended critical path

1. Choose managed SaaS versus self-hosted scope and define the tenant, identity, and billing model.
2. Close tenant authorization, spend safety, and credential handling gaps.
3. Build durable job execution and run reconciliation.
4. Add product billing/entitlements if customers will pay for the app.
5. Prove database backup/restore and safe releases.
6. Add observability, privacy/data lifecycle, support, and security review.
7. Run staging, failure, load, and recovery exercises; then invite a controlled beta cohort.

## Related repository references

- [Deploy to Vercel with Neon](deploy.md)
- [Official-site operations and hosted identity](hosted.md)
- [Development architecture and checks](development.md)
- [Treg provider behavior and current gaps](treg-provider.md)
- [Security policy and current operating assumptions](../SECURITY.md)
