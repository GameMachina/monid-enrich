# Security

## Report a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/GameMachina/monid-enrich/security/advisories/new) for vulnerabilities in Monid Enrich. Include the affected commit, reproduction steps using synthetic data, likely impact, and any suggested mitigation. Do not put vulnerabilities or credentials in public issues or pull requests. If private reporting is disabled for this repository, ask a maintainer to enable it before sending sensitive details.

If the private reporting form is unavailable, contact a repository maintainer through GitHub and ask for a private security channel. Do not send secrets or production data, or put exploit details in a public issue.

Security fixes target the latest code on `main`; older snapshots do not have a separate backport commitment. This project does not currently promise a response deadline or operate a bug bounty program.

## Data and credentials

| Mode | Storage and access |
| --- | --- |
| Self-hosted browser workspace | A random HttpOnly cookie identifies the workspace. Manually entered provider keys live in workspace-partitioned browser local storage and are forwarded to server API routes. Sheets and rows live in embedded PGlite or the configured Postgres database, with IndexedDB as a browser cache. |
| Managed organization | Clerk authenticates users and selects the active organization. Monid/Treg/OpenAI workspace credentials are encrypted in Postgres using a server-only encryption root. Members share sheets and workspace connections. |
| MCP | One full-access key per workspace. Authentication uses a hash; a recoverable copy is encrypted in Neon. Treat this key as a credential for all sheets and saved provider connections in that workspace. |

The self-hosted cookie is the workspace credential. Clearing it loses browser access to that workspace; exporting sheets provides a transfer path. Self-hosted mode does not provide organization accounts or cross-device recovery.

Requests send only the fields required for the selected operation to the explicitly selected provider (Monid or Treg); optional reasoning sends the prompt and row values to the workspace's configured OpenAI key. Personal AgentWeb actions use the connected member's AgentWeb account. Consult each provider's data policies before using sensitive records. Custom OpenAI-compatible endpoints receive the inputs sent to them. Browser local storage is readable by JavaScript running on the same origin; use a trusted deployment and browser profile.

## Operating a deployment

- Keep `.env.local`, database connection strings, private keys, browser profiles, traces, and provider credentials outside Git and release archives.
- Use the managed Clerk identity mode and shared PostgreSQL vault for customer data; do not expose a self-hosted browser workspace as a shared hosted SaaS.
- Use a dedicated Neon database and a separate development branch/database for tests. Apply migrations before deploying code that uses new tables.
- Use HTTPS for remotely hosted instances. Restrict network or hosting access if the instance is private: the deployment password protects server-supplied provider keys, not the entire application or database provisioning of anonymous workspaces.
- Keep `ENRICHABLE_MCP_ENCRYPTION_SECRET` stable and backed up. All servers sharing a database need the same value; changing it requires re-encrypting saved secrets first.
- Rotate MCP keys and revoke provider credentials when exposed. Rotating the hosted session secret invalidates existing signed sessions; logout alone does not revoke a copied cookie or organization provider credentials.
- Review the [production setup guide](docs/production-setup.md) before enabling public signup or billing.

See [MCP access and rotation](docs/mcp.md) for key scope, member access, expiration, and execution limits.
