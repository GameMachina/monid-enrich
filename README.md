# Monid Enrich

Monid Enrich is a standalone spreadsheet for company and people research. Build or import a list, add research and enrichment columns, inspect sources and confidence in each cell, then export the sheet.

## Run locally

Requires Node.js 22.23.4 or newer in the 22.x line.

```sh
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The app creates a workspace automatically and persists it in an embedded, disk-backed database under `.data/database`. Connect Monid or Treg from **Configuration → Connections** to use that provider's supported data operations. Spreadsheet editing, formulas, templates, imports, and exports work without provider keys. OpenAI is optional; connect your own key to enable reasoning-dependent features.

On a persistent self-hosted server, the app creates a private encryption key file under `.data/` when no secret is configured. Set a stable `ENRICHABLE_LOCAL_VAULT_SECRET` (at least 32 characters) to manage that key yourself. Ephemeral/serverless deployments require an explicit stable secret, or `DATABASE_URL` plus `ENRICHABLE_MCP_ENCRYPTION_SECRET` for the shared credential vault. A PostgreSQL `DATABASE_URL` is optional for a single self-hosted instance; the default embedded database is single-process and is not for multi-instance sharing. Set `DATABASE_URL` for a shared deployment and apply its schema with `npm run db:migrate`. `ENRICHABLE_LOCAL_DATABASE_PATH` changes the embedded database directory. See [.env.example](.env.example) for deployment settings.

The embedded store uses PGlite rather than SQLite because the workspace schema already relies on PostgreSQL JSONB queries and transactional behavior. It keeps local setup zero-configuration while reusing the same schema and migrations as the shared Postgres backend.

## Provider boundaries

- Monid and Treg are distinct, explicit data providers. Supported data columns choose Monid or Treg before they run; unsupported Treg operations stop with a clear message and never fall back to Monid.
- OpenAI is only used when a workspace member supplies an OpenAI key. It supports reasoning, classification, scoring, and natural-language row discovery. The app does not fall back to a different model provider.
- In managed mode, provider keys are encrypted in the server-side workspace vault. The browser receives connection status and masked metadata, never the saved key. Self-hosted browser mode has separate local-storage behavior; see [security](SECURITY.md).
- Monid and Treg keep separate connection, billing, usage, and run receipts. Cell provenance records the selected provider, run status, sources, and returned cost/usage where available. Uncertain Treg submissions reuse their saved idempotency key; they are never submitted as a new call automatically.
- Mobile phone enrichment supports LeadMagic and Clay through Monid, with workspace route access, each member's default strategy, and per-column overrides. Workspace Monid credentials bill the workspace wallet; actual costs are attached to the cell.
- Treg supports company and people discovery, company/person data, company funding events, web search and page reading, email and phone lookup, email verification, and public profile search across LinkedIn, Instagram, Facebook, X, TikTok, and YouTube. Some person fields, certain scrape modes, website country filters, and social actions are not supported; these gaps are reported without provider fallback.
- See [docs/treg-provider.md](docs/treg-provider.md) for Treg endpoint behavior, separate billing, and the current gap list.

## Spreadsheet features

- Create, rename, duplicate, filter, sort, and delete sheets; edit source and enriched cells; add formulas or operation columns.
- Import CSV, TSV, JSON, or XLSX (the first worksheet); export CSV, XLSX, or JSON.
- Search for companies and people from a natural-language description, then research each row with source links, status, confidence, and timestamps.
- Inspect a cell's result details, edit its value, or rerun it. Dependency-aware planning marks results outdated when their inputs or operation change.
- Use templates, formulas, filters, sorting, and row-level enrichment controls.

## Architecture and reference analysis

See [docs/rebuild-status.md](docs/rebuild-status.md) for the public UI and workflow inventory, visual specification, data model, architecture, provider operations reviewed, implementation stages, and known gaps.

The managed SaaS foundations are implemented, but the repository is not launch-ready until Clerk, Neon, Stripe, Vercel Cron, backups, monitoring, legal policy, and staging verification are configured. Track the remaining launch gates in the [production-readiness backlog](docs/production-readiness-backlog.md); see [production setup](docs/production-setup.md) before deploying.

## Development checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

The source is MIT licensed. Monid Enrich is an independent implementation and is not affiliated with or endorsed by the original Enrichable project.
