# Deploy to Vercel with Neon

For a customer-facing hosted deployment, follow the complete [production setup guide](production-setup.md). It covers Clerk Organizations, Stripe billing, the encrypted credential vault, durable enrichment jobs, separate staging/production databases, readiness checks, and the launch blockers that still need external verification.

The Vercel build command checks `npm run check:production-config` before `npm run db:migrate && npm run build`. Keep that production gate enabled and validate migrations on a separate staging database first. Vercel previews must never share the production `DATABASE_URL`, Clerk app, or Stripe keys. The app uses Neon/Postgres for shared managed workspaces; embedded PGlite is only for local, single-process development or a private self-hosted instance.

This repository is not ready for a one-click public SaaS launch just by connecting Neon. Production requires the additional service settings and operator verification listed in [production setup](production-setup.md). Do not deploy public signup until `/api/health/ready` reports ready and the backup/restore, billing, queue, security, and support launch gates have been completed.
