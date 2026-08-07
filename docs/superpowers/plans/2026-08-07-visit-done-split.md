# Visit done ≠ job complete, and the tech can book the return trip

2026-08-07 · branch `feat/visit-done-split`

## The correction that shaped this plan

The first read of this was wrong and the record should say so. I told Owen "on a 3-visit job,
tapping Done on Tuesday bills a job that finishes Thursday" as though it were true everywhere. It
is true of **one** of the two Dones.

`SetVisitStatusUseCase` already derives job status from the visit set — *"every ACTIVE
(non-canceled) visit complete → the job completes"*. So the tech sheet's foot button, which runs
`setVisitStatus(visitId, complete)`, is **already correct** on a multi-visit job: finishing visit 1
of 2 leaves the job open. That cascade is good work and this branch does not touch it.

`CompleteJobUseCase` reads no visits at all. It calls `job.complete(now)`, saves, and emits
`job.completed` → ensure-an-invoice. `field.complete(jobId)` — the **✓ Complete button on the My
day agenda card** — goes straight there. So that button completes a job with visit 2 still sitting
`pending`, and bills it.

Two entry points for one intent that disagree. The field router already states the rule it broke:
*"The two entry points must not be able to diverge."*

## What is actually wrong

1. **`field.complete` ignores visits.** Completes the job and emits `job.completed` with
   outstanding visits, leaving those visits `pending` on a `complete` job.
2. **The foot label lies even where the behaviour is right.** `footActions` says "Finish job →"
   while finishing visit 1 of 2. Correct write, false sentence.
3. **A tech cannot create a visit.** All of `visit-router.ts` is `ownerOrOffice`. The field router
   has thirteen procedures and no visit creation — so a tech can sign a customer for found work
   (#389) and then has no way to book the trip that performs it.
4. **An unplaced visit makes a job read as done.** `recalcStatus` filters to *placed* visits, so a
   job with visit 1 complete and visit 2 unplaced returns `"done"` from placement alone. The
   follow-up is invisible on the board — the exact black hole that makes "let techs request a
   return visit" a bad idea without a guard.

## Scope

### 1. `field.complete` routes through the visit cascade

Replace the direct `CompleteJobUseCase` call with the same path `setVisitStatus` takes: complete
the caller's current visit and let the cascade decide the job. One meaning, two entry points.

- Job with one visit → completes, exactly as today. No behaviour change in the common case.
- Job with outstanding active visits → that visit completes, the job stays open, no
  `job.completed`, no invoice.
- Job with **zero** visits → keep the current direct-complete path. A visitless job has no cascade
  to run and My day can still close it.

Keep the implicit-start behaviour and the "finishing a job nobody started is legal in the field"
rule; both are deliberate and documented.

### 2. Labels follow the visit set

`footActions` gains one fact — whether another active visit remains — and says "Finish visit →"
when it does, "Finish job →" when it does not. Pure view-model change, covered by
`tech-job-foot.ts` tests.

### 3. `field.addFollowUpVisit`

New field procedure. `anyRole`, gated by `assertOnJobIfTech` (job-level: the person who walked the
site books the return, whichever visit carried them there). Delegates to the existing
`CreateVisitUseCase` — no new use-case, no migration.

```
input:  { jobId, reason: string (1..2000), durationHours (default 1) }
writes: job_visits row — assigneeUserId null, scheduledDate null, scheduledStart null,
        status "pending", notes = reason, position = max + 1
```

Unplaced and unassigned on purpose. **The tech records that a return is needed and why; the office
picks the slot.** Scheduling is a shop-level decision — parts arrival, other techs' loads — and
`CreateVisitCommand` already accepts nulls for all three placement fields, so tier 1 costs nothing
to model.

Refused when the job is terminal (same `CLOSED_JOB_MESSAGE` guard the sibling procedures use) — a
closed job takes a Reopen, not a new visit.

*Out of scope, deliberately:* letting a tech pick the time (tier 2). It needs the crew-schedule
availability reader and a settings flag, and tier 1 is the half that cannot be wrong.

### 4. The control on the tech sheet

A quiet full-width action in the visits section: **"Need to come back — add a visit"**, opening an
in-flow reason field (no popover — house rule). Confirmation copy tells the truth the tech can
repeat to the customer: *"The office will call to set a time."* Never a fabricated date.

### 5. An unplaced active visit means the job needs a slot

`recalcStatus` currently reads placed visits only. Add: if any active visit is unplaced and not
complete, the job is `"unscheduled"` — it surfaces in the existing **"Needs a slot"** bucket
(Owen's own label, already amber, already built). Without this, item 3 ships a black hole.

## Test plan

Unit, written first:

- `set-visit-status` / `complete-job` — unchanged, confirm no regression.
- `field-router` — `complete` on a 2-visit job completes the visit, not the job, and emits no
  `job.completed`; on a 1-visit job it still completes; on a 0-visit job it still completes.
- `field-router` — `addFollowUpVisit` appends an unplaced pending visit with the reason as notes,
  refuses an off-job tech (FORBIDDEN), refuses a terminal job (BAD_REQUEST).
- `tech-job-foot` — label is "Finish visit →" with another active visit, "Finish job →" without.
- `jobs-hydrator` — a job with one complete placed visit and one unplaced active visit recalcs to
  `"unscheduled"`, not `"done"`.

Integration (live DB): `addFollowUpVisit` round-trips and the row is org-scoped; `complete` on a
multi-visit job leaves the job open in the database.

## Gate

`tsc` · `lint` · `lint:css` · unit · `test:int` · coverage (80/75) · `build`.
