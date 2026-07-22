# Mallet — project brief for Claude sessions

Mallet is a production field-service SaaS for small trade shops (1–50 people; go-to-market
beachhead: 1–3 tech plumbing service shops). Core loop: lead → quote → dispatch → invoice,
strictly ONE-OFF jobs (no recurring jobs/memberships/routes — deliberate). Prod:
https://mallet-app-snowy.vercel.app (auto-deploys on push to `main`). Owner: Owen (GTM
engineer; solo reviewer — open PRs, he merges).

## Stack

Next.js 16 (App Router, all pages `"use client"` under server-guarded layouts) · tRPC v11 ·
Drizzle + Supabase Postgres with RLS · Zustand store · Vitest (+ separate integration config) ·
Tailwind-free hand-rolled CSS (prototype-faithful).

## Architecture — follow these patterns exactly

- **Hexagonal modules** in `modules/<domain>/{domain,app,infra,api}` + barrel `index.ts`.
  `modules/companies/` is the canonical template. Layers: router (thin transport) → use-case
  (DI-constructed, returns `Result`) → domain (immutable value objects, `create → Result`,
  no throws for expected validation) → Drizzle repository (org-scoped).

  **Module inventory (17 modules):**
  - `accounting-sync` — QuickBooks Online sync (customers, invoices, payments)
  - `ai` — LLM agent loop, MCP server, Anthropic client, run-agent-turn, write-tools
  - `checklists` — job checklists (create, assign, complete items)
  - `companies` — canonical template module; org company profile
  - `customers` — lead lifecycle, lead sources, ensure-customer deduplication
  - `frontdesk` — AI voice front desk: Vapi webhook, call records, crew-schedule availability
  - `identity` — auth, principal resolution, Supabase token verification
  - `inbound` — web-form lead intake endpoints, per-token throttle, lead receipts
  - `invoicing` — invoices, invoice lines, payments, status transitions
  - `jobs` — jobs, job visits (scheduling board), field-tech surface
  - `messaging` — Twilio SMS in/out, message threads, unread tracking
  - `notifications` — notification dispatch (Twilio, Resend), follow-up policy, reminders
  - `pricebook` — services, categories, materials, cost rollups
  - `quoting` — estimates, tiered GBB lines, edit-delta learning, proposal summaries
  - `settings` — org settings, booking config, service lanes, branding
  - `tasks` — tasks / reminders (cursor-paginated, due-date sorted)
  - `timesheets` — time entries (clock-in/out, job-linked, tech-scoped)

- **Tenant safety (non-negotiable):** org id ALWAYS from `ctx.principal.orgId`, never client
  input. Every org-scoped table has `org_id` + hand-written RLS (`ENABLE` + `FORCE ROW LEVEL
  SECURITY` + `FOR ALL USING/WITH CHECK (org_id = current_org_id())`). drizzle-kit does NOT
  emit RLS — every new tenant table needs a hand-written RLS migration. Child tables use
  composite FKs `(org_id, parent_id) → parent(org_id, id)`. Repos also filter `eq(orgId)`
  explicitly (defense-in-depth + index use).
