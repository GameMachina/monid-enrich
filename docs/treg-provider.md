# Treg retirement

Treg is no longer a selectable provider in Monid Enrich. New connections, provider-directory access, top-ups, and enrichment calls have been removed. The old `/api/treg/**` endpoints return `410 Gone`; the old settings link redirects to Configuration.

Migration `027_retire_treg.sql` removes saved workspace Treg credentials and restores the allowed credential-provider set to Monid and optional OpenAI. Historical Treg run receipts remain in `enrichable.treg_runs` so prior usage can still be reviewed and exported. Those receipts are audit-only and cannot be retried or charged again by the app.

Existing sheet definitions that stored `dataProvider: "treg"` are normalized to Monid when parsed. New executions therefore require a connected workspace Monid key and are billed through Monid. Review converted columns before running them, because they will use the Monid route and wallet.

This app uses Clerk Organizations for workspace tenancy. It does not provide multi-tenant OAuth for Monid or social networks. Monid connects with a workspace API key stored in the server-side encrypted vault in managed mode.
