# Mallet Fully DB-Backed — Design Spec

**Status:** approved design → ready for implementation plan
**Date:** 2026-07-10
**Author:** GTM eng (Owen) + Claude

## Goal

Eliminate every prototype leftover in the Mallet app so **all user-meaningful
state persists to Supabase and survives a refresh / new device / new tab**.
Today a store audit found large swaths of state that live only in the in-memory
Zustand store (the store has **no persistence middleware** — plain `create()`),
plus one screen wired to hardcoded sample data. This build closes those gaps.

## Non-goals

- No localStorage/persist middleware. The **database is the source of truth**;
  the store is a hydrated cache. Every mutating action follows the existing
  optimistic → persist → reconcile/rollback pattern.
- No redesign of any screen. This is a persistence/wiring build, not a visual
  one. Copy and layout stay as-is unless a field has no control at all (e.g.
  the Branding card, which currently has a no-op save).
- No new architectural patterns. Every new domain mirrors the existing
  hexagonal module layout (see "Reference pattern" below).

## Audit summary (what this closes)

**Already correct (persist today):** customers (mostly), quoting, invoicing
(mostly), timesheets, tasks, companies, visits/schedule board.

**Gaps this build closes:**

1. **Lead quick-wins** — `moveLeadStage`, `archiveLead`, `restoreLead` are
   store-only though `v1.customers.update/archive/restore` already exist;
   `addLead` is store-only (the composer inline-add was already repointed to
   `v1.customers.create`, but the New-Job modal still uses the store-only path).
2. **Settings domain** — no backend at all: pricebook, labor rates, job terms,
   lead sources, business hours, visit duration, markup, trade, feature
   toggles, and the AI Front Desk booking config. No table, no router.
3. **Branding** — the Settings "Branding" card renders `SAMPLE_BRAND` from
   `@/lib/prototype-sample` with a no-op save; the store `brand` is never
   written or hydrated. Every customer quote/invoice therefore shows the
   placeholder "My Business".
4. **Jobs** — manual job creation does not persist (no generic create-job
   endpoint — only `createFromEstimate`/`scheduleDirect`); `updateJob`,
   `setJobSvc`, `archiveJob`, `deleteJob` are store-only.
5. **Job execution data** — found-work add-ons / job lines, before-you-leave
   verify-checklist answers, and job photos are store-only.
6. **Checklist templates** — org standards templates are store-only (seeded
   from `SEED_CHECKLISTS`), no table/router.
7. **Invoice edits** — `updateInvoice` (metadata) and `setInvoiceLines` only
   reach the DB if/when the invoice is *sent*; editing a sent/db invoice has no
   persistence path.

## Reference pattern (every new domain follows this)

The `companies` module is the template:

- **Schema** (`shared/db/schema/<x>.ts`): `pgTable` with `orgId` FK to `orgs`
  (`onDelete: cascade`), `created_at`/`updated_at`, soft-delete `deleted_at`
  where a collection can be removed, a composite `unique(org_id, id)` when other
  tables FK to it, and an `index(org_id, deleted_at)` for the list query.
  RLS is hand-written in the migration (tenant isolation via
  `current_org_id()`), matching every existing table.
- **Domain** (`domain/<x>.ts` + `<x>-repository.ts`): aggregate + repository
  interface.
- **App** (`app/*.ts` + `.test.ts`): one use-case per operation, unit-tested.
- **Infra** (`infra/drizzle-<x>-repository.ts` + `<x>-mapper.ts`): Drizzle
  implementation + row↔domain mapper.
- **API** (`api/<x>-router.ts` + `<x>-dto.ts` + `.int.test.ts`): tRPC procedures
  (`ownerOrOffice` / `anyRole` as appropriate) with Zod input/output DTOs;
  integration test against a live test DB.
- **Registration**: add `create<X>Router()` to `trpc/root.ts` under `v1`.
- **Store**: a hydrator component (`features/<x>/<x>-hydrator.tsx`) subscribing
  to the list query and calling `set<X>`, plus each mutating slice action
  switched to optimistic → `trpcVanilla.v1.<x>.<op>.mutate` → reconcile/rollback.

## Global constraints

- **Every table is org-scoped and RLS-isolated** via `current_org_id()`; the
  runtime app role is `NOBYPASSRLS`. Org id is never taken from client input —
  always from the authenticated principal (`withTenant`).
- **Soft-delete only.** No hard deletes. `deleteLead`/`deleteJob` repoint to the
  archive/cancel semantics that already exist or are added here. Existing
  `deleted_at`/`archived` conventions are reused.
