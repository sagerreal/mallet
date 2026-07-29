# Scan bridge phase 2A — ingest hardening + native wiring (web side) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The mallet-app side of the native scan flow: retry-safe ingest (the final-review preconditions from PR #259), a scan-capable store action, and the "Scan room" control that appears only inside the native shell — so the phase-2B Capacitor plugin has a finished web contract to land on.

**Architecture:** Three thin layers on top of the merged `modules/measurements/`: (1) error-boundary hardening in the router/repo (idempotent duplicate-id ingest, NOT_FOUND on foreign jobId, skip-and-flag list reads); (2) a `scanRoom` store action that calls the (typed, existing) `window.Capacitor.Plugins.MalletRoomScan` bridge via `lib/native-bridge.ts` conventions and then `v1.measurements.ingestScan`/`rescan`; (3) UI: a Scan-room button in `JobMeasureBlock` + a working Re-scan row in the room card, both rendered ONLY when the native plugin is present (no dead buttons on the web).

**Tech Stack:** unchanged (Next 16 / tRPC v11 / Drizzle / Zustand / Vitest). No schema changes — no migrations, no single-writer coordination needed.

**Spec anchors:** `prospecting/research/2026-07-29-scan-to-estimate-flow.md`; PR #259's "Known follow-ups"; `lib/native-bridge.ts` (isNativeShell / nativePlugin / attempt — the ONLY sanctioned bridge seam); mallet-ios README (WKUserScript bridge is webview-scoped, so `window.Capacitor.Plugins.X` is callable from app.trymallet.com without shipping @capacitor/core).

## Global Constraints

