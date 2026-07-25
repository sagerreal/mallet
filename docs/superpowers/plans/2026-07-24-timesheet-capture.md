# Technician time capture in Mallet — the recommendation and the build plan

*Branch context: all paths are in the QBO worktree `/Users/owensmacbook/Downloads/prospecting/mallet-app-qbo` (branch `feat/qbo-timesheet-sync`). Next migration number is 0090.*

---

## 1. The recommendation

**Ship one clock with four states, driven by taps the tech already makes.**

There is a single running clock per technician, and it is always in exactly one state: `shop`, `travel`, `job`, or `break`. The tech opens it once in the morning ("Start day") and closes it once at night ("End day") — two taps. Everything in between is written by taps he already makes for other reasons: **On my way** flips the clock to `travel` on that job, **Arrived** flips it to `job`, **Done** flips it back to `shop`. Break is one button on My day. Nothing else is asked of him, and nothing he taps is a data-entry chore.

The reason this fits a 1-3 tech plumbing shop is the failure mode, not the happy path. Because the day punch bounds the whole day, **payroll totals stay correct even when tap discipline collapses.** If the tech taps six Dones at 6pm from the truck, his paid hours are still right to the minute — only the job-cost attribution degrades into `shop`. That is the opposite of a derive-only model, where the same behaviour produces five zero-minute jobs and one nine-hour monster, and the opposite of a job-timer-only model, where a forgotten Stop is unpaid or infinitely paid. Wrong job costing is a report you squint at; wrong hours is a fight with your one employee and an FLSA record you cannot defend.

And it costs the wedge almost nothing: **two taps a day for payroll, zero taps for job costing.** Compare that to what it replaces — a paper card on the dash, a group text, or a second app.

---

## 2. The founder's question, answered

> Do techs fill it in themselves, is it a clock in/out button, or both?

**Both — but they are not the same thing, and only one of them is the capture mechanism.**

- **The clock in/out button is the capture mechanism.** One day-level punch, plus state changes driven by job taps. This is where hours come from.
- **Tech self-entry exists only as a repair tool.** He can fix his own draft day on My hours: correct a start or end, add a block he missed, stop a day he left open. He is never asked to *author* a timesheet.

Here is why, specifically, against the evidence:

**Why not derive-only (no clock button).** This was the tempting answer and the adversarial pass killed the "rather than a clock" clause outright. Three reasons:

1. **0 of 7 vendors did it.** Jobber, Workiz, Housecall Pro, ClockShark, ServiceTitan, Workyard and Connecteam all keep a day-level container alongside job capture. Not one replaced it.
2. **The one vendor that built exactly the proposed mechanism refuses to let it touch payroll.** Housecall Pro derives "from when an employee taps On my way, to the time they tap Start job, to the time they tap Finish job" — and then states in its own help centre: *"Time tracked using the Travel and time on jobs feature does not reflect in the total clocked in and timesheets."* They shipped it at scale and walled it off from the timesheet.
3. **ServiceTitan does derive into payroll — and only survives because it auto-fills the gaps.** It models "Idle time: Hours between jobs and non-job events," priced paid or unpaid, so the tech never accounts for the space between jobs. Copy the derivation without the gap-filler and you get a timesheet full of unpaid holes: van loading, the supply house, waiting on a part. In our schema `kind` has `travel` and `shop` values with no derivation source in the tap chain at all.

**Why not a job timer as the hero.** The current hero at `/Users/owensmacbook/Downloads/prospecting/mallet-app-qbo/components/modals/tech-job-modal/field-timer.tsx` is a big "Start timer" clock that is pure local React state (`baseSec`/`running` at lines 26-29), remounts on every visit-status change (`key={curVisit.id}` at `tech-job-modal.tsx:233`), and persists nothing. Its own header comment says "deferred: persist timer + log to timesheets". **No vendor makes a bare timer the hero of a job screen.** Jobber's visit timer is started *from the scheduled visit*; Workiz's is a quick action *on the job*; ClockShark makes job selection part of the clock-in itself. A standalone timer is one more thing to forget, and Jobber's own docs concede the cost: a timer left running past midnight goes "stuck" and *the office* has to rescue it from the web.

