# Mallet

The production build of Mallet — an AI-native operating system for service businesses
(lead → quote → dispatch → invoice). Rebuilt from the `elas-crm-prototype.html` prototype,
which serves as the product spec.

## Stack

- **TypeScript** everywhere · **Next.js** (App Router) modular monolith
- **Supabase** (Postgres + Auth + RLS + Storage) · **Drizzle** (migrations-as-code)
- **tRPC** (typed API) + **Zod** DTOs · **repository pattern** behind interfaces
- **Stripe** (Connect), **Twilio** + voice agent (AI front desk), **Claude** (AI), **Inngest** (durable workflows) — added in later phases
- Tenant isolation via **Postgres Row-Level Security** (`org_id` enforced at the DB)

## Architecture (one deployable, hard internal boundaries)

```
app/            Next.js routes + tRPC HTTP handler + webhooks + health
trpc/           tRPC composition root + middleware (auth, rbac, ratelimit, org-tx)
modules/        bounded contexts: identity, customers, quoting, jobs, invoicing,
                frontdesk, ai, notifications, accounting-sync
                  domain/ = entities + validation (pure) + repository INTERFACES + events
                  app/    = use-cases (DI) + event handlers
                  infra/  = Drizzle repository IMPLs
                  api/    = tRPC router + Zod DTOs + mappers
                  index.ts = the ONLY import seam (enforced by ESLint, T0.2)
platform/       adapters/ (Stripe, Twilio, Resend, Vapi, Anthropic, QBO) + resilience/
workflows/      Inngest durable jobs (reminders, qbo sync, fd-hold expiry, nightly summary)
shared/         db (schema, migrations, client, tx, repository-base), ports, types, observability
docs/adr/       architecture decision records
```

Full plan: `../docs/superpowers/plans/2026-06-30-mallet-production-build.md`

## Develop

```bash
pnpm install
cp .env.example .env.local   # fill in Supabase + DATABASE_URL
pnpm dev                     # http://localhost:3000
pnpm typecheck
pnpm test
pnpm db:generate && pnpm db:migrate
```

## Status

- **Phase 0 — T0.1 (scaffold):** done — workspace, module tree, configs, booting Next app.
- Next: T0.2 ESLint import-boundary gates · T0.3 `shared/types` (branded ids, Money, Result) · T0.4 fail-fast config · then DB + RLS, auth, and the first vertical slice (Customers).