- **Migrations go through drizzle-kit** (`db:generate` → hand-add any backfill →
  `db:migrate`) so `_journal.json` + snapshot stay consistent. Migrations are
  numbered from **0044** upward. RLS policies are hand-written into each
  migration (drizzle-kit does not emit them).
- **Money in cents** end-to-end (bps for rates/discounts), matching quoting.
- **Each phase lands as its own PR** and must pass the full repo gate before
  merge: `typecheck · lint (0 errors) · unit · int · coverage (80/75) · build`,
  plus an adversarial review.
- **No `@/lib/prototype-sample` imports** remain as a *source of truth* in any
  shipped screen after its phase (sample data may remain only in tests/fixtures).

## Phases

Each phase is an independently shippable PR. Build in listed order (dependency
order); 2–3 depend on the settings/org-config foundation.

### Phase 1 — Lead quick-wins (no new backend)

Wire the store actions whose endpoints already exist.

- `moveLeadStage(id, stage)` → route through the existing persist path
  (`v1.customers.update({ stage })`); or fold into `updateLead` and delete the
  redundant action.
- `archiveLead` → `v1.customers.archive`; `restoreLead` → `v1.customers.restore`.
- `addLead` → persist via `v1.customers.create` (server-assigned id) with
  optimistic insert + reconcile/rollback. Because the server assigns the id,
  callers that hold the returned lead must read the reconciled id; the New-Job
  modal's estimate path (`createEstimate`) is updated to await creation before
  attaching the evisit, and `deleteLead` repoints to archive.
- Tests: slice unit tests for each action (optimistic apply, correct mutation
  input, reconcile, rollback), mirroring the existing `addTask`/`updateLead`
  tests.

### Phase 2 — Settings backend

New persistence for org configuration.

- **Schema:**
  - `org_settings` — one row per org (unique on `org_id`): `trade`,
    `markup_bps`, `visit_duration_hours`, feature toggles
    (`tech_sees_price`, `tech_texts`, `front_desk`, `scope_on`), business hours,
    and the AI Front Desk **booking config** as `jsonb` (services list, call-out
    fee, service area). Scalars as typed columns; the nested booking blob as
    `jsonb`.
  - `pricebook_items` — `label`, `unit_price_cents`, optional cost/markup, plus
    soft-delete.
  - `labor_rates` — `label`, `rate_cents_per_hour`.
  - `job_terms` — free-text term lines (ordered).
  - `lead_sources` — the selectable source list.
- **Router** `v1.settings`: `get` (returns the org_settings row + all four
  collections in one payload for the hydrator), plus per-collection
  `create/update/remove` and an `updateConfig` for the org_settings scalars/JSON.
- **Store:** a `SettingsHydrator` seeds the slice from `v1.settings.get`; every
  `settings-slice` action switches to persist. Module-level id counters
  (`_nextLaborId`, etc.) are removed in favor of server ids.
- **Frontend:** the Settings page already imports `api`; wire each control to
  its mutation. Remove `SEED_*` as the source of truth.
- **First-run:** `get` lazily creates a default `org_settings` row (SECURITY
  DEFINER or use-case on first read) so a new org starts with sane defaults.

### Phase 3 — Branding

- **Schema:** brand fields on `org_settings` (`brand_tagline`, `brand_site`,
  `brand_color`, `brand_logo_url`, `brand_initials`). Brand *name* stays
  `orgs.name` (already persisted); the rest live with settings.
- **Router:** `v1.settings.updateBrand` (or fold into `updateConfig`).
- **Store:** add `setBrand`/`updateBrand` + hydrate `brand` from
  `v1.settings.get`; remove `DEFAULT_BRAND` as the runtime value.
- **Frontend:** replace `SAMPLE_BRAND` in `settings/page.tsx` with real fields
  and a working save; point `cust-quote-modal`, `cust-invoice-modal`, and the
  pipeline at the hydrated `brand`. Logo upload reuses the Phase-5 storage
  helper (or a small dedicated one) if logo images are in scope; text/colour
  ships regardless.

### Phase 4 — Jobs

- **Schema:** add `job_type`/`svc` column to `jobs` (memory: previously
  deferred); confirm `archived`/soft-delete columns exist (add if missing).
- **Router `v1.jobs`:** add `create` (manual, unscheduled job for a lead),
  `update` (title/addr/phone/notes/svc), and `archive`. `cancel` stays as-is.
- **Store:** `addJob` persists via `v1.jobs.create` (remove the
  `origin === "manual"` skip); `updateJob` routes field changes to `update`;
  `setJobSvc` persists; `archiveJob`/`deleteJob` → `archive`.
