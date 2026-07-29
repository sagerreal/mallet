# Measurements phase 1 — ingest + room cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `measurements` module in mallet-app: room-scan geometry ingests to a job, painting quantities derive automatically, and the office reviews/edits them on room cards — fixing "the scan shows an outline, then nothing."

**Architecture:** Hexagonal module `modules/measurements/` cloned from the `modules/companies/` template (domain → use-case Result → Drizzle repo, thin tRPC router under `v1.measurements`). Two org-scoped tables: `room_captures` (layer 1+2: verbatim raw payload + normalized geometry, job-scoped via composite FK) and `painting_room_quantities` (layer 3, painting's own table per the separate-table-per-trade rule). Derivation is a pure domain function. UI: a Measurements section in the office job modal + a new ROOM_CARD bottom-sheet modal in the #253 sheet grammar. Store: new Zustand slice + hydrator, optimistic writes.

**Tech Stack:** Next 16 / tRPC v11 / Drizzle + Supabase (RLS) / Zustand / Vitest. Spec: `prospecting/research/2026-07-29-scan-to-estimate-flow.md` (Owen-approved Jul 29).

## Global Constraints

- Org id ALWAYS from `ctx.principal.orgId`, never client input. Every new table: hand-written RLS migration (`ENABLE` + `FORCE` + `FOR ALL USING/WITH CHECK (org_id = current_org_id())`) — drizzle-kit does NOT emit RLS. Child tables composite-FK `(org_id, parent_id)`. Repos also filter `eq(orgId)` explicitly.
- Soft-delete only (`deleted_at`). Applied migrations are immutable; live shared DB — additive changes only; run `npm run db:verify` after migrate.
- **Painting quantity laws (Owen-approved, binding):** walls = GROSS sqft, openings NEVER deducted (PCA convention; deduction is out of scope this phase); baseboard = floor perimeter − Σ door widths; crown = full ceiling perimeter; doors/windows are counts; vaulted ceiling → quantity row exists with `value = null` + `needs_confirm` status, NEVER a guessed number.
- **Override law:** an edited quantity keeps the derived value beside it and is visibly marked — an override never looks measured. Statuses: `derived` | `override` | `confirmed`.
- Geometry wire format: the MalletCapture `NormalizedGeometry` snake_case JSON, SI meters. Trade quantities are stored in billing units (sqft / lnft / count) — conversion happens ONCE in the derivation function (1 m² = 10.763910417 sqft, 1 m = 3.280839895 ft).
- Re-scan of a room replaces geometry and RESETS all its quantities to freshly derived values (overrides are dropped — stale overrides on new geometry are worse than re-entry; the room card says so before rescanning). Raw payloads are immutable per capture: re-scan = new capture row superseding the old (`superseded_by_id`), never an UPDATE of raw.
- Money: none in this module (quantities only). IDs: client-authored UUIDs preserved by create endpoints.
- Store: dollars/strings conventions; no persist middleware; optimistic → trpcVanilla → reconcile → rollback+dev-log.
- UI: prototype.css tokens only, sheet grammar for the modal (ONE `.sheet-pri`, no floating UI, copy register functional/trade-formal, empty states "Add").
- Tests: TDD; unit colocated `*.test.ts`; integration `*.int.test.ts` (live DB, needs `.env.local`); coverage gate 80/75 — don't regress ~94/85.
- Raw payload cap: 512 KB; reject larger with a clear error (`payload too large — scan again per room`).

## Not in this plan

The Capacitor scan plugin (phase 2), "Build the price" bind (phase 3 — but the read port ships now so phase 3 can't force a restructure), manual-entry-first UX polish (phase 4), exterior (phase 5), any pricing/deduction settings UI.

---

### Task 1: Schema + migrations (+ RLS)

**Files:**
- Create: `shared/db/schema/measurements.ts`
- Modify: `shared/db/schema/index.ts` (re-export — REQUIRED or drizzle-kit misses it)
- Create (generated): `shared/db/migrations/0104_*.sql` via `npm run db:generate`
- Create (hand-written): `shared/db/migrations/0105_measurements_rls.sql` + journal entry

**Interfaces (produces):** tables `room_captures`, `painting_room_quantities`.

```ts
// shared/db/schema/measurements.ts — follow checklists.ts / job-execution.ts shapes exactly
export const roomCaptures = pgTable("room_captures", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => orgs.id, { onDelete: "cascade" }),
  jobId: uuid("job_id").notNull(),
  roomName: text("room_name").notNull(),
  source: text("source").notNull(),                    // 'roomplan_v1' | 'manual'
  rawPayload: jsonb("raw_payload"),                    // verbatim; null for manual
  geometry: jsonb("geometry"),                         // NormalizedGeometry snake_case; null for manual
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  supersededById: uuid("superseded_by_id"),            // re-scan chain; null = current
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  unique("room_captures_org_id_uq").on(t.orgId, t.id),
  foreignKey({ name: "room_captures_job_fk", columns: [t.orgId, t.jobId], foreignColumns: [jobs.orgId, jobs.id] }).onDelete("cascade"),
  index("room_captures_org_job_idx").on(t.orgId, t.jobId, t.deletedAt),
  check("room_captures_source_ck", sql`${t.source} in ('roomplan_v1','manual')`),
]);

export const paintingRoomQuantities = pgTable("painting_room_quantities", {
  id: uuid("id").primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull(),
  captureId: uuid("capture_id").notNull(),
  kind: text("kind").notNull(),                        // walls_sqft|ceiling_sqft|baseboard_lnft|crown_lnft|doors_count|windows_count
  value: numeric("value", { precision: 12, scale: 2, mode: "number" }),        // null = needs_confirm
  derivedValue: numeric("derived_value", { precision: 12, scale: 2, mode: "number" }), // null for manual rooms
  status: text("status").notNull(),                    // derived|override|confirmed|needs_confirm
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("painting_room_quantities_org_id_uq").on(t.orgId, t.id),
  unique("painting_room_quantities_capture_kind_uq").on(t.orgId, t.captureId, t.kind),
  foreignKey({ name: "painting_room_quantities_capture_fk", columns: [t.orgId, t.captureId], foreignColumns: [roomCaptures.orgId, roomCaptures.id] }).onDelete("cascade"),
  check("painting_room_quantities_kind_ck", sql`${t.kind} in ('walls_sqft','ceiling_sqft','baseboard_lnft','crown_lnft','doors_count','windows_count')`),
  check("painting_room_quantities_status_ck", sql`${t.status} in ('derived','override','confirmed','needs_confirm')`),
]);
```

- [ ] **Step 1:** Write the schema file + index re-export.
- [ ] **Step 2:** `npm run db:generate` — confirm it mints `0104_*` only (check `git status shared/db/migrations` for drift; any OTHER file changing = stop and report BLOCKED).
- [ ] **Step 3:** Hand-write `0105_measurements_rls.sql` — copy `0053_checklists_rls.sql`'s exact shape for BOTH tables (ENABLE + FORCE + one FOR ALL policy each, `--> statement-breakpoint` separators), and append the journal entry to `meta/_journal.json` mirroring how 0053 is journaled.
- [ ] **Step 4:** `npm run db:migrate` then **`npm run db:verify`** — both clean. (Live shared DB — additive only, which this is.)
- [ ] **Step 5:** Commit — `feat(measurements): room_captures + painting_room_quantities schema with RLS`

---

### Task 2: Domain — geometry types + painting derivation (the math)

**Files:**
- Create: `modules/measurements/domain/normalized-geometry.ts` (zod schema of the wire format + parse)
- Create: `modules/measurements/domain/derive-painting.ts`
- Create: `modules/measurements/domain/room-capture.ts` (value object)
- Test: colocated `*.test.ts` for each

**Interfaces (produces):**
- `parseNormalizedGeometry(input: unknown): Result<NormalizedGeometry, ValidationError>` — zod over the snake_case wire: `{ floor_polygon: {vertices:[{x,y,z}]}, walls: [{polygon}], openings: [{kind:'door'|'window'|'opening', width, height, wall_index?}], ceiling: {area, is_vaulted, wall_top_spread, provenance} }`. SI meters. Reject NaN/negative/absent-floor with named errors.
- `derivePaintingQuantities(g: NormalizedGeometry): PaintingQuantity[]` — pure. `PaintingQuantity = { kind, value: number | null, status: 'derived' | 'needs_confirm' }`:
  - `walls_sqft` = Σ wall polygon areas × 10.763910417, rounded to 1 decimal. GROSS — no opening deduction ever.
  - `ceiling_sqft` = ceiling.area × 10.763910417 when non-null; when `is_vaulted`/null → `value: null, status: 'needs_confirm'`.
  - `baseboard_lnft` = (floor perimeter − Σ width of openings with kind 'door') × 3.280839895, floored at 0.
  - `crown_lnft` = ceiling perimeter (= floor perimeter, flat convention) × 3.280839895.
  - `doors_count` / `windows_count` = counts by kind ('opening' counts as neither).
- `RoomCapture.create(props): Result<RoomCapture, ValidationError>` — immutable; invariants: non-empty trimmed roomName ≤ 80 chars, valid source, rawPayload ≤ 512·1024 bytes serialized, geometry present iff source `roomplan_v1`.
- Polygon area/perimeter from vertices: Newell's method + edge-sum (port the exact implementations from `mallet-ios/capture/MalletCapture/Sources/MalletCaptureCore/Geometry.swift` — same math, TypeScript).

- [ ] **Step 1:** Failing tests: 4×3×2.4 m room fixture (floor 12 m², perimeter 14 m, walls 33.6 m²) with one 0.9 m door + one 1.2 m window → walls_sqft 361.7, baseboard_lnft (14−0.9)×3.280839895 ≈ 42.98 → 43.0, crown_lnft 45.9, doors 1, windows 1; vaulted fixture → ceiling null/needs_confirm; degenerate/no-floor → ValidationError; RoomCapture invariants incl. the 512 KB cap.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS (verify the sqft numbers by hand, not just against your own implementation). **Step 5:** Commit — `feat(measurements): geometry parsing + painting quantity derivation`

---

### Task 3: Ports + Drizzle repository + mapper

**Files:**
- Create: `modules/measurements/domain/measurement-repository.ts` (port)
- Create: `modules/measurements/infra/drizzle-measurement-repository.ts`, `modules/measurements/infra/measurement-mapper.ts`
- Test: `modules/measurements/infra/drizzle-measurement-repository.int.test.ts`

**Interfaces (produces):** `MeasurementRepository` port:
```ts
createCapture(c: RoomCapture, quantities: PaintingQuantity[]): Promise<void>       // one tx: capture + its quantity rows
listByJob(jobId: string): Promise<RoomCaptureWithQuantities[]>                     // current (not superseded, not deleted), newest-first
getCapture(id: string): Promise<RoomCaptureWithQuantities | null>
supersede(oldId: string, next: RoomCapture, quantities: PaintingQuantity[]): Promise<void>  // sets old.supersededById = next.id, inserts next — one tx
setQuantity(captureId: string, kind: PaintingKind, patch: { value: number | null; status: QuantityStatus }): Promise<void>
renameRoom(captureId: string, roomName: string): Promise<void>
archive(captureId: string): Promise<void>                                          // soft-delete
```
Constructed `(tx: TenantTx, orgId: OrgId)`; explicit `eq(orgId)` + `isNull(deletedAt)` on every query (defense-in-depth), exactly like `drizzle-company-repository.ts`.

- [ ] **Step 1:** Failing int tests (live DB, serial): create→listByJob round-trip incl. jsonb geometry byte-fidelity; supersede chain excludes the old capture from listByJob; setQuantity override keeps derivedValue; cross-org invisibility (create under org A, read under org B → empty — the RLS + explicit-filter check other repos' int tests do).
- [ ] **Step 2:** Run `npm run test:int -- measurements` — FAIL. **Step 3:** Implement repo + mapper. **Step 4:** PASS. **Step 5:** Commit — `feat(measurements): repository + mapper with tenant isolation tests`

---

### Task 4: Use-cases

**Files:**
- Create + colocated tests: `modules/measurements/app/ingest-scan.ts`, `create-manual-room.ts`, `override-quantity.ts`, `confirm-quantity.ts`, `rename-room.ts`, `archive-room.ts`, `list-rooms.ts`, `rescan-room.ts`

**Interfaces (produces — all constructor-DI `(repo, clock, ids)`, `exec(cmd, orgId) → Result`):**
- `IngestScanUseCase.exec({ id?, jobId, roomName, capturedAt, rawPayload, geometry })` — parse geometry (Task 2), build RoomCapture, derive quantities, `repo.createCapture`. Client-authored id honored.
- `RescanRoomUseCase.exec({ captureId, rawPayload, geometry, capturedAt })` — parse+derive, `repo.supersede` (new capture inherits roomName; overrides intentionally dropped per Global Constraints).
- `CreateManualRoomUseCase.exec({ id?, jobId, roomName, quantities: {kind, value}[] })` — source 'manual', no geometry; each provided quantity status `confirmed`, missing kinds created `needs_confirm` with null.
- `OverrideQuantityUseCase.exec({ captureId, kind, value })` — value finite ≥ 0; status → `override`; derivedValue untouched. On a `manual` capture status stays `confirmed` (there is no derived value to diverge from).
- `ConfirmQuantityUseCase.exec({ captureId, kind, value })` — for `needs_confirm` rows (vaulted ceiling): sets value, status `confirmed`.
- `ListRoomsUseCase.exec({ jobId })` — repo.listByJob.
- Rename validates like RoomCapture; archive is soft.

- [ ] **Steps:** TDD each with an in-memory fake repo (the pattern in `modules/companies/app/*.test.ts`): failing tests → implement → pass. Edge tests that must exist: ingest with >512 KB raw → validation error; override with negative → error; confirm on a non-needs_confirm row → error (surfaced, not silent). Commit — `feat(measurements): use-cases (ingest, rescan, manual, override, confirm, list)`

---

### Task 5: DTO + router + registration

**Files:**
- Create: `modules/measurements/api/measurement-dto.ts`, `modules/measurements/api/measurement-router.ts`, `modules/measurements/index.ts` (barrel)
- Modify: `trpc/root.ts` (add `measurements: createMeasurementRouter()`), tsconfig/vitest alias registration for `@mallet/measurements` (copy how `@mallet/checklists` is registered)
- Test: `modules/measurements/api/measurement-router.int.test.ts`

**Interfaces (produces):** `v1.measurements.{ingestScan, rescan, createManualRoom, list, overrideQuantity, confirmQuantity, renameRoom, archiveRoom}` — all `ownerOrOffice`, org from principal, `orThrow(result)`. `list` input `{jobId}` returns `RoomCaptureDTO[]`: `{ id, jobId, roomName, source, capturedAt, quantities: [{kind, value, derivedValue, status}] }` — geometry/rawPayload NOT in the list DTO (heavy; a `getGeometry` procedure can come later when the floor-plan outline UI needs it).

- [ ] **Steps:** failing int tests (ingest → list round-trip as a real principal; override reflected; cross-org 404-shape) → implement → pass → commit — `feat(measurements): v1.measurements router`

---

### Task 6: Store slice + hydrator

**Files:**
- Create: `lib/store/slices/measurements-slice.ts`, `lib/store/measurements-mapper.ts`, `features/measurements/measurements-hydrator.tsx`
- Modify: `lib/store/app-store.ts` (compose slice), `lib/store/hydrator-config.ts` (register)
- Test: `lib/store/slices/measurements-slice.test.ts`, mapper test

**Interfaces (produces):** slice keyed by job: `roomsByJob: Record<string, RoomCard[]>` where `RoomCard = { id, jobId, roomName, source, capturedAt, quantities: RoomQuantity[] }`, `RoomQuantity = { kind, value: number | null, derivedValue: number | null, status }`. Actions (all optimistic → `trpcVanilla.v1.measurements.*` → reconcile → rollback + `reportWriteError`): `addManualRoom(jobId, roomName, quantities)` (client UUID), `overrideQuantity(jobId, captureId, kind, value)`, `confirmQuantity(...)`, `renameRoom(...)`, `archiveRoom(...)`, `setJobRooms(jobId, rooms)` (hydrator/reconcile). Hydrator: per the checklists-hydrator pattern; `list` needs a jobId — hydrate lazily from the job modal (a `useJobRooms(jobId)` hook that queries `v1.measurements.list` and seeds the slice), NOT the global hydrator config, since rooms are job-scoped (follow how job-scoped data like checklist state loads on job open — mirror that exact pattern; if checklists hydrate globally, still keep measurements lazy and note why: unbounded per-job payloads).

- [ ] **Steps:** TDD slice reducers (optimistic add/override/rollback paths with a mocked trpcVanilla, as existing slice tests do) → implement → pass → commit — `feat(measurements): store slice + lazy per-job hydration`

---

### Task 7: Job modal — Measurements section

**Files:**
- Create: `components/modals/job-measure-block.tsx`
- Modify: `components/modals/job-modal.tsx` (one new SheetRow accordion "Measurements", value = "3 rooms" / "Add"), `lib/store/modal-ids.ts` (add `ROOM_CARD`), `components/modals/modal-host.tsx` (register the modal, dynamic import per the documented pattern)

**Interfaces (produces):** `JobMeasureBlock({ jobId })` — renders inside the accordion: room rows (`Row` primitive: roomName · headline "562 sqft walls · 2 doors" · a `Badge tone="amber"` "Confirm" when any quantity is `needs_confirm`), tap → `openModal(MODAL.ROOM_CARD, { captureId, jobId })`; `+ Add room` button → opens ROOM_CARD in create mode (`{ jobId }` only). First-run: "Add" hint, never a dash. Uses `useJobRooms(jobId)` from Task 6.

- [ ] **Steps:** failing component test (rooms render, confirm badge shows, add opens modal — follow `job-modal.test.tsx` conventions) → implement → pass → commit — `feat(measurements): measurements section on the office job modal`

---

### Task 8: The room card modal

**Files:**
- Create: `components/modals/room-card-modal.tsx` (+ `room-card-modal.test.tsx`)

**Interfaces (produces):** `RoomCardModalContent()` — reads `{ captureId?, jobId }` from modal params. Sheet grammar (#253): `.sheet-head` h2 = room name (tap-to-rename via expandable row), `.sheet-meta` = source pill ("Scanned · Jul 29" / "Manual") · job name. Body: one `SheetRow` per quantity kind in fixed order (Walls, Ceiling, Baseboard, Crown, Doors, Windows), label = trade term, value = formatted number + unit:
- `derived`: plain value.
- `override`: value + a `Badge tone="blue"` "edited" AND the small muted derived value beside it ("measured 564") — an override never looks measured.
- `needs_confirm`: `Badge tone="amber"` "Confirm" + value hint "Add" — tapping expands the editor.
- Row expands (`SheetRow expandable`) to a `Field` + `<input inputMode="decimal">` with onBlur/Enter commit → `overrideQuantity`/`confirmQuantity` per current status; invalid input keeps the field open with the error named (copy: `"2..4" is not a number.`).
Create mode (no captureId): name field + the six quantity fields empty → Save = `.sheet-pri` "Add room" → `addManualRoom`. View mode foot: NO `.sheet-pri` (record viewer; editing is in-row) — "Remove room" stays quiet red (two-tap arm like sweep-modal), rescan note appears only when source is `roomplan_v1`: quiet row "Re-scan replaces these numbers and clears edits" (the actual rescan trigger arrives with the native plugin — no dead button: the row is informational text, not a control).

- [ ] **Steps:** failing tests (derived/override/confirmed/needs_confirm rendering incl. the "measured N" beside overrides; commit paths call the right store actions; create mode saves) → implement → pass → commit — `feat(measurements): room card modal in the sheet grammar`

---

### Task 9: Quoting read port (so phase 3 can't force a restructure)

**Files:**
- Create: `modules/measurements/domain/room-quantities-reader.ts` + in-module implementation export in the barrel
- Test: colocated unit test over the fake repo

**Interfaces (produces):** `RoomQuantitiesReader` port (mirrors `modules/jobs/domain/estimate-reader.ts`'s reader-port pattern): `readForJob(jobId): Promise<{ roomName, quantities: {kind, value, status}[] }[]>` — returns only quantities with non-null values; rooms with unresolved `needs_confirm` rows are included with a `hasUnconfirmed: true` flag so "Build the price" can mark the estimate draft. No quoting import here; quoting will depend on the port in phase 3.

- [ ] **Steps:** TDD → implement → commit — `feat(measurements): RoomQuantitiesReader port for the future price bind`

---

### Task 10: Full gate + PR

- [ ] **Step 1:** `npx tsc --noEmit` · `pnpm lint` · `pnpm lint:css` (0 errors each) · `npx vitest run` (100%) · `npm run test:int` (100%) · `npm run coverage` (≥ 80/75, no regression) · `pnpm build`.
- [ ] **Step 2:** Visual nets: `E2E_VISUAL=1 npx playwright test e2e/visual-modals.spec.ts` — the job-modal baseline WILL diff (new Measurements row): re-baseline deliberately with `--update-snapshots`, then green ×2 back-to-back. Page net vs production build (~76/78; the 2 money·mobile failures are the known live-data flake).
- [ ] **Step 3:** Simulated-iPhone screenshots: job modal with the Measurements section + the room card in all four quantity states (derived / edited / confirm / manual-create).
- [ ] **Step 4:** PR against main titled `feat(measurements): room-scan ingest + room cards on the job (phase 1 of the scanner)`, body referencing the flow doc and stating the painting quantity laws; screenshots attached. Owen merges.

---

## Self-review notes

- Spec coverage vs the flow doc: room card the moment data exists ✓ (T7/8), tappable numbers with override marks ✓ (T8), vaulted never guessed ✓ (T2/T8), baseboard−doors / crown-full ✓ (T2), no wall deduction ✓ (T2 + constraints), ingest endpoint for the phase-2 native bridge ✓ (T5 `ingestScan`/`rescan`), manual entry as peer ✓ (T4/T8 create mode), explicit-bind future-proofing ✓ (T9). Trade-pack selection UI deliberately deferred: with one trade live, the job's Measure section IS the painting pack — the screen ships when trade #2 does.
- Type-consistency: `PaintingQuantity {kind, value, status}` (domain) vs `RoomQuantity {kind, value, derivedValue, status}` (store/DTO) — derivedValue is persistence-layer, added in Task 3's mapper; Task 2's derivation output deliberately has no derivedValue (at derivation time value IS derived).
- The 4×3×2.4 fixture numbers match the MalletCapture Swift test fixtures — the two implementations must agree on the same room; if the walk data later disagrees with TypeScript derivation, compare against the Swift suite first.
