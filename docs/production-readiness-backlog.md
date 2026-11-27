# Production readiness backlog

**Scope:** The managed, multi-customer SaaS version of Monid Enrich. Self-hosted installs remain a separate deployment mode. This backlog is an audit of the current repository and the [Encore SaaS starter article](https://dev.to/encore/build-a-production-ready-saas-app-that-will-scale-e16), reviewed 2026-11-24. It is a work plan, not a claim that the app is already ready to sell.

## Status at a glance

This document started as an audit; the implementation below has since closed some of the first-release gaps. It is still a launch backlog, not a claim that the service is production-ready. Current implementation status is recorded under each item. Operational setup and known limits are in [production setup](production-setup.md), [data handling](data-handling.md), and the [operations runbook](operations-runbook.md).

The article is a useful SaaS feature checklist: frontend and backend, customer identity and organizations, subscriptions, payment webhooks, and a Vercel deployment flow. Its example uses Encore, Next.js, Clerk, and Stripe. This repository already uses Next.js API routes and Vercel/Neon, so adopting Encore or Clerk is not itself a requirement; the required outcome is reliable tenancy, billing, and operations. The article does not replace the security, privacy, recovery, support, or load-readiness work below.

### Current constraints

- **Customer production is still gated (verified 2026-11-27).** Vercel has a protected Preview at commit `da38087` (build and full replay migration passed on the isolated Preview Neon branch), an attached `monid-enrich.vercel.app` domain, and production Neon/Realtime, encryption, cron, and app URL variables. No production deployment is active. Production Clerk and Stripe credentials, a live plan, durable-worker enablement, staged verification, and recovery/operations evidence are still required. The Vercel build now fails closed until the production variables are complete. See [production setup](production-setup.md).
- Hosted customer sign-in now uses Clerk Organizations. The code is implemented, but Clerk application setup, organization settings, email recovery, role revocation, and signup flow still need a staging verification before public onboarding.
- Stripe subscription checkout, portal, idempotent webhook recording, and active-subscription gating are implemented for one configured price. Product plans, taxes, invoices/support workflows, and end-to-end billing verification remain open.
- Per-cell enrichment and managed natural-language Find rows jobs persist in Postgres. The Vercel worker uses a shared 20-slot lease pool across job types; queue capacity, recovery, and provider billing behavior still need staging/load verification.
- Per-minute request limits, bounded active durable-job queues, and a 20-slot worker concurrency cap are implemented. They do not enforce a hard monetary workspace budget or safely reserve unknown provider charges; spend caps and reconciliation remain open.
- Workspace export and closure are implemented. Export excludes credentials and caps at 50 MB; closure retains usage receipts and Stripe reconciliation data, and personal AgentWeb credentials are outside the workspace deletion path. Retention, backup expiry, and legal holds are not implemented.
- Monid is the sole external data provider. Workspace admins connect a Monid API key; provider OAuth is not implemented. Legacy Treg receipts remain read-only for audit/export.
- CI checks are not a substitute for staging auth/billing/provider tests, a security review, a measured restore, or load testing. No production deployment or live paid integration test has been performed as part of this work.

## P0 — required before onboarding paying customers

Each item should have an owner and target release before work begins. “Done when” is the acceptance gate.

### P0.1 Decide the hosted tenancy and identity model

Implement customer-facing identity for this product rather than assuming the official Enrichable OAuth domain. Define account creation, organization/workspace creation, member invitations, sign-in recovery, session revocation, and the relationship between a person, workspace, and billing owner. Choose a maintained identity service or document and security-review a first-party flow.

**Status: Partial.** Clerk sign-in/up, personal/team workspace mapping, server-side roles, and the team management surface are implemented. Set up a Clerk app with Organizations and verify invitations, role changes, sign-out, account recovery, session revocation, and stale-tab behavior on staging before launch. See [production setup](production-setup.md).

**Done when:** a new customer can register, create a workspace, invite a teammate, leave/revoke access, recover access, and sign out; expired/revoked membership stops working across existing tabs and API calls. Hosted and self-hosted auth modes have explicit tests and setup docs.

### P0.2 Finish tenant authorization and credential ownership rules

Audit every page, API route, MCP tool, realtime subscription, connection-management endpoint, and usage report for workspace scoping. Define which credentials are personal, workspace-shared, or operator-owned. Enforce role checks for billing, member management, secret changes, and destructive operations. Add explicit CSRF/origin protections for cookie-authenticated mutations and abuse limits for unauthenticated or expensive entry points. Review server-side URL fetching for SSRF protections.

**Status: Partial.** Admin checks now protect billing, workspace export/closure, shared settings, provider connections, usage reports, and MCP key management. Existing workspace-scoped stores remain the authorization boundary; managed/self-hosted write requests have same-origin checks and provider-backed routes have request limits. A static route/fetch boundary review is recorded in [authorization review](authorization-review.md). Cross-workspace, stale or revoked membership, Clerk webhook replay, hostile-origin staging checks, and an independent SSRF review remain launch gates.

**Done when:** automated cross-workspace tests prove one workspace cannot read, edit, enrich, export, or spend from another workspace; every privileged action checks role on the server; cookie-authenticated writes reject hostile origins; provider secrets and raw upstream payloads never reach browser responses or logs.

### P0.3 Add product plans, checkout, webhooks, and entitlements

Add an application billing model if this will be a paid hosted SaaS: plans, trial/cancel/past-due states, checkout, customer portal, invoices, and server-enforced entitlements. Verify webhook signatures, persist and deduplicate event IDs, handle event reordering/retries, and reconcile provider state. Show the product subscription separately from Monid and user-supplied OpenAI charges; do not combine balances.

**Status: Partial.** One-price Checkout, customer portal, signed/deduplicated webhooks, and server-side subscription gating are implemented. Configure Stripe test mode and verify purchase, cancellation, webhook retry/reorder, portal, and access changes before production; multi-plan entitlements and tax/invoice support remain open.

**Done when:** a test customer can subscribe, upgrade/downgrade, cancel, recover from failed payment, and see correct access after webhook retries; API and UI enforce the same plan limits; no app feature trusts a client-reported plan or payment status. If the product will remain free/self-hosted only, record that decision and remove this item from the launch gate.

### P0.4 Move long and bulk enrichment to durable jobs

Create persisted jobs for Find rows, bulk cell runs, and other long work. Use a durable queue/worker with transactional enqueue, leases, progress, cancellation, bounded concurrency, retries, and dead-letter/reconciliation paths. Keep the sheet as the visible trust surface, but make persisted job state authoritative across tab closure, deploys, and function timeouts. Reuse operation fingerprints and provider idempotency keys; never create a new paid call just because a poll or save failed.

**Status: Partial.** Per-cell and managed Find rows jobs have durable records, workspace-scoped idempotency, progress polling, server-side writes, safe queued cancellation, and lease recovery. Find rows batches and counters commit in one transaction; a 20-slot Postgres lease pool caps combined provider concurrency across Vercel instances. A Find rows worker timeout is marked `uncertain` and is never automatically replayed. Cell jobs retry after a stale lease only for the provider path whose adapter supports stable idempotency. MCP bulk calls now persist each completed cell outcome for same-key polling, so committed progress survives request interruption; the request still runs synchronously and interrupted attempts stay `uncertain` rather than resuming on a worker. Self-hosted Find rows remains a request stream, and live staging tests are not yet covered. Verify durable job recovery, MCP partial polling, concurrent claim behavior, and provider usage reconciliation on staging.

**Done when:** closing a browser, restarting a worker, or deploying during a run does not lose committed results or duplicate a billed call; users can resume and inspect progress/status; stale leases recover safely; terminal failures and uncertain charges are inspectable and reconcilable. Running provider work cannot be safely cancelled after the request begins.

### P0.5 Put hard spend and abuse controls around every paid path

Define workspace/member request limits, per-operation maximum cost, active-run limits, and daily/monthly spend caps. Apply server-side preflight checks before provider calls, reserve and settle known usage, retain uncertain charges for reconciliation, and add circuit breakers for exhausted balance, repeated provider failures, and abnormal spend. Keep Monid, OpenAI, and any future app-funded allowance ledgers separate.

**Status: Partial.** Atomic per-minute member/workspace request limits and durable-cell queue ceilings (100 active jobs per member, 500 per workspace) are implemented. Runs over 50 cells require confirmation with explicit notice that provider prices are not known as an exact pre-run quote. These are not workspace-wide dollar reservations: Monid charges the connected workspace wallet, provider costs can be absent/uncertain, and no app-side daily/monthly cap or mismatch alert exists. Managed mode accepts workspace-vault provider credentials only. Provider-side wallet/spend limits remain the hard control until reliable quote/reservation semantics are available.

**Done when:** concurrent requests cannot overspend a cap; every run records its selected provider, workspace, operation, cost/usage, status, and provider run ID where available; users can see a clear estimate/cap before execution and understand who is billed; alerts fire before an operator-funded budget is exhausted.

### P0.6 Establish production database and recovery procedures

Keep production on managed Postgres; do not use embedded PGlite for a multi-user or multi-instance hosted service. Separate production, staging, and preview databases/branches and credentials. Confirm connection pooling and serverless connection behavior under load. Define backup/PITR retention, restore access, migration ownership, and a tested recovery point/time objective. Review the current “migrate during Vercel build” workflow for preview and concurrent production builds; use a controlled release migration step if build-time migration cannot meet the required deployment safety.

**Status: Open.** Code and runbook describe the required isolation, but the Neon/Vercel account, backup policy, restore exercise, and RPO/RTO are external operator setup. Do not onboard paying customers until a restore has been measured.

**Done when:** a restore to an isolated database has been demonstrated and timed; backup retention and RPO/RTO are documented; migrations are backward-compatible across rolling deployments and fail closed; previews cannot read or mutate production data; deployment rollback steps are documented.

### P0.7 Complete production security and secret lifecycle review

Threat-model auth, workspace isolation, spreadsheet imports/formulas, OAuth callbacks, provider adapters, file/URL retrieval, MCP, and billing. Verify dependency and container/build provenance controls, security headers/CSP, cookie flags, input/output limits, and rate limits. Define credential encryption-key rotation and recovery: the current hosted vault depends on a stable shared encryption root, and changing it without re-encryption makes saved credentials unreadable. Add a process for rotating/revoking user and operator keys without downtime.

**Status: Partial.** Clerk, encrypted shared credential storage, security headers, bounded inputs, redacted error paths, private GitHub vulnerability reporting, Gitleaks history scanning, CodeQL, Dependabot, and request limits are in place. Managed-vault dual-key rotation and a bounded secret-protected re-encryption endpoint are implemented. CSP remains report-only; review scanner findings, complete an independent security review, and rehearse key rotation on staging before launch. Self-hosted file-vault rotation remains an operator-managed separate path.

**Done when:** a documented security review has no unresolved critical/high findings; a credential/key rotation has been rehearsed on staging; secrets are absent from Git history, browser bundles, logs, traces, and error responses; vulnerability reports have a working private contact and response target.

### P0.8 Publish privacy terms and implement customer data lifecycle

Document what row data and prompts go to each provider, what the app stores, subprocessors, retention, and customer responsibilities. Add customer-visible data export and workspace/account deletion with clear treatment of backups, provider-side retention, usage ledgers, and legal holds. Publish Privacy Policy, Terms, and, if required for target customers, a DPA and subprocessors list. Confirm lawful use and retention for prospect/contact data and social profile results.

**Status: Partial.** Admin export and workspace closure are implemented and documented. Legal terms/privacy/DPA, retention windows, backup deletion behavior, and personal AgentWeb credential handling still need explicit product policy and implementation.

**Done when:** customers can export and request deletion without manual SQL; deletion is tenant-safe and completed within a stated period; provider/data handling is disclosed at connection and product level; legal documents match actual processing and billing behavior.

### P0.9 Add service health, observability, and incident response

The app already returns request IDs and redacts unexpected server errors. Add centralized structured logs, exception reporting, latency/error dashboards, database and queue health, provider status/error/cost metrics, and alerts with customer/workspace-safe identifiers. Establish service SLOs, an incident owner/on-call path, status communication, and runbooks for database failure, stuck jobs, provider outage, key exposure, and billing mismatch.

**Status: Partial.** Liveness/readiness routes, request IDs, redacted errors, and an operator runbook are implemented. Centralized exception collection, dashboards, SLOs, alert delivery, and an incident owner/status channel require service/account configuration.

**Done when:** an operator can find a failed run from its request/run ID without seeing secrets or raw sensitive rows; alerts detect elevated errors, queue age, DB saturation, and budget anomalies; a simulated incident has an owner, mitigation steps, and customer communication path.

### P0.10 Define a release and customer-support gate

Expand the current CI baseline with production-like staging checks for signup/auth, tenant isolation, paid workflow limits, migrations, provider failures, long jobs, and customer data export/deletion. Add dependency/security scanning and a release checklist. Create a support channel, issue severity definitions, response expectations, and customer-facing setup/troubleshooting docs before enabling public signup.

**Status: Partial.** CI covers lint, types, tests, build, secret-history scanning, CodeQL, dependency update PRs, and a narrow browser smoke. Next's production route validator now passes after making the shared API wrapper's route context required in its exported handler type; direct one-argument calls used by test seams remain supported. The production script pins the verified webpack builder because Turbopack stalled in the current workspace. The npm advisory report is now clean after fixing seven moderate development-tooling advisories. Staging deployment checks, security review, support ownership, and rollback exercise remain launch gates.

**Done when:** every release passes staging smoke and migration checks; no test uses production data or paid customer credentials; a support request can be routed and tracked; a rollback and incident owner are named for each release.

## P1 — required for a dependable general-availability release

### P1.1 Team administration and auditability

**Status: Partial.** Clerk OrganizationProfile supplies member management. Workspace export/closure, shared-settings changes, MCP-key create/rotation, credential re-encryption, Monid workspace connection updates, signed/deduplicated Clerk membership and invitation webhooks, and Stripe subscription lifecycle webhooks are recorded as metadata-only events; workspace admins can review the latest 100 in Configuration. Personal AgentWeb connection events and Clerk/Stripe webhook delivery verification remain staging gates.

Add workspace member/role management, invitation expiry/revocation, credential change history, and audit events for membership, billing, provider connections, exports, and destructive actions. Keep audit payloads free of raw secrets and unnecessary prospect data.

### P1.2 Provider capability and connection reliability

**Status: Partial.** Monid operations are explicit and routed through its API; live-catalog drift checks and staging API-key lifecycle verification remain.

Maintain a capability matrix derived from Monid's current catalog and API-key support. Make unsupported operations clear before a column is run; test key save/revoke, catalog changes, and upstream 401/403/429/5xx behavior. Document workspace billing, usage visibility, idempotency semantics, and recovery from uncertain runs.

### P1.3 Usage and cost reporting

**Status: Partial.** Workspace-admin usage reports now filter by provider, operation/search text, member, sheet, time, and status, paginate receipts, and export up to 10,000 matching rows to CSV. Monid totals are separate from optional OpenAI usage; historical Treg receipts are labeled and read-only. Migration `021_provider_usage_attribution.sql` associates new cell receipts with member/sheet/row/column IDs without copying row data or prompts. Older receipts remain unattributed. Provider-reported cost is labeled separately from unknown cost; provider-side reconciliation and settled-versus-estimated semantics remain open.

Remaining: reconcile app receipts against Monid billing data; clarify which amounts are estimates, settled charges, or uncertain; and add automated mismatch alerts. Do not show Monid balance as the app subscription balance.

### P1.4 Onboarding and activation

**Status: Partial.** The empty-workspace flow offers a five-row fictional sample sheet using reserved `.example` domains. A first-run checklist now appears for workspaces with sheets, links to provider setup and a five-row search, and discloses that provider pricing varies and no exact pre-run quote is available. The safe search cap is in place. A provider-backed expected-cost quote and support handoff remain open because provider route prices and workspace support configuration are not available from the app today.

Build a first-run path for workspace creation, imports, a sample sheet, provider connection, a safe five-row trial run, and expected-cost preview. Provide actionable connection and provider error guidance and a route to support. Make the free/sample experience usable without entering an OpenAI key.

### P1.5 Scale and data-integrity verification

**Status: Open.**

Set supported sheet, row, column, import, and export sizes based on measured performance rather than copied reference limits. Load-test concurrent edits, revision conflicts, bulk runs, realtime subscriptions, export generation, and database pool behavior. Test IndexedDB cache recovery and multi-tab synchronization with large sheets and offline/reconnect transitions.

### P1.6 Accessibility, browser support, and responsive behavior

**Status: Open.**

Run keyboard-only and screen-reader reviews for the grid, menus, dialogs, connection and sign-in flows, and status details. Check contrast and reduced-motion behavior. Publish supported browser/device versions and verify the core workflow on mobile/tablet if those are in scope.

### P1.7 Service and customer documentation

**Status: Partial.** Operator deployment, data handling, and incident notes are now documented. Customer-facing privacy/legal/support materials and verified support limits remain external launch work.

Document account setup, provider billing boundaries, supported operations, import/export formats, data retention, limitations, known provider gaps, status page, and support escalation. Keep docs aligned with the capability catalog and deployment configuration.

## P2 — scale and enterprise work, prioritize from evidence

- Separate API and worker deployments, or adopt a dedicated backend framework such as Encore, only if measured release cadence, ownership, or scaling pressure justifies the split. The current Next.js API route architecture is not a blocker by itself.
- Add enterprise identity (SAML/SSO, SCIM), advanced roles, organization policy controls, and customer audit-log exports when target contracts require them.
- Add multi-region/read-replica strategy, partitioning/archival, and higher-volume job scheduling after load tests identify the bottlenecks.
- Add customer-configurable retention policies, data residency controls, and analytics opt-out/reporting where customer or regulatory requirements demand them.
- Add formal disaster-recovery exercises, availability reporting, and capacity/cost forecasts as usage grows.

## Recommended critical path

1. Configure isolated staging Clerk, Neon, Stripe, and Vercel environments; verify sign-up, org roles, subscription events, and protected routes.
2. Finish hard-spend limits and budget alerts; decide whether each provider is customer/workspace-paid before enabling any platform-funded credential.
3. Verify durable Find rows and cell execution on isolated staging; exercise MCP same-key progress polling and uncertain recovery; exercise retry, cancellation, run reconciliation, and queue capacity.
4. Complete security review, CSP decision, encryption-key rotation rehearsal, and dependency/history scans.
5. Prove database backup/restore, migration rollback, monitoring, incident ownership, and customer-support handling.
6. Publish legal/privacy/retention terms and validate workspace export/deletion against all configured providers and backups.
7. Run staging, failure, load, accessibility, and recovery exercises; then invite a controlled beta cohort.

## Related repository references

- [Deploy to Vercel with Neon](deploy.md)
- [Data handling inventory](data-handling.md)
- [Operations runbook](operations-runbook.md)
- [Development architecture and checks](development.md)
- [Treg retirement note](treg-provider.md)
- [Security policy and current operating assumptions](../SECURITY.md)
