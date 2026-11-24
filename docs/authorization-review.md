# Authorization and request-boundary review

Static source review performed 2026-11-24. This documents the current managed-app boundary; it is not a penetration test or a substitute for staging cross-workspace tests.

## Baseline boundary

- `src/proxy.ts` requires a Clerk session for managed `/app` pages and `/api/*` routes, except health, Stripe webhook, and the internal jobs worker. API requests must carry the current account partition and session ID. Mutating API requests must have an `Origin` exactly matching the request origin; the Stripe webhook uses Stripe signature verification instead.
- In self-hosted mode, the same proxy boundary uses the signed local session cookie, account partition/session binding, and the configured host origin. Initialization and health endpoints have their documented bootstrap exceptions.
- `apiRoute` resolves the signed-in account server-side, checks that its workspace is active, derives the workspace ID from issuer and organization ID, and returns no-store responses. Database reads/writes use workspace-scoped tables and composite keys. Request-provided workspace IDs are not used as an authorization principal.
- Provider credentials are loaded from the server-side workspace vault. Organization preference/credential mutations require `owner` or `admin`. Error responses are redacted and carry request IDs.

## Privileged managed routes

| Route family | Server-side role/action check |
| --- | --- |
| `/api/organization-settings` writes | Workspace owner/admin |
| `/api/treg/billing`, `/api/treg/topup` | Workspace owner/admin; charges the separate Treg balance |
| `/api/treg/connections/**` mutations and OAuth start | Workspace owner/admin |
| `/api/billing/**` mutations | Workspace owner/admin; app subscription only |
| `/api/mcp-key` writes | Workspace owner/admin |
| `/api/workspace/export`, `/api/workspace` delete | Workspace owner/admin |
| `/api/usage` | Workspace owner/admin; provider receipts remain workspace-scoped |
| `/api/audit` | Workspace owner/admin; returns at most 100 metadata-only activity records |

Sheet reads/writes, row enrichment, job status/cancellation, member preferences, verification, and provider-backed search use a signed-in workspace member. Per-cell job cancellation additionally requires the job owner or an admin.

## Service-authenticated exceptions

| Route | Authentication |
| --- | --- |
| `/api/health/live`, `/api/health/ready` | Public; expose only readiness booleans, never infrastructure secrets |
| `/api/stripe/webhook` | Stripe webhook signature; bounded request body; event IDs deduplicated in storage |
| `/api/clerk/webhook` | Clerk/Svix signature via Clerk `verifyWebhook`; bounded payload; delivery IDs deduplicated in storage; only organization membership/invitation events are retained |
| `/api/internal/jobs/run` | `CRON_SECRET` bearer token |
| `/mcp` | Workspace MCP key; tool calls load the key's workspace identity and do not accept caller-supplied provider secrets |
| `/api/auth/**` | Signed flow state, provider callback validation, and session-cookie rules appropriate to the flow |
| `/api/admin/credits` | Separate operator authorization in `credit-report.ts`; not a customer workspace API |

## Server-side fetch and provider boundary

- User-selected OpenAI endpoints pass through the DNS/IP and protocol guard in `credentials.ts` before connection/use.
- Company-context research only uses the verified, saved workspace company domain and same-origin pages discovered from it.
- External research/enrichment calls go through the Monid or Treg adapter. Treg requests are fixed to `https://treg.to`; no request-supplied host is accepted.
- The web-scraping/search transport is provider-side Monid, so the app does not fetch an arbitrary row-provided URL directly. Review this again if a direct fetcher or new provider adapter is added.

## Remaining verification

- Add staging tests that attempt cross-workspace reads, writes, exports, job polling/cancellation, MCP calls, and provider spend using two real test organizations.
- Verify removed Clerk members lose access from already-open tabs and old account headers.
- Verify hostile-origin writes fail in both managed and self-hosted modes, and OAuth callbacks reject state replay or unapproved redirect URIs.
- Complete an independent SSRF and secrets review, including preview deployments, custom self-hosted domains, DNS rebinding, and every newly added URL input.
- Keep this matrix synchronized when routes or auth modes change. A static route list cannot prove upstream Clerk, Stripe, Vercel, or provider account configuration.