- **Frontend:** the New-Job modal's `createJob`/`createEstimate` persist through
  the store; a manually-created job survives refresh and appears on the board.

### Phase 5 — Job execution data

- **Schema:**
  - `job_lines` (+ `job_addons` if addons are modeled separately) — description,
    quantity, `rate_cents`, `cost_cents`, `is_optional`, `invoice_skip`, status.
  - `job_verify_answers` — per-job checklist item answers (checked / override).
  - `job_photos` — `storage_path`, `caption`, `verify_pass`, `created_at`.
- **Storage:** a Supabase Storage bucket for job photos (org-prefixed paths,
  RLS/policy so a tenant only reads its own). A `v1.jobs.photoUploadUrl`
  procedure returns a signed upload URL; the client uploads directly, then
  records the metadata row via `v1.jobs.addPhoto`.
- **Router `v1.jobs`:** `addLine`/`updateLine`/`removeLine` (or `patchLines`),
  `setAddonStatus`/`setAddonInvSkip`, `setVerifyAnswer`, `addPhoto`/`removePhoto`,
  `photoUploadUrl`.
- **Store:** `addAddon`/`setAddonStatus`/`setAddonInvSkip`,
  `checkVerifyItem`/`overrideVerifyItem`/`uncheckVerifyItem`, `addJobPhoto`
  switch to persist; job hydrator loads lines/answers/photos.
- **Frontend:** the job/tech modals show persisted lines, verify state, and
  photos that survive refresh.

### Phase 6 — Checklist templates

- **Schema:** `checklist_templates` + `checklist_items` (ordered, `required`
  flag), soft-delete.
- **Router `v1.checklists`:** `list` + `create/remove` template,
  `addItem/removeItem/setItemRequired`.
- **Store:** `checklists-slice` actions persist; a `ChecklistsHydrator` seeds
  from the DB; remove `SEED_CHECKLISTS` and module id counters. Per-job checklist
  *attachment* references stable server template ids (unblocks the job-modal
  attach flow surviving refresh).

### Phase 7 — Invoice edits

- **Router `v1.invoicing`:** `updateMetadata` (cust, phone, email, terms days,
  pricing bps, deposit-paid) and `patchLines` (line items + recomputed total)
  for **draft and sent** invoices.
- **Store:** `updateInvoice` and `setInvoiceLines` switch from the `TODO(persist)`
  no-ops to real mutations; remove the "snapshot only at send" comments.
- **Frontend:** editing an invoice persists immediately; no send required.

## Data flow (all phases)

1. On office-layout mount, each domain's hydrator runs its `list`/`get` query and
   writes the result into the store via `set<X>` (`refetchOnWindowFocus: false`,
   `staleTime` per `hydrator-config`).
2. A user action calls a slice action → optimistic `set` → `trpcVanilla` mutate.
3. On success, reconcile the returned DTO into the store (preserve client-authored
   ids where the endpoint accepts them; adopt server ids where it assigns them).
4. On error, roll back to the pre-mutation snapshot and log (dev console only;
   no user-facing leak of raw errors). User-facing surfaces show a friendly
   message where an inline error slot exists.

## Error handling

- Server: use-cases return `Result`; routers map to appropriate tRPC error codes.
  RLS violations fail closed (tenant isolation). No raw error text to clients.
- Client: rollback + friendly message; never silently swallow (dev logs retained).
- Public/unauthenticated surfaces (none new here) keep the existing 404/503
  guards.

## Testing

- **Unit:** each use-case (happy + validation + not-found + cross-tenant reject);
  each slice action (optimistic/persist/reconcile/rollback).
- **Integration:** each router against a live test DB with RLS on, incl. a
  cross-tenant isolation assertion.
- **Coverage:** repo gate 80/75 per phase.
- **Regression:** existing suites stay green; hydrators must not clobber
  optimistic writes.

## Risks / notes

- **Server-assigned ids vs optimistic ids** (leads/jobs): callers holding the
  optimistic record must adopt the reconciled server id. Phase 1 and Phase 4
  each handle this explicitly (await create, then attach children).
- **Settings first-run:** ensure `get` returns defaults for an org with no
  `org_settings` row yet (lazy create) so the UI never renders empty.
- **Photo storage policies:** get the Supabase Storage bucket RLS right so a
  tenant cannot read another org's photos.
- **Phase 2/3 are the biggest**; they unblock branding on customer docs and the
  AI Front Desk config, which is why they precede jobs.