**Why self-entry is mandatory even though it is not the capture mechanism.** Under 29 CFR 516.2 the accuracy of hours-worked records is the employer's burden, and *Anderson v. Mt. Clemens Pottery* shifts the burden to the employer when the record is inadequate. A machine-written timesheet with no correction path and no attestation is a *worse* legal position than a paper card, because it reads as authoritative and is provably incomplete. Every vendor solved this: Connecteam ships a literal "I Forgot to Clock In" flow; Jobber lets techs edit their own entries by default (adds limited to the current day); Workyard pushes correction to the worker's phone explicitly "saving you manual corrections". Today Mallet's tech has **no** correction path — `/Users/owensmacbook/Downloads/prospecting/mallet-app-qbo/app/(field)/my-hours/page.tsx` is strictly read-only — which means the only corrector is the spouse at the kitchen table on Sunday reconstructing a week she wasn't present for. That is the worst reconstruction surface available and it is our ICP's actual office.

The good news: **the backend for tech self-edit is already shipped and correctly guarded.** `/Users/owensmacbook/Downloads/prospecting/mallet-app-qbo/modules/timesheets/api/time-entry-router.ts` already permits a tech to create for themselves (102-104), update their own (137-139) and remove their own (170-172). No client has ever called them from the field.

---

## 3. The model, end to end

### The invariant

**At most one `running = true` time entry per tech, ever.** Jobber and Workiz converged on this independently — *"since only one timer can run at once, you'll need to stop the running timer before being able to clock in"*; *"if the technician is signed into the timesheet and clocks into a job, the technician will now be signed out of timesheets and into that specific job... the technician is now signed back into timesheets."* We enforce it in Postgres, not in a hook.

### What the tech does

