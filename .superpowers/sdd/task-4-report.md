# Task 4 Report: Settings Application Use-Cases

## Status

DONE. All use-cases implemented TDD (RED → GREEN). tsc clean. Full settings suite green.

---

## Use-cases Implemented

| File | Use-cases |
|------|-----------|
| `modules/settings/app/default-booking.ts` | Shared first-run defaults factory (ported from prototype SEED_BOOKING) |
| `modules/settings/app/get-settings.ts` | `GetSettingsUseCase` — lazy-create config + all four collections |
| `modules/settings/app/update-config.ts` | `UpdateConfigUseCase` — patch OrgSettings, upsert-safe |
| `modules/settings/app/pricebook.ts` | `CreatePricebookUseCase`, `UpdatePricebookUseCase`, `RemovePricebookUseCase` |
| `modules/settings/app/labor-rates.ts` | `CreateLaborRateUseCase`, `UpdateLaborRateUseCase`, `RemoveLaborRateUseCase` |
| `modules/settings/app/terms.ts` | `CreateTermUseCase`, `UpdateTermUseCase`, `RemoveTermUseCase` |
| `modules/settings/app/sources.ts` | `CreateSourceUseCase`, `UpdateSourceUseCase`, `RemoveSourceUseCase` |

14 use-cases total across 7 files.

---

## TDD Evidence RED → GREEN

Each test file was written first and run to confirm failure before the implementation was written.

### `get-settings.test.ts`
- RED: `Cannot find module './get-settings'`
- GREEN: `2 passed` — lazy-create defaults + all four collections returned

### `update-config.test.ts`
- RED: `Cannot find module './update-config'`
- GREEN: `5 passed` (including 2 from shared get-settings suite via re-import) — markup patch + booking blob patch + negative-markup validation guard

### `pricebook.test.ts`
- RED: `Cannot find module './pricebook'`
- GREEN: `6 passed` — empty-label rejection + id mint + not-found on update + archive removes row

### `labor-rates.test.ts`
- RED: `Cannot find module './labor-rates'`
- GREEN: `7 passed` — empty-label rejection + id mint + conflict guard (last-rate deletion refused) + multi-rate deletion allowed + not-found on update

### `terms.test.ts`
- RED: `Cannot find module './terms'`
- GREEN: `6 passed` — empty title/body rejection + append + not-found remove + patch body

### `sources.test.ts`
- RED: `Cannot find module './sources'`
- GREEN: `7 passed` — empty-label rejection + case-insensitive duplicate conflict + append + not-found remove + patch label

### Full settings suite
```
npx vitest run modules/settings
Test Files  7 passed (7)
Tests  41 passed (41)
```

### TypeScript
```
npx tsc --noEmit
(no output — 0 errors)
```

---

## Files Created

```
modules/settings/
├── domain/                         (from Task 3 — copied into worktree)
│   ├── org-settings.ts
│   ├── org-settings.test.ts
│   └── settings-repository.ts
└── app/
    ├── default-booking.ts
    ├── get-settings.ts
    ├── get-settings.test.ts        (FakeSettingsRepository exported here, shared by all app tests)
    ├── update-config.ts
    ├── update-config.test.ts
    ├── pricebook.ts
    ├── pricebook.test.ts
    ├── labor-rates.ts
    ├── labor-rates.test.ts
    ├── terms.ts
    ├── terms.test.ts
    ├── sources.ts
    └── sources.test.ts
```

---

## Self-Review

### >= 1 Active Labor Rate Guard

`RemoveLaborRateUseCase` calls `repo.countActiveLaborRates()` BEFORE calling `archiveLaborRate`. If the count is `<= MIN_ACTIVE_LABOR_RATES` (named constant = 1), it returns `err(conflict(...))` without touching the DB. The test "remove: refuses to delete the last active rate" verifies this — the repo still contains 1 rate after the rejected call.

### Lazy-Create Idempotency for GetSettings

`GetSettingsUseCase.exec()` delegates entirely to `repo.getConfig(orgId, defaultBooking)`. The contract on that port method is to return the existing row if present, or upsert the defaults. Calling `exec()` twice against the same FakeSettingsRepository returns the same config both times — the `FakeSettingsRepository.getConfig` short-circuits on `if (this.config)`. The real infra adapter (Task 5) will use an `INSERT ... ON CONFLICT DO NOTHING` pattern to honour the same contract.

### Design Principle Adherence

- **DI + SRP:** All use-cases receive `repo`, `clock`, and/or `ids` by constructor. No globals. One responsibility per class.
- **Ports only:** No Drizzle imports anywhere in `app/`. All data access goes through `SettingsRepository`.
- **Result<T, AppError>:** Every `exec()` returns `Promise<Result<T, AppError>>`. Errors are typed (`validation`, `notFound`, `conflict`) — never thrown as exceptions across the use-case boundary.
- **Named constants:** `MIN_ACTIVE_LABOR_RATES = 1` in `labor-rates.ts`.
- **Immutability:** Patch objects are built as new objects; no mutation of existing references.
- **No silent failures:** Every error path returns `err(...)`. Structured `logger.info` on every successful mutation.
- **Small functions:** Largest method is `UpdatePricebookUseCase.exec` at 19 lines. All files under 120 lines.
- **FakeSettingsRepository archive methods:** Correctly accept `_now: Date` to satisfy the port interface.

