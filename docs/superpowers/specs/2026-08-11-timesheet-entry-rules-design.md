# Timesheet entry rules — delete, overlap, future days

Owen (Aug 11): "I need the ability to delete a timesheet entry; I should be able to add future
time; isn't it an issue these times coincide?" (two Shop rows 10a–10p and 10:37a–10:38a both
counting toward a 12.02 h day).

## The full rule matrix (what exists, what this adds)

| Rule | Before | After |
|---|---|---|
| End after start, same-day rows, no overnight | domain `TimeEntry.create` | unchanged |
| Approved = locked (edit AND delete); reopen is office-only | use-cases | unchanged |
| Tech touches only their own rows; office touches any | router authz | unchanged |
| Soft-delete only | repo `remove(id, now)` | unchanged (server existed; **UI now exposes it**) |
| **No two rows for the same person may overlap** | ❌ nothing — overlaps double-count payroll | ✅ refused at create AND update, clash named |
| Manual row vs the open day clock | ❌ nothing — clock-out later overlaps it silently | ✅ refused when the row starts at/after the open segment's start |
| Day window for the technician's own add/edit | past 7 days only | past 7 days **+ next 7 days** |
| Clock taps are never refused | clock writes bypass the manual path | unchanged (verified: `SetClockStateUseCase` → repo directly) |

## Decisions taken (flagged in the PR for Owen)

1. **Overlap is a hard block, not a warning.** The day clock produces strictly sequential
   segments — a break is its own segment beside, never inside, a worked one — so for one person
   two rows at the same moment is always an error, and letting it through double-pays.
   Boundary-touch (one row ends 10:00, next starts 10:00) is allowed.
2. **Future window = 7 days**, symmetric with the existing 7-day back window. Server never
   enforced a window (UI-only gate); that stays as-is.
3. **Delete is armed two-tap** (house grammar: quiet red, never the primary slot), and only
   reachable where the editor already unlocks — approved rows stay locked server-side too.
4. **The add flow's copy follows the window**: "Add hours you already worked" became
   "Add hours" (with the subtext naming both directions) — the form now books planned time
   ahead, and copy that says otherwise would be lying about what the control does.

## Components

- `modules/timesheets/domain/overlap.ts` (new, pure): `findOverlap(candidate, existing)` →
  the clashing entry or null. Ignores deleted + canceled-out rows isn't needed (repo list
  already excludes deleted). Treats a `running` row as open-ended `[start, ∞)`. Excludes the
  candidate's own id (update case). String minute math, no Date, no timezone.
- `modules/timesheets/app/overlap-gate.ts` (added after adversarial review): the ONE gate both
  use-cases call — lists same tech + same workDate, refuses an inverted window up front in the
  domain's words, refuses loudly if the day exceeds one 200-row page (the gate is the
  invariant's only enforcement — trusting page 1 silently is how an overlap would slip
  through), excludes the candidate's own id (so an idempotent RETRIED create with a
  client-authored id is never misdiagnosed as an overlap), then `findOverlap` →
  `validation(...)` naming the clash ("Overlaps Shop 10:00–22:00 — adjust the times or edit
  that row." / "Still on the clock since 10:00 — close the day before adding hours over it.").
- `features/field/my-hours-edit.ts`: `editWindowDates` returns today → +7 ascending, then
  yesterday → −6 descending (today stays the default selection); `isWithinEditWindow`
  accepts the future side.
- `features/field/use-my-hours-writes.ts`: `removeEntry` via `v1.timesheets.remove`, same
  non-optimistic reload pattern as save/add.
- `features/field/my-hours-time-editor.tsx`: armed two-tap Delete beside Save/Cancel.

## Out of scope

- Flagging pre-existing overlapping rows in the office sheet (the 12.02 h day) — the fix for
  those is now deletable rows; a day-header overlap badge is a follow-up if wanted.
- DB exclusion constraint — all manual writes flow through the two use-cases; a migration on
  the shared single-writer ledger isn't warranted for this.
- Office Timesheet tab editing — that surface is read + approve; edits happen on My hours.

## Testing

TDD throughout: domain helper (new test file), both use-cases (extend existing tests), window
helper (extend `my-hours-edit.test.ts`), delete UI (extend the editor/page tests). Full gate
before PR.