- Org id only from principal; no schema changes in this plan.
- **No dead buttons:** every scan control renders ONLY when `nativePlugin<RoomScanPlugin>("MalletRoomScan")` is non-null. On the plain web nothing appears (manual entry stays the peer path).
- **No silent failures:** plugin cancel is a clean no-op; plugin/ingest errors surface via the store's `reportWriteError` path or inline error, never swallowed. EXCEPTION (documented in native-bridge.ts): a missing bridge is an absent capability, not an error.
- Idempotency law: repeating `ingestScan` with the same client-authored id MUST return the already-persisted capture's DTO with 200-semantics (true idempotency — the bridge retries on flaky signal). It must NOT create, NOT 500, NOT CONFLICT.
- Skip-and-flag law: one corrupt stored geometry must not fail a job's whole room list — the bad room is omitted and logged (`logger.warn` with captureId), never silently invented.
- The plugin contract (phase 2B implements it; this plan TYPES it): `MalletRoomScan.captureRoom(options: { roomName: string }) → Promise<{ status: "done", rawPayload: string /* JSON */, geometry: string /* NormalizedGeometry snake_case JSON */, capturedAt: string /* ISO */ } | { status: "cancelled" }>`. Errors reject.
- Tests: TDD; unit colocated; int tests for the router changes; coverage gate 80/75 (repo ~93/86 — don't regress). Copy register functional.

## Not in this plan

The Swift plugin itself (phase 2B, mallet-ios), auto-opening the room card after scan-complete polish beyond the basic open, MultiRoom, exterior.

---

### Task 1: Idempotent ingest + typed jobId failure (router/repo/use-case)

**Files:**
- Modify: `modules/measurements/infra/drizzle-measurement-repository.ts` (createCapture: detect PG 23505 on the capture PK → typed `DuplicateCaptureError`; detect FK violation 23503 on room_captures_job_fk → typed `JobNotFoundError` — export both from the port file like SupersedeTargetError)
- Modify: `modules/measurements/app/ingest-scan.ts` (catch DuplicateCaptureError → fetch the existing capture via repo.getCapture(id) and return ok(existing) — TRUE idempotency; catch JobNotFoundError → err(notFound("job not found", "jobId")))
- Modify: `modules/measurements/app/rescan-room.ts` (same duplicate-id treatment for the NEW capture id)
- Test: unit (fake repo throwing each error) + int: real double-ingest with the same id returns the same DTO twice, exactly ONE row exists; ingest with a random jobId → NOT_FOUND, no row.

**Interfaces:** unchanged router surface; `IngestScanUseCase.exec` result type unchanged.

- [ ] Steps: failing tests → implement (Postgres error codes: read how the codebase detects PG error codes elsewhere — grep for `23505` or `code === ` in shared/db or modules; if no precedent, check `err.code` on the postgres driver error and document) → pass → commit `fix(measurements): retry-safe ingest — duplicate id returns the existing capture, foreign job is NOT_FOUND`

### Task 2: Skip-and-flag list reads

**Files:**
- Modify: `modules/measurements/infra/measurement-mapper.ts` + `drizzle-measurement-repository.ts` listByJob: a row whose geometry/raw fails to map is SKIPPED with `logger.warn({ captureId }, "measurements.capture.unreadable")`; getCapture (single read) still throws corrupt (a direct open of a broken capture must fail loudly).
- Test: int test inserting a deliberately-corrupt geometry row via raw SQL (owner client) → listByJob returns the healthy rooms and logs; getCapture on the corrupt id throws.

- [ ] Steps: TDD → commit `fix(measurements): one unreadable capture no longer fails the whole room list`

### Task 3: The typed bridge + scan store action

**Files:**
- Create: `lib/native/room-scan.ts` — the ONE place that knows the plugin: `type RoomScanPlugin`, `type RoomScanResult`, `export function roomScanPlugin(): RoomScanPlugin | null` (wraps `nativePlugin<RoomScanPlugin>("MalletRoomScan")`), `export async function captureRoom(roomName: string): Promise<RoomScanResult>` (throws if plugin absent — callers gate on `roomScanPlugin()` first). Parse both JSON strings here; invalid JSON from the plugin → a named Error (surfaced, not swallowed).
- Modify: `lib/store/slices/measurements-slice.ts` — `scanRoom(jobId, roomName)` and `rescanRoom(jobId, captureId, roomName)` actions: call captureRoom → on "cancelled" return null (no-op) → on "done" call `trpcVanilla.v1.measurements.ingestScan.mutate({ id: crypto.randomUUID(), jobId, roomName, capturedAt, rawPayload, geometry })` (or `.rescan` with captureId) → adopt the returned DTO into roomsByJob (ADOPT the server DTO — this flow persists server-side first, so no optimistic row and no add* re-persist, per the store house rule) → return the RoomCard. Errors: reportWriteError + rethrow (callers show inline).
- Test: slice tests with a mocked lib/native/room-scan and mocked trpcVanilla — done path adopts; cancelled path leaves store untouched; plugin error propagates after reportWriteError; rescan REPLACES the room's card (supersede semantics — old id gone, new id present).

- [ ] Steps: TDD → commit `feat(measurements): scanRoom/rescanRoom store actions over the MalletRoomScan bridge`

### Task 4: UI — Scan room button + live Re-scan row

**Files:**
- Modify: `components/modals/job-measure-block.tsx` — beside "+ Add room": a `Scan room` button rendered only when `roomScanPlugin()` is non-null (evaluate once per render; it's stable at runtime). Tap → prompt-free flow: pushModal a tiny name step? NO — keep phase-1 grammar: reuse the ROOM_CARD create mode? DECISION RESOLVED IN-PLAN: scan needs a room name BEFORE capture (the plugin takes roomName). Simplest honest flow: tapping `Scan room` opens ROOM_CARD in a new `scan` mode (params `{jobId, mode: "scan"}`) — the card shows the name Field + ONE `.sheet-pri` "Start scanning" → calls store.scanRoom(jobId, name) → native takes over full-screen → on return: adopted room's card content replaces the form in-place (the modal's captureId param can't change, so: after adopt, closeModal() then pushModal(ROOM_CARD, {captureId, jobId}) — stacked back to the job modal is preserved). Cancelled → form stays. Error → inline error, form stays.
- Modify: `components/modals/room-card-modal.tsx` — the informational "Re-scan replaces these numbers and clears edits." row becomes a real control when the plugin is present: quiet row + confirm-arm (two-tap, like Remove) → store.rescanRoom → on success the modal re-points (close + push with the NEW captureId). Plugin absent → keep the text-only row exactly as today.
- Test: block test (plugin mocked present → button renders; absent → not rendered); room-card scan-mode tests (name required; start-scan calls scanRoom; cancelled keeps form; success re-opens card on the new capture); rescan two-tap.

- [ ] Steps: TDD → commit `feat(measurements): scan-room flow in the job modal + live re-scan, native shell only`

### Task 5: Gate + PR

- [ ] tsc / lint / lint:css 0 errors · unit + int green · coverage no-regress · build · visual-modals net (job-modal + room-card baselines: the new controls are native-gated so the web-rendered baselines should NOT change — verify zero diff; if a diff appears the gating is broken, treat as a finding not a re-baseline) · PR against main titled `feat(measurements): native scan bridge (web side) — retry-safe ingest + scan-room flow`, body noting the plugin contract for phase 2B.

## Self-review notes
- The plugin contract is typed in ONE file (lib/native/room-scan.ts) — phase 2B's Swift must match it; the contract is also stated in the PR body.
- Idempotency uses the client-authored id as the natural key — no new columns.
- The visual-net zero-diff assertion in Task 5 doubles as the no-dead-buttons proof for web users.