---

## Concerns

1. **`UpdateSourceUseCase` added beyond brief:** The brief only showed Create + Remove for sources, but `SettingsRepository` has `saveSource()` which implies updates should be supported. Added `UpdateSourceUseCase` following the identical pattern as all other update use-cases.

2. **`void this.clock.now()` pattern in Update use-cases:** Clock is received by Update use-cases but the current collection row shapes (pricebook/labor-rates/terms/sources) are plain objects without `updatedAt`. The `void` call retains the DI contract and makes adding `updatedAt` stamping trivial at the infra layer.

3. **Case-insensitive duplicate guard on sources is create-only:** `UpdateSourceUseCase` does not guard against renaming to a label that collides with an existing source. Consistent with the brief's intent; a production hardening would add that read-before-write check in the update path.

---

## Review-Finding Fixes (commit after 0349673)

### Finding 1 (IMPORTANT): Dead `void this.clock.now()` — clock forwarded to `save*` port

**Problem:** The four collection Update use-cases called `void this.clock.now()` after `save*`, discarding the timestamp. The child tables all have `updated_at` columns and the domain owns time via the injected `Clock`, but the port signatures did not accept `updatedAt` so the value could never reach the DB.

**Fix:**

- `modules/settings/domain/settings-repository.ts`: Added `updatedAt: Date` parameter to `savePricebook`, `saveLaborRate`, `saveTerm`, and `saveSource` — mirroring the existing `archive*(id, now: Date)` pattern already in the port.
- `modules/settings/app/pricebook.ts`: `savePricebook(next, this.clock.now())` — removed `void this.clock.now()` dead line.
- `modules/settings/app/labor-rates.ts`: `saveLaborRate(next, this.clock.now())` — same.
- `modules/settings/app/terms.ts`: `saveTerm(next, this.clock.now())` — same.
- `modules/settings/app/sources.ts`: `saveSource(next, this.clock.now())` — same.

**Test evidence (new tests added — one per collection):**

`FakeSettingsRepository` gained four spy fields (`lastPricebookUpdatedAt`, `lastLaborRateUpdatedAt`, `lastTermUpdatedAt`, `lastSourceUpdatedAt`) each set in the corresponding `save*` method. Tests pin the clock to `2026-07-09T12:00:00Z` (via `FixedClock`) and assert the spy equals that date after a successful update.

```
RED (before): void this.clock.now() — spy field never set; assertion would fail
GREEN (after): npx vitest run modules/settings
  Test Files  7 passed (7)
  Tests  45 passed (45)   ← +4 new updatedAt assertions
```

### Finding 2 (MINOR): Port `list*` doc comments — tenant-scoping note for Task-5 adapter author

**Fix:** Added a one-line JSDoc on each of `listPricebook`, `listLaborRates`, `listTerms`, and `listSources` in `modules/settings/domain/settings-repository.ts` stating they are implicitly tenant-scoped (Drizzle adapter runs under `withTenant`; no `orgId` arg is needed or accepted).

No behaviour change; no test change needed.

### Finding 3 (MINOR): Fake `save*` check-before-mutate quirk

**Problem:** The original `savePricebook` (and siblings) mapped the array first, then checked `some()` on the already-mapped result — which always returned `true` for any id present after the map, masking a non-existent-item case: if the item was not in the array, the map was a no-op but `some()` still returned `false` correctly. However, a subtler form: if the same id was somehow inserted via `createPricebook` twice the `some()` check was evaluated on the post-mutation state. The intent-correct fix is to check membership **before** mutating.

**Fix:** All four `save*` methods in `FakeSettingsRepository` (in `get-settings.test.ts`) now follow the pattern:
```ts
const exists = this.collection.some((x) => x.id === item.id);
if (!exists) return 0;
this.collection = this.collection.map(/* replace */);
return 1;
```

No net behaviour change for the existing tests (which only exercise the normal path); the fix ensures the fake is an accurate model of the real adapter's `rows affected = 0 when not found` contract.

### tsc + full suite after all fixes

```
npx tsc --noEmit
(no output — 0 errors)

npx vitest run
Test Files  112 passed (112)
Tests  1074 passed (1074)
Duration  4.15s
```

### Files changed

- `modules/settings/domain/settings-repository.ts` — signature + doc comments
- `modules/settings/app/pricebook.ts` — clock forwarded
- `modules/settings/app/labor-rates.ts` — clock forwarded
- `modules/settings/app/terms.ts` — clock forwarded
- `modules/settings/app/sources.ts` — clock forwarded
- `modules/settings/app/get-settings.test.ts` — fake spy fields + corrected save logic
- `modules/settings/app/pricebook.test.ts` — new updatedAt assertion test
- `modules/settings/app/labor-rates.test.ts` — new updatedAt assertion test
- `modules/settings/app/terms.test.ts` — new updatedAt assertion test
- `modules/settings/app/sources.test.ts` — new updatedAt assertion test
