# Monid Enrich rebuild: reference, architecture, and gaps

This document records the public-reference analysis and the independent implementation plan for the Monid Enrich fork. The reference is the public [Context.dev Enrichable repository](https://github.com/context-dot-dev/enrichable) and its visible app flows; no hidden source or credentials are used. The product name, provider policy, deployment defaults, and application-owned code in this fork are independent.

## Public UI and workflow inventory

The reference is a spreadsheet-first research app. Its strongest visual cues are a quiet white and warm-gray canvas, compact 13–14 px labels, thin neutral dividers, restrained blue actions, a persistent left navigation rail, and a dense editable grid. Menus and dialogs use small rounded corners and subtle shadows rather than large promotional cards. The fork retains those layout and interaction patterns while replacing provider and product branding.

| Screen / route | Visible elements and interaction | Implementation surface |
| --- | --- | --- |
| Landing `/` | Product statement, spreadsheet preview, feature overview, workflow steps, calls to open the app and source | `src/app/page.tsx`, shared design tokens |
| Workspace `/app` | Sidebar, sheet list, search/create/import actions, templates, usage and settings entry points | `src/components/app/sheets-page.tsx`, `sidebar.tsx` |
| Sheet `/app/sheets/[id]` | Sheet toolbar, name, row count, find rows, add-column controls, filters/sort, spreadsheet grid, row/cell selection, run status | `src/components/sheet/sheet-page.tsx`, `grid.tsx`, `sheet-page-grid.tsx` |
| Cell detail | Selected cell value, operation/result state, timestamp, reasoning, confidence, sources, provider run and usage metadata; edit, rerun, and close actions | `cell-panel.tsx`, `cell-view.tsx` |
| Add/edit column | Natural-language column composer, operation-specific fields, referenced-column templates, dependency previews, formula and enrichment configuration | `column-editor.tsx`, `column-op-fields.tsx`, `column-operations.ts` |
| Find rows | Company or people prompt, country/size filters, target amount, streaming progress, deduplication, cancel and continue | `company-editor.tsx`, `populate-client.ts`, `/api/populate` |
| Import/export | CSV, TSV, JSON, and XLSX import; CSV, XLSX, and JSON export; create from blank or template | `import-csv-dialog.tsx`, `src/lib/xlsx.ts`, export actions |
| Configuration | Workspace and connection status, Monid health/balance, optional OpenAI key, model/preferences, MCP access | `settings-page.tsx`, `connections.tsx`, `keys-dialog.tsx` |
| Mobile provider strategy | Workspace route allowlist, member default strategy, column-level strategy or no-match waterfall; run costs still belong to the workspace Monid wallet | `settings-page.tsx`, `member-settings-store.ts`, `column-op-fields.tsx`, `contact-providers.ts` |
| First-use connection dialog | Required Monid connection, optional OpenAI connection, encrypted-save explanation, key test and clear unsupported-feature messaging | `keys-dialog.tsx` |
| Login/session boundary | Standalone local workspace initialization; no upstream OAuth in this fork | `src/proxy.ts`, `session-boundary.tsx` |

### Visual and interaction specification

- **Shell:** fixed, narrow sidebar with workspace controls; main content uses the remaining viewport and keeps the current sheet visible while panels open.
- **Grid:** spreadsheet-like row/column headers, compact row height, sticky headers/selection affordances, virtualized rows, keyboard navigation, contextual menus, and clear source-versus-enriched column treatments.
- **Density:** favor compact controls and text; use larger spacing only in dialogs, setup, and landing content. Thin borders carry most of the hierarchy.
- **Color:** neutral canvas/surface, muted secondary text, near-black primary text, blue primary actions, and semantic success/warning/error color for provider and cell states.
- **Dialogs and menus:** anchored menus for local actions; focused dialogs for imports, connection setup, and destructive confirmation. Keep action labels and descriptions short.
- **Cell provenance:** show the answer first, then confidence/status/time and source links; provider run and actual cost details remain inspectable without crowding the grid.
- **Workflow:** create/import/find rows → add columns → wait for per-cell results → inspect evidence → edit or rerun selected cells → filter/sort → export.

## Data model and invariants

- A workspace owns its sheets, columns, rows, settings, encrypted provider credentials, run records, and usage metadata.
- The workspace controls which Monid mobile routes are allowed. Each member has a private default strategy, and a saved mobile column snapshots its own strategy. Monid requests use the workspace credential and are billed to that workspace.
- Columns are either source data, formulas, or enriched operations. An operation records its definition and referenced-column dependencies.
- Each cell stores its value plus status, update time, errors, source URLs, confidence/reasoning, Monid run receipts, and an input/operation fingerprint. Editing an input marks affected dependent results outdated; a rerun is explicit.
- Sheet and row edits use revision-aware writes and app-side idempotency keys. Duplicate requests with the same key resolve to the recorded operation; stale revisions produce a conflict for safe refresh/retry.
- The local standalone workspace partitions data by a hashed workspace identity and persists sheets/rows in embedded PGlite at `.data/database`; saved API keys remain in the encrypted local vault. Hosted and multi-instance deployments use the shared workspace schema and database vault through PostgreSQL.
- Monid run persistence stores the run ID, endpoint, status, cost/usage, result count, error summary, timestamp, and a hash of inputs rather than duplicating row prompts in the run ledger.

## Proposed architecture and implementation stages

The default local backend is disk-backed embedded PGlite, using the same PostgreSQL schema and migrations as the hosted backend. `DATABASE_URL` selects Neon/PostgreSQL for shared or multi-instance deployments. SQLite was considered, but the existing persistence layer uses PostgreSQL-specific JSONB and transaction behavior; an SQLite adapter would require a broader schema/query rewrite.

1. **Reference and shell:** inventory the public screens and preserve the compact spreadsheet visual system while replacing product copy, links, and logos.
2. **Standalone workspace:** initialize a local workspace without upstream identity services; retain workspace scoping for sheets, rows, columns, operations, settings, and run metadata.
3. **Provider boundary:** keep a typed server-only Monid adapter. All company, people, web, and contact-data calls submit through Monid `/v1/run`; saved API keys never leave the server. The only optional model path is the workspace member's own OpenAI key.
4. **Run lifecycle:** persist Monid receipts and poll asynchronous runs by their returned ID. A network-uncertain submission is surfaced as uncertain and never automatically submitted a second time. Cell and sheet actions keep revision and idempotency checks.
5. **Spreadsheet workflow:** retain import/export, formulas, templates, filters, sorting, cell editing, dependency-aware enrichment, provenance, and reruns.
6. **Verification and gap review:** typecheck, lint, unit/server checks, production build, then a local browser walkthrough of first-use setup, sheet grid, a cell detail view, and import/settings. Review Monid API and unsupported-operation gaps before adding new enrichment operations.

## Monid API review

Endpoints were discovered and inspected through Monid's current catalog before their adapters were added. Requests use a Monid API key as a server-side Bearer credential. The adapter calls Monid `POST /v1/run` with `{ provider, endpoint, input }`; asynchronous responses return a run ID and are checked through `GET /v1/runs/{runId}`. Wallet health uses `GET /v1/wallet/balance`. See the [Monid run API](https://docs.monid.ai/api/run.html), [run status API](https://docs.monid.ai/api/runs.html), and [wallet API](https://docs.monid.ai/api/wallet.html).

| App capability | Monid provider / endpoint | Inspected request shape | Catalog pricing reviewed |
| --- | --- | --- | --- |
| Natural-language company search | `context.dev` `POST /company/search` | Body: `query` (required), `mode`, `filters` (countries, employee range), `cursor` | Fast: 2 credits/page ($0.004); ultra: 10 credits/page ($0.02); $0.002/credit; empty results free |
| Company profile | `context.dev` `GET /brand/retrieve` | Query: exactly one of domain, name, ticker, email, or direct URL; optional speed/cache/language settings | 10 credits/call ($0.02) |
| Natural-language people search | `context.dev` `POST /people/search` | Body: `query` (required), `mode`, `filters` (countries/experience range), `cursor` | Fast: 10 credits/page ($0.02); ultra: 50/page ($0.10); $0.002/credit |
| Person enrichment | `context.dev` `POST /people/enrich` | Body clues: `social_urls`, `name`, `email`, `company`, `education`, `location`, `timeoutMS` | 20 credits per matched person ($0.04); not-found is free |
| Web search | `context.dev` `POST /web/search` | Body: `query` (required), result count, domains, freshness, country/languages, optional Markdown and timeout controls | 1 credit per 10 returned results, rounded up; returned Markdown adds 1 credit/result; no results free |
| Web scrape | `context.dev` `POST /web/scrape` | Body: `url` and `formats` required; output-specific params for Markdown, HTML, images, JSON, parsing, highlights, etc. | 1 credit base; add-ons vary by output (e.g. highlights +1, JSON extraction +4 on success) |
| Website URL map | `context.dev` `GET /web/urls` | Query: `domain` required; max links, sitemap, filters, optional search | 1 credit/call; 2 with search |
| Work email finder | `hunterio` `GET /email-finder` | Query: domain or company and first/last or full name; optional LinkedIn handle and max duration | $0.0245 per found result; no-find free; returns score, verification, and public sources |
| Work email finder | `anyapi` `POST /email_finding.quickenrich` | Body: LinkedIn URL, or company domain + first and last name | $0.0072/call |
| Work email finder | `apollo` `POST /people/match` | Query parameters: name or LinkedIn URL plus company domain/name; phone reveal is not enabled | $0.026/call; no-match may still bill when attached to a known company |
| Work email finder | `anyapi` `POST /person_enrichment.prospeo` | Body: LinkedIn URL, or full name + company website; `onlyVerifiedEmail: true` | $0.066/call |
| Work email finder | `contactout` `GET /v1/people/linkedin/work-email` | Query: LinkedIn profile and work email type | $0.10/call; documented 404 no-match is free |
| Email verification | `anyapi` `POST /email.verify` | Body: `email` required; optional `route` | $0.0066 per valid-address verdict; malformed/reserved addresses rejected without charge |
| Mobile lookup (LeadMagic) | `anyapi` `POST /mobile_phone.leadmagic` | Body: one of `profileUrl`, `workEmail`, `personalEmail`, `email`; optional `route: "leadmagic"` | Listed at $0.2016/call; no-match is billable; inspected catalog latency was p50 5.3s / p95 8.2s; adapter polls any nonterminal run receipt |
| Mobile lookup (Clay) | `clay` `POST /enrichment/mobile-phone` | Body requires `Social Profile URL`, `Full Name`, and `Company Name`; optional company domain and emails | Listed at $0.568/call; no-match is not billed; asynchronous and can take up to about 3 minutes; catalog marked degraded during inspection |
| Mobile lookup (AI Ark) | `anyapi` `POST /mobile_phone.ai_ark` | Body: LinkedIn URL or company domain + full name | $0.084/call |
| Mobile lookup (Reverse Contact) | `reversecontact` `POST /v2/contact/phone` | Body: LinkedIn URL, or full name + company domain | $0.10 when a number is found; miss free; asynchronous response is polled |
| Mobile lookup (Prospeo) | `anyapi` `POST /person_enrichment.prospeo` | Body: LinkedIn URL, email, or name + company; `enrichMobile: true` | $0.066 base + $0.5892 when a mobile is found |
| Social profile search | `context.dev` `POST /people/enrich`; `context.dev` `POST /web/search` | Identity clues; web search restricts results to the selected network host | People enrichment: 20 credits ($0.04) per match, no-match free; web search: 1 credit per 10 results ($0.002) |
| LinkedIn profiles | `apify` `POST /harvestapi/linkedin-profile-search-by-name`; `ploid` `POST /linkedin/search`; `anyapi` `POST /linkedin.search_profiles_thin` | Name and optional current company; short profile mode / thin results | $0.008/result; $0.01/result; $0.032/call respectively |
| Instagram profiles | `anyapi` `POST /instagram.search_profiles`; `tikhub` `GET /api/v1/instagram/v1/fetch_search` | Query; TikHub uses `select=users` | $0.0012/call; $0.001/call |
| Facebook profiles | `litescrape` `GET /facebook/search-profiles` | Query name and result limit | $0.00015/call |
| X accounts | `anyapi` `POST /twitter.search_users` | Query matched against handles, names, and bios | Default route is $0.0001 + $0.0001/result; catalog also offers a $0.00049/call route |
| TikTok profiles | `anyapi` `POST /tiktok.search_users`; `tikhub` `GET /api/v1/tiktok/web/fetch_search_user` | Query or keyword | $0.0006/call; $0.001/call |
| YouTube channels | `tikhub` `GET /api/v1/youtube/web_v2/search_channels`; `litescrape` `GET /youtube/search` | Keyword; Litescrape sets `type=channel` | $0.001/call; $0.00015/call |

Catalog prices and endpoint schemas can change. Mobile endpoint details and listed prices above were reviewed on 2026-11-22. The product displays Monid's run-reported cost and usage for actual calls and does not promise a fixed per-cell price. App-side automatic retries do not resubmit an operation whose Monid outcome is uncertain; no upstream idempotency guarantee is assumed. Mobile waterfalls continue only after Monid confirms a completed no-match; transport failures, provider errors, and uncertain timeouts stop the chain to prevent an accidental second charge.

## Prioritized implementation plan and current status

| Priority | Stage | Status |
| --- | --- | --- |
| P0 | Standalone identity/workspace, branding, secure server-side Monid and optional OpenAI connections | Implemented |
| P0 | Monid-only data provider path, run polling, usage/provenance, failure states, safe no-resubmit behavior | Implemented; manual run with a real Monid key remains unverified |
| P0 | Spreadsheet shell, edit/import/export, natural-language company/people search, operation columns, cell details | Implemented; local visual review remains |
| P1 | Close reference match for all menus/dialogs, responsiveness, formula/filter/sort behavior, and templates | Existing reference-derived components retained; verify during browser walkthrough |
| P1 | Dedicated email, phone, and social columns with ordered Monid provider waterfalls | Implemented; live paid runs remain unverified |
| P1 | Workspace mobile route allowlist, member default, per-column override for legacy person columns, and safe LeadMagic/Clay no-match waterfall | Implemented; verify against a live workspace key before production use |
| P1 | Reconcile the starter tests with the standalone provider boundary and remove stale provider-specific assumptions | In progress |
| P2 | Improve XLSX compatibility beyond the first worksheet/basic cell values and document round-trip limits | Gap |
| P2 | Add expanded formula coverage and more reference templates after core workflow review | Gap / review after walkthrough |
| P2 | Add Monid endpoints only after catalog discovery and endpoint inspection | Ongoing operational requirement |

## Known gaps and limitations

- XLSX import currently reads the first worksheet and common cell values; workbook formulas, formatting, merged cells, and multi-sheet fidelity are not fully preserved.
- Some saved legacy operation names remain for compatibility. Each supported data operation routes through Monid. The dedicated phone column supports five Monid routes. Social lookup currently exposes LinkedIn, Instagram, Facebook, X, TikTok, and YouTube; Threads, Bluesky, and other networks remain unsupported until suitable Monid routes are discovered and inspected.
- Monid does not expose a documented idempotency token on the run request in the API reviewed. Therefore an uncertain POST is not automatically repeated; the user may need to reconcile it in Monid run history.
- Natural-language discovery without an OpenAI key uses Monid search directly. The optional OpenAI path can plan/paginate a query, but its reasoning and token charges are separate from Monid data usage.
- API/provider failures are mapped into cell and connection statuses; exact upstream latency and cost depend on the selected Monid endpoint and returned result.
- The fork has not been deployed or published. Its app name is Monid Enrich and its source link points to this fork.
