# Treg provider support

Treg is an independent data provider with its own API credential, team balance, billing/top-up flow, run receipts, and usage history. It is selected on an email, phone, or social lookup column. The server never substitutes Monid for a selected Treg operation or combines the two providers' billing.

## Connection and billing

Connect Treg from **Configuration → Connections**. The key is encrypted server-side and scoped to the workspace. Configuration shows Treg's team balance and recent Treg calls separately from the Monid wallet and receipts. Top-ups start at Treg's `POST /billing/topup` endpoint and continue on a Treg-hosted Stripe checkout page; this app does not collect payment details. Treg reports the new balance after payment confirmation.

## Supported operations

Schemas and authentication were checked against the public [Treg API documentation](https://treg.to/docs) and [OpenAPI schema](https://treg.to/openapi.json) on 2026-11-22. REST requests use `X-Treg-Token` and `/call/{endpoint}`. Current operations in the adapter:

| Column | Treg endpoint | Inputs sent | Billing notes shown in the editor |
| --- | --- | --- | --- |
| Find email | `treg.people.email.find` | Full name + domain, or LinkedIn URL; optional company context | Misses are free; successful lookup price varies by result, up to about $0.15. |
| Find phone number | `treg.people.phone.find` | LinkedIn URL, email, or full name + domain | Some failed provider attempts may still bill; each request is capped at $0.10. |
| Find social · LinkedIn | `harvestapi.linkedin.profile.search` | Name, optional company and domain | About $0.004 per request, based on the inspected route catalog. |
| Find social · Instagram | `treg.instagram.search.users` | Query from name, company, and domain | Variable provider pricing; request is capped at $0.10. |
| Find social · TikTok | `treg.tiktok.search.users` | Query from name, company, and domain | Variable provider pricing; request is capped at $0.10. |

Cost caps are sent as Treg route headers where supported. Actual charge, run status, and route metadata come from Treg's response and are displayed in the cell when returned. Source URLs and confidence/match metadata are retained when present.

## Run safety and records

Every Treg call is sent with an app-generated `Idempotency-Key`. Treg documents replay protection for 24 hours; retries within that window reuse the same key only when the input/operation fingerprint still matches. Changing the inputs or operation creates a new key. Asynchronous calls persist the Treg call ID, are polled through `/calls/{call_id}/result`, and are not resubmitted while still active or uncertain.

Cell details show the selected provider, Treg endpoint, call ID, status, cost, source links, confidence, and duration when available. Workspace usage is stored in `enrichable.treg_runs` with an input hash rather than row values. Monid receipts remain in `enrichable.monid_runs`; a Treg call is never written to the Monid ledger.

## Known gaps

The adapter currently does not support Treg company search/enrichment, general web search or scraping, email verification, Facebook/X/YouTube profile search, or any social posting/action workflow. It does not support advertising workflows or Treg's broader route catalog yet. Selecting unsupported social networks reports the limitation before any request is sent. These gaps must remain explicit until an operation's Treg endpoint schema, authentication, sync/async behavior, and billing have been inspected and normalized.