- **Org transaction:** the `ownerOrOffice` procedure runs inside `withTenant` (sets
  `app.current_org_id`); the orgTx middleware re-throws resolver errors inside the tx so
  failed requests ROLL BACK (tRPC's `next()` doesn't reject — don't remove that guard).
  Events emit through the tx-bound outbox bus.
- **Store pattern:** Zustand, NO persist middleware (store-only = lost on refresh). Writes are
  optimistic → `trpcVanilla.v1.*.mutate` → reconcile from the returned DTO → rollback +
  NODE_ENV-guarded dev-log on failure. Hydrators (`features/*/…-hydrator.tsx`) fill the store
  from `v1.*.list` (`refetchOnWindowFocus: false`). When a flow already persisted server-side,
  ADOPT the returned DTO (e.g. `adoptEstimate`) — do not re-persist via an add* action.
- **Money:** integer cents in DB/domain (`Money` = branded number), `{cents, currency}` in
  DTOs, DOLLARS in the store; conversions live in `lib/store/dto-mapper.ts` only. Rates and
  discounts in basis points (bps).
- **Soft-delete only** (`deleted_at`); never hard-delete tenant data.

## Commands

- `npm test` (unit) · `npm run test:int` (integration — hits the LIVE shared Supabase DB with
  real RLS; needs `DATABASE_URL`/`APP_DATABASE_URL` from `.env.local`)
- `npm run coverage` (gate: 80% stmts / 75% branches; actual ~94/85 — don't regress)
- `npx tsc --noEmit` · `npm run lint` (0 errors required; warnings are legacy) · `npm run build`
- Migrations: edit `shared/db/schema/*` → `npm run db:generate` (auto-numbers; check
  `git status shared/db/migrations` for drift) → hand-write RLS as a separate numbered file +
  journal entry → `npm run db:migrate` applies to the LIVE DB (it's shared dev/prod — additive
  changes only) → **`npm run db:verify`** (compares live migration state against the journal;
  exits 1 on divergence — catches the silent no-op gotcha). Applied migrations are immutable;
  fixes go in a NEW migration.
- **Never** manage the Supabase `storage` schema from a drizzle migration (the migrate role
  doesn't own it and the whole batch rolls back) — that lives in `shared/db/storage-setup.sql`,
  run manually in the Supabase SQL editor.

## Hard-won gotchas

- `NEXT_PUBLIC_*` env vars are baked into the client bundle at BUILD time — adding/changing one
  in Vercel requires a redeploy to take effect.
- Notification sends degrade to a logging stub when a channel is unconfigured; INTERACTIVE send
  endpoints must surface that (PRECONDITION_FAILED) — see `assertDelivered` in the notification
  router. Background reminder paths keep graceful degradation.
- The auth token verifier uses `supabase.auth.getClaims()` (local JWT verify) — do not revert to
  `getUser()` (a per-request network call that made every page load ~1s).
- Postgres `time` columns read back as `HH:MM:SS`; the app's canonical time format is `HH:MM` —
  normalize at the mapper read boundary.
- Store id types are strings (UUIDs) everywhere; client-authored UUIDs are preserved by create
  endpoints where the store needs the id synchronously.
- Don't `import * from` a module barrel in a unit test — barrels include the API router, which
  pulls the config validator (throws without DB env).

## House rules (Owen's)

- Design principles are binding: `docs/design-principles.md` (SOLID, DI, repository
  pattern, DTO≠domain, validate at boundaries, no silent failures, YAGNI — resilience patterns
  only for real external calls like Storage/Twilio/Stripe/Resend, not DB).
- **No floating UI** — no popovers/portals/floating insets; panels expand in-flow, anchored and
  flush. Suggestion lists render under their input, in-flow.
- **UI copy is functional, not chatty.** Errors name the actual problem and next step.
- No demo/sample/seed data — everything DB-backed. No dead buttons: wire a control or delete it.
- **Compose the primitives; never hand-roll.** Read `docs/design-system.md` first — style with
  the `--space/--type/--radius` tokens and the `components/ui` + `components/shared` primitives,
  never a raw px or a hand-rolled card/field/button. `pnpm lint` (+ `lint:css`) now FAIL on a raw
  token, a bad `aria-*`, or a missing `alt`; the visual/a11y nets (`E2E_VISUAL=1`) are the
  pre-merge gate for pixels/axe — run them and re-baseline deliberately for any UI change.
- Verify work against Owen's stated logic; screenshot-verify UI when feasible; run the full gate
  (tsc · lint · lint:css · unit · int · coverage · build) before calling a branch done; open a PR
  (Owen merges); adversarial review for non-trivial branches.

## Where deeper context lives

- `docs/design-system.md` — the UI single-source-of-truth: tokens, primitives, the 4 list
  states, the a11y floor, the visual net, and design house rules. Read it before any UI work
  (there is ONE styling system — `app/prototype.css`; Tailwind was fully removed).
- `.superpowers/sdd/progress.md` — git-ignored per-branch build ledger (the 7-phase DB-backed
  build history + every review finding). Read it before large work.
- `docs/superpowers/specs/` + `docs/superpowers/plans/` — feature specs/plans (source of truth
  for the fully-DB-backed build).
- `prospecting/research/2026-07-12-mallet-icp-vertical-ranking.md` (sibling repo folder) — the
  ICP research: plumbing beachhead, then garage door + electrical.
- Live orgs: `Mallet_Test` (Owen's, has the Twilio number) and `E2E Plumbing` (test fixture).
  Roles: owner/office (full app) vs tech (field-only: My day, My hours, Messages).

## Working in parallel with other Claude sessions

Another session may be active on this repo. To avoid stepping on each other: work in a **git
worktree** on your own branch (`git worktree add ../mallet-app-<topic> -b <branch>`), commit
linearly, open a PR — never work directly on `main` or someone else's branch. Check open PRs
(`gh pr list`) before starting overlapping work.

Worktrees do NOT carry git-ignored files: copy `.env.local` into the worktree
(`cp mallet-app/.env.local ../mallet-app-<topic>/`) or integration tests / db commands /
provider API checks won't run there.

**Migrations are single-writer.** Parallel sessions running `npm run db:generate` mint the
same migration number and collide in the journal — and the live DB is shared, so applies must
be serialized. Before generating a migration, check `gh pr list` for any open PR that touches
`shared/db/migrations/`; if one exists, coordinate with Owen before adding another. Schema
work belongs to one active branch at a time.
