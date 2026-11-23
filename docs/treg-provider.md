# Treg provider support

Treg is a selectable data provider with its own credential, team balance, usage receipts, and run status. Every supported operation records `dataProvider: treg`; it never falls back to Monid or writes Treg charges to the Monid ledger. Provider schemas and route behavior were checked against the live [Treg API documentation](https://treg.to/docs), [OpenAPI schema](https://treg.to/openapi.json), and route catalog on 2026-11-23.

## Connection and billing

Connect Treg in **Configuration → Connections**. Its API key is stored server-side in the workspace credential vault. Balance, top-up, and usage views remain separate from the Monid workspace wallet. Treg top-ups continue through Treg-hosted checkout; the app does not collect payment details.

**Treg team connections** are managed separately at **Configuration → Connections → Treg → Manage providers**. The page loads Treg's live provider directory and lets a workspace member connect supported API keys or start Treg-managed OAuth, choose an account resource where applicable, rename, and disconnect connections. Submitted provider credentials go directly from the app server to Treg for validation and storage; they are not returned to the browser or saved in the app's credential vault. Treg team connections and their upstream provider billing remain separate from the Monid workspace wallet.

Metered calls use `X-Treg-Token` and `/call/{catalog-operation}`. Following Treg's [product integration guide](https://treg.to/integrate.md), each call also sets `X-Treg-Meta` from verified server context: `customer` and `workspace` are the same opaque workspace hash, and `feature` is the internal operation ID. No email or user-provided tag reaches Treg. The adapter sends an idempotency key, preserves Treg call IDs, statuses, cost/usage, routed service, source URLs, and confidence or match metadata when returned, and polls Treg calls when the response indicates an asynchronous run. Treg receipts are stored in `enrichable.treg_runs` with an input hash, not row values. Treg-stamped balance, route-cap, and spend-limit errors are normalized before they reach cell details so the app does not expose team billing data or top-up URLs.

Each workspace connects its own Treg API key, so Treg charges that key's team balance directly; the app does not pool a platform Treg wallet or invoice users for Treg costs. Columns with routed enrichment support a per-call maximum spend. Treg's org-level daily budgets and ledger-based `usage/by-tag` invoicing are not configured by this app today; those require a Treg org-admin billing model and should be added before switching to one platform-owned Treg key.

## Supported workflows

| App workflow | Treg route | Status and limits |
| --- | --- | --- |
| Find rows · companies | `treg.companies.search` | Natural-language query, country, limit, and cursor. Funding values are retained if the selected Treg route returns them; otherwise add a funding column to look them up separately. |
| Find rows · people | `treg.people.search`; `anyapi.linkedin.user.profile.full` and `treg.people.enrich` through Treg | Natural-language query, country, limit, and cursor. Full-profile lookup is enabled by default for Treg people searches, capped at $0.0042 per profile; a company-domain lookup is added only when missing and capped at $0.03. The combined estimate is up to $0.0342 per person, in addition to Treg search. It fills public education, skills, about text, experience years estimated from returned work dates, and company website when returned. Matching LinkedIn profiles already in the sheet are refreshed within the requested result count; only blank source cells are filled. Rows without a usable LinkedIn profile cannot be deduplicated into the people layout. |
| Find rows · websites | `treg.web.search` | Natural-language web search. Treg's route schema has no country filter, so the UI blocks country-filtered website searches. |
| Company suggestions | `companyenrich.companies.autocomplete` | Explicit Monid/Treg selector in the suggestions menu; Treg autocomplete is cataloged as free. |
| Company data | `treg.companies.enrich`, `companyenrich.companies.autocomplete`, `branddev.brand.retrieve` | Routed enrichment covers name, domain, website, description, industry, employee count/range, founded year, location, and LinkedIn. Treg's company profile route supplies additional brand facts and links where present. |
| Company funding | `predictleads.companies.financing_events` | Loads financing events (up to 1,000) for one domain at $0.04 per call. The sheet derives total raised from normalized amounts, count, and latest event details. The source labels `effective_date` as an extracted round date that may be null or inaccurate; check the source article for important decisions. |
| Company phone | `branddev.brand.ai.query` | Extracts the main public phone number from the company site. 10 Treg credits (catalog USD estimate $0.02534); analyzed page URLs are saved as provenance. |
| Company ticker | `treg.companies.enrich`, `finnhub.symbol.search` | Resolves the company name, then accepts only an exact normalized-name ticker match. Treg's Finnhub trial pool is 50 calls per team per day; catalog cost is $0 until that pool is exhausted. |
| Person data | `treg.people.enrich`, `treg.people.email.find`, `treg.people.phone.find` | Full name, title, company, company domain, location, LinkedIn, email, and mobile are supported through the appropriate Treg operation. The separate full LinkedIn profile route above can return education, skills, biography, and work history; experience years are estimated from the listed dates. |
| Find email | `treg.people.email.find` | LinkedIn URL, or name plus company domain. Treg reports misses as free; successful result price varies (catalog range up to about $0.15). |
| Find phone number | `treg.people.phone.find` | LinkedIn URL, email, or name plus company domain. The request cap is $0.90; unsuccessful routed attempts may still incur a charge. |
| Verify email | `treg.people.email.verify` | Returns validity/status and score when available. |
| Find social | `treg.web.search` | Searches public web results for LinkedIn, Instagram, Facebook, X/Twitter, TikTok, and YouTube profiles. This finds public profiles; it does not log in, publish, or take actions. |
| Web search | `treg.web.search` | Query, result limit, optional contents. Search results preserve result URLs and snippets. |
| Read a page | `treg.web.extract` | URL, Markdown/text, title, or URL output. Other Monid scrape modes are rejected as unsupported by Treg. |
| AI answer / deep research | Treg web routes plus the user's OpenAI key | OpenAI is still required for reasoning. The chosen Treg data route is explicit and billed separately; OpenAI is never substituted by another model provider. |
| Check / classify / score with a page | `treg.web.extract` plus the user's selected reasoning model | Treg supplies page evidence only. Reasoning still requires OpenAI. |

Treg route prices vary by routed source and result. For calls that can fan out, the adapter passes the inspected $1 per-call maximum where supported. The column editor identifies the selected provider and balance; cell details show returned costs and route metadata. Balance estimates are not guarantees of a final charge.

For Find email, Find phone number, and Find social columns, the Treg route waterfall can be enabled or disabled and capped by maximum spend. Treg chooses its own provider order and reports the providers tried; the app does not claim to control the route's individual provider ordering. Monid's separate provider waterfall remains independently configurable.

## Unsupported capabilities

The app does not currently wire Treg social publishing or advertising endpoints into Action Column or ad workflows; the Treg catalog has broader capabilities than this app currently exposes. AgentWeb actions and email sequence delivery remain separate integrations. Within the existing data-operation surface, unsupported Treg capabilities are the Person fields listed above, country-filtered website search, and Monid-only scrape modes (links, site map, raw HTML, images, email extraction, and phone extraction). The app reports those gaps and does not call Monid as a substitute.

Company-relative context research remains Monid-only today. Treg-selected operations skip that helper rather than make an undisclosed Monid request. PDF branding and the legacy organization-name resolver also remain Monid-only utility paths; they do not determine whether spreadsheet data columns can use Treg.
