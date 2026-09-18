# Labor Rate Kinds (Diagnostic / Trip Fee) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Let a shop define a **flat-fee** labor rate (e.g. "Diagnostic fee $95", "Trip fee $75") — the single most-used charge for a small trade shop — and drop it on a quote as a fixed line, alongside the existing hourly rates. Today every labor rate is `$/hr` and a labor pick becomes an `hours × rate` line; a flat fee needs its own kind end-to-end.

**Architecture:** Additive `kind` column on the existing `labor_rates` table (`hourly` | `flat_fee`, default `hourly` — existing rows unchanged). Thread `kind` through the settings domain/use-cases/DTO/store/mapper, render it in the settings Labor-rates card (kind picker + `/hr` vs `flat` display), and — the piece that makes it real — branch the quote builders' labor-pick so a `flat_fee` rate creates a fixed-amount line, not a time-&-material line.

**Tech Stack:** Next.js 16, tRPC v11, Drizzle + Supabase Postgres, Zustand, Vitest (+ integration).

**Reference:** master spec §Labor ("what a 1–3 tech shop needs is a diagnostic/trip fee + an emergency uplift, not a labor-rate table"). After-hours multiplier is explicitly OUT (separate design — where a ×1.5 uplift applies is unresolved).

## Global Constraints
- Money integer cents in DB/domain/DTO, dollars in store; conversion only in the mapper. Labor rate amount reuses `rate_cents_per_hour` (it's "cents"; `kind` decides per-hour vs flat).
- Tenant safety: `labor_rates` already org-scoped + RLS (0045) — the new column rides existing RLS; no new RLS needed. Additive-only migration (ADD COLUMN default), shared prod DB.
- Domain returns Result; DTO≠domain; no silent failures (store rollback surfaced); soft-delete; validate at boundaries (`kind` ∈ {hourly, flat_fee}).
- No floating UI; functional copy; no dead buttons. **The flat-fee kind MUST reach the quote builder** (wire it or it's an orphaned setting — the whole point).
- YAGNI: only `hourly` | `flat_fee`. NO after-hours multiplier, NO per-tech tiers, NO new table.

## Task 1: Schema — add `kind` (additive) [INLINE]
**Files:** `shared/db/schema/labor-rates.ts`, drizzle migration.
- [ ] Add `kind: text("kind").notNull().default("hourly")` + a check constraint `kind in ('hourly','flat_fee')`. Generate migration (ADD COLUMN + the check — additive). Apply + verify column exists via direct query. Commit `feat(settings): labor_rates.kind column (hourly|flat_fee, additive)`.

## Task 2: Domain + use-cases + DTO + repo
**Files:** `modules/settings/domain/settings-repository.ts` (LaborRate type), `modules/settings/app/labor-rates.ts`, the settings DTO + drizzle settings repo + mapper.
- [ ] Add `kind: "hourly" | "flat_fee"` to the `LaborRate` domain type (default `"hourly"` on read for legacy rows). Thread through `CreateLaborRateCommand`/`UpdateLaborRateCommand` (validate `kind` when present), the repo `createLaborRate`/`saveLaborRate`, the mapper (row.kind → typed union, default hourly), and the settings DTO (`laborRateDTO` gains `kind`). Update the labor-rate unit tests. Commit.

## Task 3: Store + mapper + settings UI
**Files:** `lib/store/slices/settings-slice.ts` (LaborRate store shape + addLaborRate/updateLaborRate signatures), the settings hydrator/dto-mapper, `app/(office)/settings/page.tsx` (SecPricing Labor-rates card).
- [ ] Store `LaborRate` gains `kind`; `addLaborRate(name, rate, kind)` and `updateLaborRate(id, "kind", …)` supported (optimistic+rollback preserved). Hydrator/mapper carry `kind`.
- [ ] Settings Labor-rates card: the add row gets a small kind toggle (Hourly / Flat fee); each rate row renders `$X /hr` for hourly and `$X flat` for flat_fee, and its editable unit label follows kind. Keep the existing "e.g. Diagnostic fee, After-hours" placeholder. Commit.

## Task 4: Quote-builder wiring + screenshot
**Files:** `components/modals/pricing/build-line.tsx` (LaborRate shape + labor sublist render + onPickRate contract), `components/modals/tech-quote-modal.tsx` + `components/modals/price-builder-modal.tsx` (the adapters that map store → build-line LaborRate, and the `onPickRate` handlers).
- [ ] `build-line.tsx` `LaborRate` gains `kind`; the labor sublist renders `{fmt$(r.rate)}/hr` for hourly and `{fmt$(r.rate)} flat` for flat_fee.
- [ ] The two modals' store→LaborRate adapters carry `kind`; their `onPickRate(rate)` handlers branch: `hourly` → the existing `tm` line (`h`×`rate`); `flat_fee` → a **fixed** line (kind `custom`/fixed amount = rate, no hours). So a "Diagnostic fee $95" pick drops a $95 line.
- [ ] Full gate (tsc/lint/unit/int/coverage/build). Screenshot-verify: a flat-fee labor rate in settings, and picking it in a quote builder drops a fixed $ line. Commit.

## Self-Review
- The one load-bearing requirement: flat_fee reaches the quote builder as a FIXED line (Task 4) — without it this is an orphaned setting. Everything else is plumbing `kind` through the layers.
- After-hours multiplier deliberately deferred (unresolved design). Existing hourly rates + `hours × rate` behavior unchanged (default `hourly`).