| Tap | Where | What the system writes |
|---|---|---|
| **Start day** | My day, one row at top | Close nothing. Open `{kind:'shop', src:'clock', running:true, jobId:null}` |
| **On my way** | Job screen visit row | Close the open entry at now. Open `{kind:'travel', jobId:X, src:'clock', running:true}`. Stamp `visit.enroute_at` |
| **Arrived** | Job screen visit row | Close travel. Open `{kind:'job', jobId:X, running:true}`. Existing `startedAt` stamp unchanged |
| **Done** | Job screen visit row | Close job. **Auto-resume** `{kind:'shop', running:true}` (Jobber's rule: *"If you already had the general timer running, it will start again now that the appointment timer has stopped"*) |
| **Break / End break** | My day | Close open → open `break` → close → resume `shop` |
| **End day** | My day | Close the open entry. No running rows remain |

The tech is never asked to pick a job for a time entry, never asked to categorise time, and never asked to type a duration. **Job attribution is a side effect of dispatch communication he already performs** — On my way exists because customers want it.

### What the office does

Nothing new in the normal case. The existing Jobs → Timesheets panel (`/Users/owensmacbook/Downloads/prospecting/mallet-app-qbo/features/jobs/timesheets-panel.tsx`) keeps its role: review the week, fix what's wrong, **Approve week**. It gains three things: running entries become stoppable/editable instead of inert; a week containing an unfinished entry cannot be approved; and a tech with zero recorded hours on a day he had jobs is visible rather than absent.

The office also keeps the ability to add and edit entries on a tech's behalf — that is the ClockShark Crew Clock need ("supervisors punch the clock for other employees") solved by a surface we already shipped. **We do not build Crew Clock.**

### What the system derives

Only three things, all pure functions, all unit-testable:

1. **The wall-clock conversion.** `visit.startedAt` is `timestamptz`; `time_entries.workDate`/`startTime` are `date` + `time` (`/Users/owensmacbook/Downloads/prospecting/mallet-app-qbo/shared/db/schema/time-entries.ts:28-31`). Converting one to the other requires an org timezone. **There is no timezone column anywhere in the schema** — I checked `orgs.ts` and `org-settings.ts` (columns 25-73). This is a hard blocker and PR 2 adds it.
2. **The midnight split.** `TimeEntry.create` hard-rejects `end <= start` (`/Users/owensmacbook/Downloads/prospecting/mallet-app-qbo/modules/timesheets/domain/time-entry.ts:68-70). Any segment crossing midnight becomes two rows: `…→23:59` and `00:00→…`. This is ServiceTitan's exact rule: *"If at midnight, a technician is working a job... they're automatically clocked out at 11:59 PM for that day and automatically clocked in at 12:00 AM for the next day."*
3. **The zero-length collapse.** If a transition lands in the same minute as the previous one, no row is written and the previous segment simply extends. This is what stops "six Dones at 6pm" from producing five junk rows.

### What gets approved

Approval is the shop's signature and the **only** trigger for anything leaving Mallet. Rules:

- Only `draft` entries approve. Already true.
- **A running or end-less entry blocks approval of that week**, with the offending day named. Not true today — see PR 0.
- Approved means **locked**, requiring an explicit Reopen to edit (ClockShark: *"Time must be unapproved in order to edit"*). Not true today — see PR 0.

### What reaches QuickBooks

Unchanged from what was just built, and the state machine feeds it cleanly:

- Only `approved` entries (`/Users/owensmacbook/Downloads/prospecting/mallet-app-qbo/trpc/qbo-sync-wiring.ts:71`).
- `break` never goes (`time-activity-mapping.ts:74-76`) — matching Jobber: *"unpaid break hours are not synced to your payroll provider."*
- `job` goes `billable: true`; `travel` and `shop` go as non-billable worked time.
- No OT split — QBO computes it.

Net effect: **QBO hours = day punch total − breaks**, every time, regardless of how well the tech tapped.

---

## 4. The hard cases

**Forgot to clock out.** The day clock is left running. The next read of My hours (or the office grid) shows that day as **"Still open — needs an end time"** with a pre-filled suggestion equal to the last completed job activity that day — ServiceTitan's rule verbatim: *"If a technician... forgets to clock out, their clock-out time is set to the completion time of their last activity."* **The difference: we suggest, a human accepts.** One tap for the tech, or the office does it. The week cannot be approved until it is resolved, so the hours can never silently vanish into the QBO `NOT_FINISHED` rejection at `time-activity-mapping.ts:79-81`. We do **not** auto-close on a cron — inventing hours nobody confirmed is exactly the record that loses a wage claim.

**Two jobs in a day.** Nothing special. Done on job A auto-resumes `shop`; On my way to job B flips to `travel` with `jobId=B`. Both jobs get their own `job` rows; the drive between them is one `travel` row correctly attributed to B. ClockShark's "switch" behaviour, without a switch button.

**Travel between jobs.** Captured as `travel` attributed to the *destination* job. If he never taps On my way, the time sits in `shop` — paid, in the day total, uncosted. Never lost. Worth stating plainly: **travel-vs-shop accuracy depends entirely on the On my way tap, and that tap is optional forever.** We should not pretend otherwise on a shop-owner demo.

**Lunch.** One `break` button, `kind='break'`, unpaid, excluded from the paid rollup (`tsPaid` at `/Users/owensmacbook/Downloads/prospecting/mallet-app-qbo/features/jobs/timesheet-derive.ts:54-56`), never sent to QBO. Break is the *only* state inside the day that is unpaid — everything else in the container is paid. That single sentence is the whole policy, and it is defensible.

**A job that spans midnight.** The 10:40pm→12:20am emergency call — the highest-margin job in the plumbing beachhead — splits into `22:40→23:59` on day one and `00:00→00:20` on day two. Both are valid entries, both sync, both approve independently. **We lose one minute per crossing.** ServiceTitan loses the same minute. I recommend accepting it rather than migrating `time_entries` to `timestamptz`, which would break the pickers, `tsHours`, the QBO mapper and every existing row.

**A tech with no phone signal.** This is the weakest part of the plan and I want to be plain about it. Phase 1: the client sends the **device's** event timestamp with each tap, and the server clamps it (never before the current open row's start, never more than a few minutes ahead of server now). If the request fails, the tap fails visibly — the existing `WriteErrorToast` — and the tech re-taps when he has bars, with the original timestamp preserved in the retry. **A true offline queue is not in this plan.** Workyard's answer is GPS ground truth, which we have not built and I am not proposing; Jobber's own answer is *"we recommend tracking your time manually"* in low-connectivity areas. Ours is: the day punch bounds the total, so a lost mid-day tap costs attribution, not pay. Confidence here is moderate at best, and it is the first thing I would want a real plumber to break.

**A 1099 sub.** He should never be on a payroll clock — a punch clock is evidence of control and control is the IRS's classification test. Recommendation: add `users.hours_mode` in `('payroll','job_cost_only')`. In `job_cost_only`, the day-clock row is hidden entirely, no break button, no OT display; job segments are still written from his taps because **you still need to know what his jobs cost you**. QBO already supports this: `sync-approved-hours.ts:59` maps person kind from `link.qboEntityKind ?? "Employee"`, so a Vendor link works today. Today `users.role` is only `('owner','office','tech')` (`shared/db/schema/users.ts:30`) with an `isFieldCrew` boolean — there is no contractor concept at all.

**The owner who is also the tech.** He gets the job segments (job costing matters most to him) and the **day clock defaults off** for `role='owner'`, with a toggle. Making a man punch himself in and out of his own company is the fastest possible way to get the entire feature ignored, and in a shop this size he is usually not on an hourly W-2 clock anyway. When he flips it on — some owners do want to see their own hours on a job — it behaves identically.

**A correction after the hours already synced to QuickBooks.** This is the ugliest corner and it deserves an honest answer. `SyncApprovedHours` does a `succeededIds()` lookup up front for idempotency — the same lookup that makes re-approval safe makes a *corrected* entry invisible to the second push. So today: Reopen → edit → re-approve leaves QuickBooks holding the **old** hours, silently.

My recommendation for v1 is **block-and-tell, not silently-fix**: an entry that has already synced is marked "Sent to QuickBooks" in the grid, and reopening it requires acknowledging a line that says *"These hours are already in QuickBooks. Changing them here will not change them there — fix the TimeActivity in QuickBooks too."* Building the update/void path is a follow-up PR, not a v1 blocker, because in a 1-3 tech shop this happens a handful of times a year and a wrong-but-quiet sync is far worse than a right-but-manual one.

There is a related trap to close in the same breath: `SetVisitStatusUseCase` supports `complete → pending` (the ↩ Reopen button) and **clears `completedAt`** (`set-visit-status.ts:75-76`). Reopening a job next week must **never** retroactively mutate a time entry that is already approved. Rule: the clock writer only ever touches the currently-open `draft` entry. Reopening a job opens a *new* segment; it never rewrites history.

---

## 5. What changes in the codebase

Ten PRs. Each stands alone; the first two are shippable before any design is agreed.

### PR 0 — Approval must not swallow unfinished hours
*Exists because the server will happily approve a running entry that QuickBooks then rejects, and the hours disappear with no error reaching anyone.*

- `/Users/owensmacbook/Downloads/prospecting/mallet-app-qbo/modules/timesheets/infra/drizzle-time-entry-repository.ts:159-175` — `approveWeek` updates every `draft` row in range with no `endTime is not null` condition. The client optimistically skips running rows (`lib/store/slices/timesheets-slice.ts:166` filters `!e.running`) so the store and the database already disagree today.
- Change: `ApproveWeekUseCase` returns a typed refusal listing unfinished dates; the repo predicate adds `running = false and end_time is not null`.
- `/Users/owensmacbook/Downloads/prospecting/mallet-app-qbo/modules/timesheets/app/update-time-entry.ts:26-49` — no `status === 'approved'` guard; an approved entry can be silently rewritten while `approvedAt` stays set. Add the guard; the only path through it is `reopen`.
- Tests: `approve-week.test.ts`, `update-time-entry.test.ts`, `drizzle-time-entry-repository.int.test.ts`.

### PR 1 — Delete the fake clocks
*Exists because two prominent controls lie to the user, and nothing real can be built on top of them.*

**Deletions:**
- `/Users/owensmacbook/Downloads/prospecting/mallet-app-qbo/components/modals/tech-job-modal/field-timer.tsx` — whole file.
- `clockLabel` in `/Users/owensmacbook/Downloads/prospecting/mallet-app-qbo/components/modals/tech-job-modal/helpers.ts:87-88` — used only by that file.
- The `FieldTimer` branch in `tech-job-modal.tsx:233` and its references in `tech-job-modal.test.tsx`.
- `ClockCard` + the duplicated local `TS_KINDS` + `clockState` state + the two "deferred" handlers in `/Users/owensmacbook/Downloads/prospecting/mallet-app-qbo/app/(field)/my-day/page.tsx:118-168,187,206-214`.
- CSS: `.tjclock*` at `/Users/owensmacbook/Downloads/prospecting/mallet-app-qbo/app/prototype.css:1531-1534,1849`; keep `.clockcard/.clock-head` (1464, 1715) — PR 6 reuses them.

The tech job screen loses its hero. That is correct: for a not-done job the hero should be the address and the visit row, which is what he actually needs.

### PR 2 — Org timezone and the wall-clock helper
*Exists because we cannot turn a `timestamptz` stamp into a `date` + `HH:MM` row without knowing what "today" means for this shop.*

- Migration 0090: `org_settings.timezone text not null default 'America/Los_Angeles'` (IANA), plus a Settings row.
- New pure module `modules/timesheets/domain/wall-clock.ts`: `toWallClock(instant, tz) → {workDate, hhmm}` and `splitAtMidnight(segment)`.
- Note for the record: the front desk's `hoursWdOpen/Close` integers (`org-settings.ts:34-39`) have the same latent assumption. Out of scope here.

### PR 3 — "On my way" actually persists
*Exists because today that tap is a server no-op, so travel time is underivable.*

`storeStatusToBackend` maps `"enroute"` to `pending` (`/Users/owensmacbook/Downloads/prospecting/mallet-app-qbo/lib/store/dto-mapper.ts:87-100`), the visit is already pending, and `SetVisitStatusUseCase` short-circuits it as idempotent (`set-visit-status.ts:54-57`).

- Migration: `job_visits.enroute_at timestamptz null`. **Do not add a fifth status value** — that would touch the check constraint, the transition matrix (`set-visit-status.ts:23-28`), the job-status derivation and the DTO enum. A stamp is a fraction of the blast radius.
- `enroute` becomes a *derived* store word: `status==='pending' && enrouteAt ? 'enroute' : 'scheduled'` in `toStoreVisit` (which currently drops `startedAt`/`completedAt` entirely, `dto-mapper.ts:417-432`).
- New command `setVisitEnroute` stamping `enroute_at`; cleared on reopen.

### PR 4 — The tech can set his own visit status
*Exists because the three buttons that are the capture mechanism are hidden from the only person who can press them.*

- Add `setVisitStatus` and `setVisitEnroute` to `/Users/owensmacbook/Downloads/prospecting/mallet-app-qbo/modules/jobs/api/field-router.ts` as `anyRole` behind `assertOnJobIfTech` (33-45) — the same pattern as `addAddon`/`setVerifyAnswer`. **Do not loosen `ownerOrOffice` on `visit-router.ts:181`**; office keeps its endpoint, techs get an assignment-gated one.
- `/Users/owensmacbook/Downloads/prospecting/mallet-app-qbo/components/modals/tech-job-modal/visit-row.tsx:109` — the `{!readOnly && ...}` block and `tech-job-modal.tsx:278`'s `readOnly={!isOffice}` stop hiding the step buttons. Reopen stays office-only.
- Ships standing alone: better dispatch visibility even before any clock exists.

### PR 5 — The clock state machine (server, pure, no UI)
*Exists because the transition rules are the thing most likely to be subtly wrong, and they should be reviewable without a screen attached.*

- New `modules/timesheets/domain/clock.ts`: given the open entry and a requested state, return the rows to close and open. Handles auto-resume-to-shop, zero-length collapse, midnight split, and same-state idempotency.
- New `modules/timesheets/app/set-clock-state.ts`.
- Migration: partial unique index `on (org_id, tech_user_id) where running and deleted_at is null`. `time-entries.ts` has no such index today, so "two running timers" is currently a legal database state.
- Heavy unit tests: the six-Dones-at-6pm case, the double-tap case, the midnight case, the crash-mid-transition case.

### PR 6 — Wire the taps, add Start day / End day / Break
*Exists because this is the PR where hours first become real.*

- Visit-status mutations in the field router run `SetClockState` in the **same transaction** as the visit write.
- `/Users/owensmacbook/Downloads/prospecting/mallet-app-qbo/app/(field)/my-day/page.tsx` gets a real day row where the fake ClockCard was: "Start day" → "On the clock since 7:42a · Break · End day".
- The tap payload carries the device timestamp; the server clamps it.
- `v1.field.start`/`complete` (job-level, from the My day cards) also drive the clock, so the two entry points cannot diverge.

### PR 7 — My hours becomes correctable
*Exists because a timesheet the worker cannot challenge is both a trust problem and a legal liability.*

- Tech can edit start/end on his own **draft** rows and add a missed block. Backend is already authorized (`time-entry-router.ts:97-104,126-139,159-172`) — this is client work.
- Window: current day plus the previous 6 (Jobber allows adds only for the current day; a plumber who worked Saturday and looks Monday needs more).
- "Your day is still open" banner with the suggested end time, one tap to accept.
- Approved days render locked with the reason.
- Fix the docstring lie at `/Users/owensmacbook/Downloads/prospecting/mallet-app-qbo/features/timesheets/timesheets-hydrator.tsx:5-6` (claims it mounts in both layouts; only `app/(office)/layout.tsx:54` mounts it). **Do not add a field mount** — My hours deliberately queries directly and should stay that way.

### PR 8 — The office grid learns the new shapes
*Exists because the approver currently cannot act on a running entry at all.*

- `/Users/owensmacbook/Downloads/prospecting/mallet-app-qbo/features/jobs/timesheets-entries.tsx:274-296` — a running entry renders "– running" with no edit, no delete and no stop. Give it a Stop control and an end-time editor.
- Approve week surfaces PR 0's refusal with the specific unfinished days.
- A tech with jobs but no hours on a day shows as "No hours recorded" rather than an empty row — absence must be visible.

### PR 9 — QBO correction honesty
*Exists because the idempotency that makes re-approval safe makes a corrected entry invisible to the second push.*

- Show "Sent to QuickBooks" on synced entries; require acknowledgement on reopen; do not pretend the correction propagates.
- Follow-up PR (not v1): void-and-recreate the `TimeActivity` by stored QBO id.

### PR 10 — Contractor mode and the owner default
*Exists because a 1099 sub should not be on a punch clock and an owner should not punch himself in.*

- `users.hours_mode` in `('payroll','job_cost_only')`, default by role.
- Day clock hidden for `job_cost_only`; job segments still written.

---

## 6. Decisions — ANSWERED by Owen, 2026-07-24

**DECIDED:**
1. **Wages in Mallet — NO.** Pay stays in QuickBooks. "HOURS only" holds. No gross-pay column, no
   rate field, no burdened cost rate (the narrow exception below is NOT taken).
2. **Auto-open the day on the first job tap — YES.** A tech who taps On my way with no day open gets
   a day opened at that moment. Do NOT copy ServiceTitan's block on a bare manual clock-in.
3. **Weekly tech attestation — YES.** One "These hours look right" tap per week on My hours.
   (This was decision-only in the research; it becomes **PR 11** below.)

Consequences for the PR list: the per-tech rollup cards show **Paid / Regular / OT hours only** —
no money. PR 10 keeps contractor mode but drops any rate concept.

## 6b. Original decision write-up (for the reasoning)

**1. Do wages belong in Mallet? — Recommendation: no. Hold the line, with one narrow exception later.**
"HOURS only — payroll owns the wage" is the right call and I would not touch it now. Payroll is a regulated system (tax filing, W-2s, garnishments, state registration) and it is the one adjacent tool where "we replaced it" is a promise you do not want to make to a plumber in year one. The narrow exception, *when and only when* a "what did this job actually cost me" screen ships: an owner-entered **burdened cost rate** per tech, owner-visible only, explicitly labelled as a costing assumption and not a wage of record. Do not put it in until the screen that consumes it exists.

**2. Should the day clock auto-open on the first job tap? — Recommendation: yes.**
If the tech taps On my way with no day open, open the day at that moment. It is ServiceTitan's behaviour (*"clock in happens automatically when... Dispatch to the first job"*) and it takes the morning punch from one tap to zero on most days. ServiceTitan additionally *blocks* a bare manual clock-in as the first paid event — an anti-fraud posture for 50-tech shops. **Do not copy the block.** In a shop where the owner knows the guy personally, a tech who loads the van at 7 needs to be able to say so.

**3. Should the tech attest? — Recommendation: yes, one line, weekly.**
Connecteam's employee-submit-then-admin-approve, minus the ceremony: one "These hours look right" tap on My hours per week. It costs one tap a week and it converts a machine-generated record into an employee-confirmed one, which is the entire difference in a wage dispute. If you think it reads as distrustful, the alternative is to make approval visible to the tech ("Approved by Sarah on Monday") and accept the weaker record.

**4. Break: auto-deducted or tapped? — Recommendation: tapped.**
An auto-deducted 30 minutes is the single most-litigated practice in wage-and-hour law, and it is wrong on the day he ate in the truck between calls. One button.

**5. Week start and the OT display. — Recommendation: make it a setting, or drop OT.**
`tsWeekStart` and the My hours page hardcode Monday (`my-hours/page.tsx:33-37`) with `FULL_TIME_HOURS_PER_WEEK = 40`. FLSA workweeks are employer-defined and plenty of trades run Sunday–Saturday. Showing "OT 4.0" against the wrong week boundary is an implicit legal claim that is simply false. Either add `org_settings.week_starts_on` or stop displaying OT and let payroll compute it (which it does anyway — we deliberately don't send an OT split to QBO).

**6. GPS. — Recommendation: not now, and know what you are giving up.**
Workyard's entire thesis is that the clock button is unreliable and GPS is the ground truth: *"Even if they forget and clock in late, you'll still see the actual arrival time."* Their model is genuinely more accurate than ours. It is also a permission prompt, a battery complaint, a privacy conversation with a guy who drives his own truck, and — per Jobber's own docs — *"Location timers require an active internet connection."* Not for the beachhead. If a shop ever disputes hours seriously, that is the upgrade path.

**7. Who fixes the forgotten punch — tech or office? — Recommendation: offer it to both, default to the tech.**
Workyard pushes correction to the worker "saving you manual corrections." The spouse at the kitchen table is the person this product exists to protect.

---

## 7. Risks, and what this plan deliberately does not do

**Risks**

- **The On my way tap stays optional forever** (`set-visit-status.ts:20-22` documents that Done is deliberately ungated). So travel-vs-shop attribution is best-effort and always will be. Payroll is unaffected; job costing degrades quietly. Do not sell travel-time reporting as precise.
- **Offline is the weak leg.** Timestamp-on-device plus clamping is a mitigation, not a solution. This is the highest-confidence place for the plan to be wrong in the field, and it should be the first thing tested with a real plumber in a real crawlspace.
- **Two taps a day is still two taps a day.** If techs stop punching, the day container degrades to "whatever the job taps say" — which is the derive-only model with all of its holes. The auto-open-on-first-tap rule is what keeps this from happening in the morning; there is no equivalent protection at night, only the block-approval-on-unfinished rule making the omission loud.
- **Transactional coupling of visit status and time.** Putting the clock write in the same transaction as the visit write means a clock bug can fail a dispatch action a customer is waiting on. The state machine must be total — every input returns a valid transition or an explicit no-op, never a throw.
- **The QBO correction corner is genuinely unsatisfying in v1.** We are choosing "tell the truth loudly" over "fix it silently and maybe wrongly." That is the right trade at this scale and it will still annoy someone.
- **Migration ordering.** Four migrations land across PRs 2/3/5 on a shared database with other sessions writing migrations. Per the known collision failure mode, verify the objects exist after each `db:migrate` — a silent no-op reports success.

**What this plan deliberately does not do**

- **No GPS, no geofence, no location anything.**
- **No offline queue.** Failed taps fail visibly and are re-tapped.
- **No `timestamptz` migration of `time_entries`.** Midnight splits instead, at the cost of one minute per crossing.
- **No new visit status value.** A stamp, not an enum change.
- **No Crew Clock.** The office already has a grid that can add entries for anyone.
- **No wages, no pay rates, no gross pay, no OT sent to QuickBooks.**
- **No second time system.** There is exactly one — this is the explicit refusal to repeat Housecall Pro's split brain, which they have to warn their own customers about in writing.
- **No approval workflow beyond week-approve and reopen.** No multi-step routing, no manager tiers. There is one approver and she is doing books on a Sunday.