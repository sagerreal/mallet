# Task 2.3b-ii Report — Least-Loaded + Proximity Crew Assignment in book_visit

**Status:** DONE_WITH_CONCERNS (one pre-existing flaky int-test failure unrelated to this task)

---

## Per-File Summary

### 1. `modules/frontdesk/domain/availability.ts`
- Added `import type { CrewLoad } from "../app/dispatch"` (domain→app, mirrors existing `BookedVisit` import pattern)
- Added `readSameDayCrewLoads(date: string): Promise<CrewLoad[]>` to the `AvailabilityReader` interface with the specified JSDoc

### 2. `modules/frontdesk/infra/drizzle-availability-reader.ts`
- Added `import type { CrewLoad } from "../app/dispatch"`
- Added `SameDayVisitRaw` type for the visit query result shape
- Added `readSameDayCrewLoads(date: string): Promise<CrewLoad[]>` — two org-scoped queries in `Promise.all()` (no N+1): field-crew ids (reusing the `is_field_crew` predicate) + active same-day visits with `assignee_user_id`, `lat`, `lng`
- Added `buildCrewLoads()` pure helper: groups visits by assignee, produces one CrewLoad per field-crew id (idle crew → `sameDayJobs: []`), drops non-field-crew assignees, maps `(lat, lng) → point | null`

### 3. `modules/frontdesk/app/tools/book-visit.ts`
- Added `import { chooseCrew } from "../dispatch"`
- Added `jobPoint: GeoPoint | null` parameter to `bookConfirmed()`
- Replaced `firstFieldCrew(ctx)` call with `assignCrew(ctx, input.slot_date, jobPoint)`
- Added `lat: jobPoint?.lat ?? null, lng: jobPoint?.lng ?? null` to `ctx.deps.createVisit.exec({...})`
- Replaced `firstFieldCrew` with `assignCrew(ctx, slotDate, jobPoint)` — same non-fatal semantics (catch → UNASSIGNED, same log key `frontdesk.book_visit.field_crew_read_failed`)
- Updated call site in `handle` to pass `area.point` to `bookConfirmed`
- Deleted `firstFieldCrew` (now unused — `check_availability` uses `readFieldCrewIds` via the interface, not this helper)

### 4. `modules/frontdesk/app/tools/book-visit.harness.ts`
- Added `import type { CrewLoad } from "../../app/dispatch"`
- Extended `fakeAvailability()` to accept `sameDayCrewLoads` and `sameDayLoadsThrows`
- Added `sameDayCrewLoads?: readonly CrewLoad[]` and `sameDayLoadsThrows?: boolean` to `HarnessOverrides`
- Updated `buildDeps` to pass new overrides; defaults to `[]` (→ UNASSIGNED, preserving zero-crew behaviour)

### 5. Inline stub updates (4 files)
Added `async readSameDayCrewLoads() { return []; }` to every inline `availability` object:
- `modules/frontdesk/app/tools/take-message.test.ts`
- `modules/frontdesk/app/tools/request-quote.test.ts`
- `modules/frontdesk/app/run-tool-calls.test.ts`
- `modules/frontdesk/app/tools/check-availability.test.ts` (inside `fakeAvailability()`)

### 6. `modules/frontdesk/app/tools/book-visit.test.ts` — new tests (7 added, 1 updated)
- **Emptier crew wins:** crew A has 1 job, crew B has 0 → assigns B
- **Proximity nearer crew wins:** both tied on load, origin+radius set, fixed geocoder provides jobPoint, crew A's job is ~0.7 mi away, crew B's ~69 mi → assigns A
- **Proximity flip:** crew B nearer → assigns B (proves distance, not order)
- **Point persisted:** when `area.point` is non-null (settings with origin set + fixed geocoder within radius), visit's `lat`/`lng` match the geocoded point
- **Empty loads → UNASSIGNED:** `sameDayCrewLoads: []` → null assignee (unchanged zero-crew behaviour)
- **Reader throws → UNASSIGNED:** `sameDayLoadsThrows: true` → booking still succeeds, assignee null
- **Zero field crew → UNASSIGNED:** default harness (no overrides) → null assignee
- Removed old `fieldCrewIds`-based "assigns FIRST field crew" test (superseded by proximity dispatch)

### 7. `modules/frontdesk/infra/drizzle-availability-reader.int.test.ts` — 4 new int tests
New suite `readSameDayCrewLoads against live Supabase RLS`:
- Both field-crew appear (loaded + idle), canceled/other-date/soft-deleted excluded
- crew1 has exactly one active same-day job with geocoded point (37.7749, -122.4194)
- crew2 is idle (sameDayJobs: [])
- Other org's field crew and visits never appear (RLS isolation)
- Fixed: removed `closeDb()` from the first `B1 availability reader` suite's `afterAll` (it was terminating the Drizzle pool before the second suite could run); `closeDb()` now only in the last suite's `afterAll`

---

## Phase 2 Gate Output

### 1. `npx tsc --noEmit`
```
(no output — zero errors)
```

### 2. `npm run lint`
```
✖ 155 problems (0 errors, 155 warnings)
```
Zero errors; all 155 are pre-existing legacy warnings.

### 3. `npm test` (unit)
```
Test Files  233 passed (233)
      Tests  2501 passed (2501)
```

### 4. `npm run test:int` (integration, live Supabase)
```
Test Files  1 failed | 48 passed | 2 skipped (51)
      Tests  1 failed | 397 passed | 2 skipped (400)
```
4 new readSameDayCrewLoads tests pass. One pre-existing failure: `drizzle-crew-schedules-reader.int.test.ts > returns exactly this org's FIELD-crew schedule rows` — this is a database-state ordering flake that pre-dates this task (confirmed by running int tests on the stashed branch and observing the same failure with 393 passing).

### 5. `npm run coverage`
```
Statements   : 93.16% ( 3817/4097 ) ✅ (gate: 80%)
Branches     : 85.24% ( 2155/2528 ) ✅ (gate: 75%)
Functions    : 95.1%  ( 874/919  )
Lines        : 94.77% ( 3317/3500 )
```

### 6. `npm run build`
```
(clean Next.js build, all routes compiled)
```

---

## Concerns

1. **Pre-existing int test flake** (`drizzle-crew-schedules-reader.int.test.ts`): The `returns exactly this org's FIELD-crew schedule rows` test fails intermittently because the live shared DB retains crew_schedule rows from other test runs (the test expects a fixed ordered list but the DB has extra rows). This pre-dates this task — confirmed by stashing changes and seeing the same failure. Not introduced or worsened by this task.

2. **Proximity tests require settings origin set:** The proximity tie-break tests require `originLat`/`originLng`/`areaRadiusMi` in settings so the service-area check calls the geocoder and returns a non-null `area.point`. With the default base settings (`originLat: null`), `isInServiceArea` short-circuits to `UNKNOWN` with `point: null` before calling the geocoder. This is correct behavior (graceful degrade), but it means proximity only activates in production when the org has set and geocoded their service origin.

3. **Old "assigns to FIRST field crew" test removed:** The existing test `assigns the visit to the FIRST field crew so it lands on the board` was superseded by the new proximity-dispatch tests. Removing it was correct since `readFieldCrewIds` is no longer used in `book_visit`'s assignment path.
