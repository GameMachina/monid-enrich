# Data handling inventory

This is an engineering inventory for the current app, not a privacy policy, DPA, or legal determination. Review it against the deployed configuration before making customer-facing promises.

## Data stored by the app

| Data | Where and purpose | Notes |
| --- | --- | --- |
| User identity and active organization | Clerk session, then workspace mapping in Postgres | Personal workspaces are separated from Clerk organizations. |
| Sheets, rows, columns, formulas, and cell results | Workspace-scoped Postgres; browser IndexedDB cache | Cell results can contain prospect data, sources, confidence, provider status, errors, timestamps, and input fingerprints. |
| Workspace settings and provider connections | Postgres; managed-mode provider credentials are encrypted server-side | Raw credentials are not returned to the browser in managed mode. Protect the encryption root and database backups. |
| Monid and Treg run receipts | Postgres | Receipts include operation/provider identifiers, status, usage/cost when available, hashed input references, and (for new cell runs) member/sheet/row/column IDs. No prompts or row contents are copied to the usage ledger. Provider billing remains separate. |
| Durable enrichment jobs | Postgres | Stores workspace, actor, sheet/row/column IDs, operation fingerprint, status, lease, and safe error summary. It should not store full row contents in the job record. |
| Stripe subscription state | Postgres, keyed to workspace; Stripe stores payment method and invoice details | The app stores customer/subscription IDs, price, status, period end, and cancellation state, not card numbers. |
| AgentWeb connection | Personal member credential store | It is billed to that member's AgentWeb account and is outside workspace export/deletion. |
| MCP access keys | Postgres hash and encrypted recoverable key | Treat as access to the workspace. They are not included in the export. |

Self-hosted mode has different risks: provider keys can be held in browser storage, the local database is single-instance, and workspace access may depend on the local browser identity. Use managed Clerk mode and shared Postgres for customer SaaS.

## Data sent to external services

- The selected Monid or Treg operation receives the row fields and operation inputs needed for that request. The app records the selected provider and does not silently switch one provider to the other. Provider receipts/provenance vary by endpoint.
- A user-configured OpenAI key is used only for reasoning-dependent operations. The prompt can include relevant row values and provider-sourced research text.
- AgentWeb receives the inputs for the member's explicit action. The member's AgentWeb balance is separate from Monid, Treg, and the app subscription.
- Clerk receives authentication and organization-management traffic. Stripe receives subscription/customer metadata and handles payment methods. Vercel hosts the application; Neon stores its shared database.
- Optional analytics is controlled by the app's configured public analytics client ID. Confirm its enabled state and applicable data policy in the deployment.

## Export and deletion behavior

Workspace admins can download a JSON workspace export from Configuration. It includes sheets, safe workspace settings, shared company reference data, and up to 10,000 recent receipts per data provider. It deliberately excludes raw credentials, personal member settings, and MCP keys, is limited to 50 MB, and is audited.

Workspace admins can also filter provider receipts by provider, status, time, member, sheet, or search text and download up to 10,000 matching records as CSV. Provider cost is shown only when a receipt reports it. This report is not provider-side billing reconciliation.

Workspace closure is a soft close: active provider jobs must finish first and the Monid Enrich subscription must be canceled and confirmed by Stripe; queued jobs are cancelled; workspace sheet/settings and shared connections are removed; provider receipts and Stripe reconciliation state are retained. Personal AgentWeb credentials, Clerk account records, Stripe payment records, database backups, provider-side copies, and legal records follow their respective service and retention policies. This is not yet an end-to-end account deletion workflow.

The application does not currently enforce a configurable retention window or purge old receipts/backups. Do not promise a deletion period until database, backup, Stripe, Clerk, Monid, Treg, OpenAI, and AgentWeb retention has been reviewed and implemented as required.
