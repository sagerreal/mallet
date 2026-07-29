# Measurement rates + Build the price (phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scanned rooms become a priced, sendable estimate: pricebook services can carry per-unit measurement rates (PaintScout-compatible), and a job's "Build the price" seeds the composer with rooms × rates as normal estimate lines — GBB, e-sign, and deposit all reuse the existing quote lane.

**Architecture:** Three thin layers. (1) Pricebook: `measuredBy: PaintingQuantityKind | null` on services — when set, `unitPriceCents` means price PER unit (sq ft / ln ft / item) instead of flat. (2) Quoting: a `BuildFromMeasurementsUseCase` behind the existing `RoomQuantitiesReader` port (quoting depends on measurements' port — the dependency direction phase 1 reserved) producing `EstimateLineInput`-shaped seed lines per room × kind. (3) UI: a "Build the price" action on the job's Measurements block routing to the composer with the seed; the composer treats seeded lines exactly like pricebook picks (editable, tierable). Deterministic lane — deliberately NOT via aiDraftLines/edit-delta (that pipeline learns from AI corrections; a formula has nothing to learn).

**Owen's binding condition:** the rate model must match how painters actually price — per-unit production rates, doors/windows as counted items, walls gross (PCA). The model below is PaintScout's shape mapped onto Mallet's pricebook.

**Tech Stack:** unchanged. One migration (pricebook_items column) — single-writer: REQUIRES the measurement-gating PR to be merged first (it holds slot 0108); this plan mints 0109.

## Global Constraints

- Everything user-visible in this plan is gated by the `measurementEstimating` org toggle (store: `s.toggles.measurementEstimating`) — plumbing orgs see zero change, including in the pricebook service editor.
- Money: cents in domain/DTO, dollars in store, conversion at the mapper only. Quantities: numeric(12,2) conventions; estimate lines already carry quantity — reuse, no new line concept.
- Estimate attaches to a LEAD; measurements attach to a JOB. The seam: job → its lead (VERIFY the jobs schema/store relationship field name before wiring; if a job has no lead, the Build-the-price action is disabled with the reason named).
- Rooms with `hasUnconfirmed: true` (vaulted ceiling never confirmed, etc.): their resolved quantities still seed lines, but the composer shows a named warning ("2 rooms have unconfirmed measurements — confirm them on the job before sending") and the seeded draft keeps it visible. Never block, never silently drop.
- A kind with NO matching rate service seeds NO line and the build result NAMES the gap ("No rate set for Baseboard — add one in the Pricebook"). Never invent a price.
- Multiple services for the same kind (e.g. "Walls — 1 coat" / "Walls — 2 coats"): v1 seeds the first active by position; the composer's normal line-swap covers the rest. (GBB-per-coats is a natural phase-4; do not build it now.)
- Walls are GROSS sqft; no deduction anywhere (already enforced upstream).
- TDD; coverage no-regress; visual nets re-baselined deliberately for any UI change; copy register functional.

## Not in this plan

Job-local price-builder "From measurements" tile (job_lines lane — follow-up), GBB auto-tiering by coats, deduction settings, exterior, the ten-room walk.

---

### Task 1: Pricebook schema + domain — `measuredBy` on services

**Files:** `shared/db/schema/pricebook.ts` (or wherever pricebook_items lives — verify), migration 0109 (generate AFTER confirming the gating PR's 0108 is merged and pulled; additive column `measured_by text` nullable + CHECK in the 6-kind enum), `modules/pricebook/domain/service.ts` (+ tests), `api` zod schemas + DTO, mapper.
**Interfaces:** `ServiceProps.measuredBy: PaintingQuantityKind | null` (import the kind type from `@mallet/measurements` — check the barrel exports the TYPE without pulling the router; if the barrel is unsafe for domain import, re-declare the 6-literal union locally with a comment pinning it to the measurements enum + a unit test asserting the two stay equal). `create` validates membership. Semantics documented on the field: when set, unitPriceCents is per-unit.
- [ ] TDD → migrate → db:verify → commit.

### Task 2: Pricebook UI — rate editing (gated)

**Files:** the service editor inside the dashboard Pricebook tab (locate via `features/pricebook` / dashboard tab composition), tests.
**Behavior:** when `measurementEstimating` is ON, the service editor gains a "Priced by" row: Flat (default) | Walls (per sq ft) | Ceiling (per sq ft) | Baseboard (per ln ft) | Crown (per ln ft) | Doors (each) | Windows (each) — mapping to measuredBy. When a measured kind is chosen the price field label becomes "$ per sq ft" (etc.). OFF → editor unchanged (byte-identical — zero-diff discipline). List rows may show a small unit suffix ("$1.10 / sq ft") when set.
- [ ] TDD (both toggle states) → commit.

### Task 3: Quoting — BuildFromMeasurementsUseCase + router

**Files:** `modules/quoting/app/build-from-measurements.ts` (+ tests), `modules/quoting/api/estimate-router.ts` procedure `buildFromMeasurements({jobId})`, quoting's composition wiring a `MeasurementRoomQuantitiesReader` + a pricebook rate lookup (a narrow `RateServicesReader` port over pricebook — same reader-port pattern; quoting must not import pricebook's repo directly if a port precedent exists — follow how quoting already reads pricebook for the AI draft, if it does; else define the port in quoting and implement over the pricebook repo in the API layer composition).
**Output shape:** `{ leadId, seedLines: {description, quantity, rateCents, costCents, measuredKind, roomName}[], gaps: {kind, label}[], unconfirmedRooms: string[] }` — description convention `"{roomName} — {service.name}"`, quantity = the room's value, rateCents = service.unitPriceCents, costCents = service.costCents scaled? NO — costCents stays the service's per-unit cost × quantity is line-level: match EstimateLineInput semantics (verify: is costCents per-line-total or per-unit in DraftEstimateCommand? READ draft-estimate.ts/EstimateLine — quantity × rate is the line total, so costCents is per-UNIT like rateCents; confirm and mirror).
**Laws:** resolves the job's lead (error `notFound` when job absent; typed error when job has no lead); kinds with no service → gaps[], no line; multiple services per kind → first active by position; zero-value quantities seed nothing; counts (doors/windows) quantity = the count.
- [ ] TDD (fake readers; every law) → int test (real org: services with measuredBy + a scanned capture → seed lines correct) → commit.

### Task 4: The composer seed — ?job= entry

**Files:** `app/(office)/composer/page.tsx` (+ composer-state if needed), `components/modals/job-measure-block.tsx` (the "Build the price" button), tests.
**Behavior:** JobMeasureBlock gains a `Build the price` button (rendered when rooms.length > 0; gate inherited — the whole block is already gated). Tap → router.push(`/composer?job=<jobId>`) (the job modal closes — match how other job-modal actions navigate away, e.g. "Bill it in Money"; find and mirror). Composer: a `job` search param → calls `v1.quoting.buildFromMeasurements({jobId})` on mount → seeds ComposerState lines from seedLines (dollars conversion at the store boundary as the composer already does), sets the lead context from the returned leadId (the composer's existing ?lead= path — reuse its seeding), shows gaps + unconfirmedRooms as a quiet inline notice block (functional copy, links nowhere v1). From there the composer is UNCHANGED — office edits lines, tiers, sends; DraftEstimateUseCase persists via the normal draft mutation with NO aiDraftLines (deterministic lane).
- [ ] TDD (param routing, seed mapping, notices, no-lead disable) → commit.

### Task 5: Gate + PR

- [ ] Full gate (tsc/lint/lint:css/unit/int/coverage/build), visual nets (pricebook editor + job modal baselines re-baseline ONLY where the toggle is ON in the E2E org — the E2E org has measurementEstimating OFF by default, so baselines should be ZERO-diff; if any diff appears the gating leaks — finding, not re-baseline). Phone screenshots of: a rate service in the pricebook, the Build-the-price button, the seeded composer. PR referencing the flow doc + this plan; body includes the PaintScout-compatibility rationale and the explicit laws (no invented prices; gaps named; unconfirmed warns).

## Self-review notes
- Dependency direction honored: quoting → measurements port (reserved in phase 1); measurements imports nothing new.
- The learning-estimator lane untouched: seeded drafts carry no aiDraftLines, so edit-delta mining never sees formula lines.
- costCents semantics flagged as a verify-first (per-unit vs total) — the implementer must read EstimateLine before mapping.
- E2E-org toggle stays OFF so every existing baseline proves the gate; screenshots use a temp toggle-on org state (Mallet_Test or seeded) — cleanup required.
