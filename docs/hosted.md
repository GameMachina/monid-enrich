# Hosted service notes

This file previously documented the original Enrichable service's private Context.dev OAuth, sponsored-credit programs, and internal operations. Those instructions do not apply to the Monid Enrich fork and have been removed to avoid accidental use of obsolete credentials or workflows.

For this fork's managed SaaS setup, use [production setup](production-setup.md). The current managed identity is Clerk Organizations; product billing is Stripe; spreadsheet/provider storage is workspace-scoped Postgres; and Monid is the sole external data provider. Monid uses a workspace API key, not OAuth. Review the [production-readiness backlog](production-readiness-backlog.md) before onboarding customers.
