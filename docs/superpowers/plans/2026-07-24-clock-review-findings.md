# Adversarial review — clock.ts / wall-clock.ts

4 reviewers, 22 findings. Several proven by MUTATION testing (reviewer broke the code and showed the tests still passed).

## [HIGH] `clock.ts:127`
**Problem:** From idle, `planFromIdle` opens a segment for EVERY tap except `end_break`/`end_day` — including `done` and `break`, which are exit taps, not activity taps. So one stray tap after the day is ended silently re-opens the clock, and because `start_day` from a running `shop` entry hits the `isAlreadyIn` NOOP (line 131/161), the next morning's `start_day` cannot correct it. The phantom entry runs unbounded until the next real transition tap, which then closes it as one huge paid segment.

**Failure:** Replayed the real tap sequence through the plan (start_day 15:00Z, arrived 16:00Z JOB_A, done 23:00Z, end_day 2026-07-25T00:00Z → clocked out). One stray `done` at 2026-07-25T00:05:00Z (tech taps Done on a job card 5 min after ending the day) returns {close:null, open:{kind:"shop",jobId:null,startedAt:00:05Z}, noop:false} — the clock restarts while clocked out. Next morning `start_day` at 2026-07-25T15:00:00Z returns {close:null,open:null,noop:true} (NOOP — cannot fix it). `enroute` at 15:30:00Z then returns close:{id:"row-4",endedAt:15:30:00Z}, producing a FINISHED shop row 2026-07-25T00:05Z → 15:30Z = 15.42 hours. It is finished, so `unfinishedDates` will not block approval and it approves + pushes to QuickBooks as ~15.4 paid shop hours (split by splitAtMidnight into 17:05→23:59 and 00:00→08:30 local).

**Suggested fix:** Treat exit/pause taps as no-ops from idle, i.e. extend the idle guard to `if (target === null || tap === "end_break" || tap === "done" || tap === "break") return NOOP;` (only start_day/enroute/arrived — positive statements of activity — should auto-open). Independently, decide what `start_day` means when something is already running (see the separate finding) so a stuck clock has at least one recovery tap.

## [HIGH] `wall-clock.ts:239`
**Problem:** A segment that spans the DST fall-back is silently under-billed by exactly one hour. Row duration is derived as a pure wall-clock subtraction (TimeEntry.hours() = (endMinutes - startMinutes)/60, time-entry.ts:76-82), so the hour that the local clock repeats is never paid. The `backwards` guard on this line catches only the sub-case where the end wall time sorts BEFORE the start; the far more common case where the segment merely contains the repeated hour sails through with no error and no marker.

**Failure:** America/Los_Angeles, fall-back night 2026-11-01 (02:00 PDT -> 01:00 PST).

(a) Night shift crossing midnight: startedAt = 2026-11-01T05:00:00Z (Oct 31, 22:00 PDT), endedAt = 2026-11-01T14:00:00Z (Nov 1, 06:00 PST). Real elapsed = 540 min (9h00m). splitAtMidnight returns ok with rows [{2026-10-31, 22:00, 23:59}, {2026-11-01, 00:00, 06:00}] = 119 + 360 = 479 min = 7.98 h. The tech is paid 7h59m for a 9h00m shift — 60 minutes of wages lost on top of the 1 documented midnight minute.

(b) Same-day, no midnight involved: startedAt = 2026-11-01T07:50:00Z (00:50 PDT), endedAt = 2026-11-01T09:20:00Z (01:20 PST). Real elapsed = 90 min. Returns ok with one row {2026-11-01, 00:50, 01:20} = 30 min. 90 minutes worked, 30 billed.

The module comment at lines 137-140 states the ONLY loss is "ONE MINUTE" per midnight crossing, and wall-clock.test.ts:175-186 asserts that invariant — but only on 2026-07-08, a non-DST date. No test asserts billed minutes on either DST date; the two DST describe blocks (test lines 96-155) assert only the rendered HH:MM strings, never the duration consequence.

**Suggested fix:** Derive the row's duration from the instants, not from the wall-clock strings, and reconcile the difference explicitly. Either (a) carry the true elapsed minutes alongside each DaySegment so hours() can use them, or (b) detect the offset change (compare the zone offset at startedAt vs endedAt) and refuse / flag the segment for review rather than emitting a row whose wall times imply the wrong duration. At minimum, add tests that assert billed minutes (not just HH:MM) for a segment spanning 2026-11-01 and 2026-03-08 in America/Los_Angeles.

## [HIGH] `wall-clock.ts:146`
**Problem:** The mirror of the fall-back bug: a segment spanning the DST spring-forward gap is silently over-billed by one hour, because the row is built from raw wall-clock endpoints across a local hour that never elapsed. In the extreme, a segment of well under a minute is billed as more than an hour.

**Failure:** America/Los_Angeles, spring-forward 2026-03-08 (02:00 PST -> 03:00 PDT).

(a) 40 SECONDS billed as 1h01m: startedAt = 2026-03-08T09:59:30Z (01:59:30 PST), endedAt = 2026-03-08T10:00:10Z (03:00:10 PDT). Real elapsed = 40 s. splitAtMidnight returns ok with one row {2026-03-08, 01:59, 03:00} = 61 min = 1.0167 h of paid time. clock.ts:175-179 happily produces exactly this instant pair (the two taps are in different UTC minutes, so it closes the row normally rather than collapsing it), so it is reachable from a tech tapping Arrived then Done 40 seconds apart.

(b) Night shift: startedAt = 2026-03-08T06:00:00Z (Mar 7, 22:00 PST), endedAt = 2026-03-08T13:00:00Z (Mar 8, 06:00 PDT). Real elapsed = 420 min (7h). Rows [{2026-03-07, 22:00, 23:59}, {2026-03-08, 00:00, 06:00}] = 479 min = 7.98 h. Shop pays 8h for 7h worked.

wall-clock.test.ts:134-143 blesses the rendering of this exact hazard (row 01:00 -> 04:00 for a 120-minute segment) and even asserts elapsedMinutes === 120, but never asserts what the row bills — so the 60-minute overpay is untested and undocumented.

**Suggested fix:** Same root fix as the fall-back finding: duration must come from the instants. If wall-clock fidelity is the deliberate choice, the module must say so where it matters (the hours() contract) and the tests must assert the billed figure, so the ±1h on DST days is a recorded decision rather than a surprise on the first March/November payroll.

## [HIGH] `clock.ts:161`
**Problem:** `isAlreadyIn` makes `start_day` a no-op whenever a `shop` entry is already running, with no notion of how long it has been running or whether it started on a previous calendar day. `planTap` has no `now` and no maximum-duration concept, so a shop segment left open overnight can never be re-anchored by the one tap that means "my day begins now" — it just keeps accruing until some later tap closes it.

**Failure:** Fri 2026-07-24 18:02 PDT the tech taps Done from idle (planTap("done", null, 2026-07-25T01:02:00Z, null) → {open:{kind:"shop",startedAt:2026-07-25T01:02:00Z}}, the documented auto-open). Sat 07:00 PDT he taps Start day: planTap("start_day", {kind:"shop",jobId:null,startedAt:2026-07-25T01:02:00Z}, 2026-07-25T14:00:00Z, null) → {close:null, open:null, noop:true} — nothing is rewritten. At 16:00 PDT end_day closes it: {close:{id:"e1", endedAt:2026-07-25T23:00:00Z}} = 21.97 h. Fed through splitAtMidnight/LA that is [2026-07-24 18:02→23:59] + [2026-07-25 00:00→16:00] = 1317 billed minutes (21.95 h) for a 9-hour day — roughly 13 hours of overpay per forgotten end_day.

**Suggested fix:** Give planTap a `now`/max-shift bound and treat `start_day` as a re-anchor rather than a repeat when the running entry started before the current local work day (or exceeds a max shift length): close it (or mark it for review) and open a fresh shop segment at `at`. The `isAlreadyIn` short-circuit should apply only to taps inside the same shift.

## [HIGH] `clock.ts:151`
**Problem:** The comment at line 154 claims "the caller clamps device timestamps; the domain does not trust that it did", but the only temporal guard is `at >= open.startedAt`, and it sits *after* the `open === null` early return. The auto-open (idle) path therefore validates `at` not at all, and no path bounds `at` from above — a skewed or spoofed device clock silently anchors or closes a segment at an arbitrary instant.

**Failure:** planTap("start_day", null, new Date("2020-01-01T00:00:00Z"), null) → ok, {open:{kind:"shop",startedAt:2020-01-01T00:00:00Z}} — a day opens six years in the past. planTap("arrived", null, new Date("2031-05-05T00:00:00Z"), "job-a") → ok, opens job time five years in the future. Upper bound is absent even with a running entry: planTap("end_day", {id:"e1",kind:"shop",jobId:null,startedAt:2026-07-24T15:00:00Z}, new Date("2026-08-24T15:00:00Z"), null) → ok, {close:{endedAt:2026-08-24T15:00:00Z}} = a 744-hour paid segment from one mistimed tap.

**Suggested fix:** Take `now: Date` as a parameter and reject any `at` outside a bounded skew window (e.g. ±5 min of `now`, and never before the current local work day) on BOTH the idle and running paths — move the temporal validation into `rejectArgs` so it runs before the `open === null` branch.

## [HIGH] `clock.test.ts:120`
**Problem:** The matrix exhaustiveness guard only counts rows — `expect(MATRIX).toHaveLength(ALL_STATES.length * ALL_TAPS.length)` never checks that each (state, tap) pair is present exactly once. A duplicated row plus a dropped pair still totals 35, so the block that looks like a proof of totality is a proof of arithmetic. This is the single test the suite relies on to stop a tap/state pair going untested.

**Failure:** Verified by mutation against a copy of the real files. (1) In MATRIX, replace the row `{ state: "break", ..., tap: "end_day", ..., expected: { closes: true, opens: null } }` with a second copy of the `idle`/`start_day` row — length is still 35, the guard passes. (2) Inject a real bug in clock.ts: `if (tap === "end_day" && open?.kind === "break") return ok(NOOP);` — now a tech who taps End day while on break never gets the break row closed, so the break runs forever and the day's hours are lost. Result: `vitest run clock.test.ts` reports **67 passed (67)**. The bug ships green.

**Suggested fix:** Assert coverage, not cardinality: build `new Set(MATRIX.map(c => `${c.state}|${c.tap}`))` and assert it equals the cartesian product of ALL_STATES x ALL_TAPS (and that the set size equals MATRIX.length, to catch duplicates).

## [MEDIUM] `clock.ts:90`
**Problem:** `end_break` unconditionally targets SHOP, so tapping it while a NON-break entry is running closes real job/travel time and re-opens the same wall-clock minutes as unattributed shop time. The idle branch explicitly NOOPs `end_break` ("no break to end", line 127), but the running branch has no equivalent `open.kind === "break"` guard — so the same "there is no break to end" situation is destructive instead of inert.

**Failure:** planTap("end_break", {id:"e1", kind:"job", jobId:JOB_A, startedAt:2026-07-24T17:00:00Z}, 2026-07-24T18:00:00Z, null) returns {close:{id:"e1",endedAt:18:00:00Z}, open:{kind:"shop",jobId:null,startedAt:18:00:00Z}, noop:false}. The tech never went on break, yet on-site time on JOB_A is cut at 18:00Z and everything after it is booked as shop time with jobId null — job cost for JOB_A silently under-reports the rest of the visit. Reachable from any non-state-derived caller (API/tRPC call, queued offline tap, stale field UI).

**Suggested fix:** Guard the tap on the state it exits: if `tap === "end_break" && open.kind !== "break"` return NOOP (same reasoning as the idle branch). Same for a `break`-only end. Encode it in the matrix table in clock.test.ts, which currently asserts the destructive behaviour at lines 95 and 104.

## [MEDIUM] `clock.ts:80`
**Problem:** `start_day` targets SHOP unconditionally, so from `travel`/`job`/`break` it closes the running entry and opens shop. It is a NOOP only when a `shop` entry is already open (isAlreadyIn). That means the same button is inert mid-shift when the tech is in the shop but destroys job attribution when they are on a job — a stray/duplicate start_day mid-day truncates billable on-site time.

**Failure:** planTap("start_day", {id:"e1", kind:"job", jobId:JOB_A, startedAt:2026-07-24T16:00:00Z}, 2026-07-24T17:00:00Z, null) returns {close:{id:"e1",endedAt:17:00:00Z}, open:{kind:"shop",jobId:null,startedAt:17:00:00Z}, noop:false}. A tech one hour into JOB_A who taps "Start day" (double tap, stale Today screen, replayed request) has JOB_A's on-site segment closed at 17:00Z and the remainder of the visit recorded as jobId-null shop time.

**Suggested fix:** Make `start_day` a NOOP whenever any entry is already open (the day is already underway) rather than a transition to shop — or restrict it to the idle branch only. If a mid-shift "back at the shop" transition is genuinely wanted, give it its own tap so start_day cannot double as one.

## [MEDIUM] `clock.ts:107`
**Problem:** `rejectArgs` narrows with `open !== null`, so an `undefined` open entry falls through the null check and dereferences `open.startedAt`, throwing TypeError. The module's docblock promises "Pure and total: every (tap, state) pair yields a plan or an explicit validation error, never a throw", and the totality test (clock.test.ts:346) enumerates malformed taps/dates/jobIds but never `undefined` for `open` — `ALL_STATES` only contains `null`. `undefined` is exactly what a `findOpen`/`rows[0]`/`Array.find` lookup returns when nothing is running (the existing repo dodges it only because findById hand-writes `row ? toDomain(row) : null`, line 77), so the first repository method that forgets that normalisation turns a routine clock-in into a thrown error inside the dispatch transaction — i.e. a rolled-back, failed dispatch.

**Failure:** planTap("done", undefined as unknown as OpenEntry | null, new Date("2026-07-24T17:00:00Z"), null) throws `TypeError: Cannot read properties of undefined (reading 'startedAt')` at clock.ts:107-108. Same for planTap("start_day", undefined, ...). Verified by executing the module.

**Suggested fix:** Compare loosely / check truthiness at both sites: use `if (open == null)`-style guards (or `const running = open ?? null` normalised once at the top of planTap) so `undefined` takes the idle path instead of dereferencing.

## [MEDIUM] `wall-clock.ts:240`
**Problem:** Real work performed inside the repeated fall-back hour is refused outright, so the hours cannot be recorded at all — and clock.ts produces exactly the instant pair that triggers the refusal, without any indication that the close it planned is unrepresentable.

**Failure:** America/Los_Angeles, 2026-11-01. A tech arrives at 01:30 PDT (2026-11-01T08:30:00Z) and taps Done at 01:10 PST (2026-11-01T09:10:00Z) — 40 real minutes of billable on-site work. planTap("done", …) returns ok with close = {endedAt: 2026-11-01T09:10:00Z} (different UTC minutes, so no zero-length collapse). splitAtMidnight on that same pair returns err("segment ends at an earlier wall-clock time than it starts (ambiguous daylight-saving hour)"). There is no representable row, so 40 minutes of paid work is lost and the clock-out surfaces a validation error the tech cannot act on. Same outcome for startedAt 2026-11-01T08:59:30Z / endedAt 2026-11-01T09:00:10Z.

**Suggested fix:** Have the two modules agree on what is representable. Either clamp such a segment to the first pass of the repeated hour (e.g. end it at 01:59 and open a fresh row at 01:00 on the second pass, mirroring the midnight split), or make planTap refuse to plan a close it knows cannot be converted — so the failure happens at the tap, not silently at conversion time.

## [MEDIUM] `wall-clock.ts:252`
**Problem:** A genuine multi-minute segment that straddles local midnight is rejected as "segment covers no whole clock minute". Both candidate rows collapse to zero length (23:59->23:59 and 00:00->00:00), the billable filter empties, and the error fires — even though the segment is not sub-minute and the error message says it is. clock.ts deliberately treats this same pair as a normal, non-collapsed close.

**Failure:** America/Los_Angeles: startedAt = 2026-07-08T06:59:00Z (2026-07-07 23:59:00 PDT), endedAt = 2026-07-08T07:00:59Z (2026-07-08 00:00:59 PDT). Real elapsed = 119 s, spanning two distinct clock minutes. splitAtMidnight returns err("segment covers no whole clock minute") — factually wrong, and it means the segment cannot be stored at all. clock.ts is the source of such pairs: planTap("end_day", open startedAt 2026-07-08T06:59:30Z, at 2026-07-08T07:00:10Z) returns close = {endedAt: 2026-07-08T07:00:10Z} with discardOpen unset, i.e. it asserts this is a real segment worth a row (clock.test.ts:240-244 pins that behaviour: "a tap in the next minute closes the row normally").

**Suggested fix:** Either extend the zero-length collapse in clock.ts to cover the case where both endpoints truncate to the day's edge minutes, or make splitAtMidnight return the one representable row (2026-07-07 23:59 -> 2026-07-08 00:00 is exactly the minute the module already documents as unbillable, so returning zero rows without an error may be the honest answer). At minimum the message must not claim a 119-second segment covers no whole clock minute.

## [MEDIUM] `wall-clock.ts:201`
**Problem:** The new "Known limitation" comment claims "The fall-back direction IS handled below, because it produces a backwards row we can detect." That is false for the midnight-crossing case: in zones whose fall-back brackets local midnight, the 00:00 anchor picks the FIRST of two identical local midnights and no backwards row is produced, so the guard never fires and an hour disappears silently. The same hardcoded day edges are unsafe in the other direction too: END_OF_LOCAL_DAY = "23:59" (line 22) names an ambiguous local minute in zones that fall back at 24:00.

**Failure:** (a) Fall-back at midnight, undetected. America/Havana, 2026-11-01 (01:00 CDT -> 00:00 CST, so local 00:00 occurs TWICE — verified by scanning every minute of 2026: count(00:00) = 2 on that date). startedAt = 2026-11-01T03:00:00Z (2026-10-31 23:00 CDT), endedAt = 2026-11-01T05:30:00Z (2026-11-01 00:30 CST, second pass). Real elapsed = 150 min. splitAtMidnight returns ok with rows [{2026-10-31, 23:00, 23:59}, {2026-11-01, 00:00, 00:30}] = 59 + 30 = 89 min. 61 minutes lost, no error, no backwards row — contradicting the comment's guarantee.

(b) Ambiguous 23:59. America/Santiago, 2026-04-04 (falls back at 24:00, so local 23:59 occurs TWICE — verified: count(23:59) = 2). A segment from 2026-04-04 22:00 local to 2026-04-05 01:00 local runs 240 real minutes and bills 119 + 60 = 179 — 61 minutes lost through the same undetected path.

(c) The documented spring case, for completeness: America/Havana 2026-03-08 has NO local 00:00 (verified count = 0; 23:59 jumps straight to 01:00). startedAt = 2026-03-08T03:00:00Z, endedAt = 2026-03-08T06:00:00Z (180 real min) yields rows summing to 239 min and stamps startTime "00:00" — a `time` value that never appeared on any wall clock that day. Other affected zones found by the same scan: America/Santiago 2026-09-06, Africa/Cairo 2026-04-24, Asia/Beirut 2026-03-29.

**Suggested fix:** Correct the comment — the fall-back direction is only partly handled — or handle it. Deriving each day's first and last existing local minute (probe outward from 00:00 / 23:59 until the formatted parts confirm the date and time) closes both directions and removes the need for the two hardcoded edge constants.

## [MEDIUM] `wall-clock.ts:137`
**Problem:** The documented invariant — "Each crossing of local midnight LOSES ONE MINUTE ... a minute a midnight is the cheaper trade" — is false when the crossing also contains a DST transition. Because rows carry wall-clock HH:MM and `TimeEntry.hours()` derives pay as (endMinutes − startMinutes)/60, the transition hour is silently added to or removed from the tech's pay. No test covers a DST transition that also crosses midnight (the existing DST tests are all same-day), so the shortfall is untested as well as undocumented.

**Failure:** Fall-back overnight, America/Los_Angeles: startedAt 2026-11-01T05:00:00Z (Sat 2026-10-31 22:00 PDT), endedAt 2026-11-01T12:00:00Z (Sun 2026-11-01 04:00 PST) = 420 real minutes. splitAtMidnight returns [{2026-10-31, 22:00→23:59}, {2026-11-01, 00:00→04:00}]; TimeEntry.hours() totals 5.9833 h = 359 minutes. The tech is paid 5 h 59 m for 7 h 0 m on the clock — 61 minutes short (an FLSA hours-worked problem), not the documented 1. Mirror case, spring-forward: startedAt 2026-03-08T06:00:00Z (2026-03-07 22:00 PST) → endedAt 2026-03-08T11:00:00Z (04:00 PDT) = 300 real minutes but 359 paid — 59 minutes of overpay.

**Suggested fix:** Either derive the row durations from the instants (carry a real-minutes figure alongside the HH:MM row so hours totals come from elapsed time, not wall-clock subtraction), or — if wall-clock pay is the deliberate model — say so explicitly in the header comment, correct the "exactly one minute" claim, and add DST-across-midnight tests pinning both directions so nobody later 'fixes' it by accident.

## [MEDIUM] `clock.ts:155`
**Problem:** The backwards-time guard is evaluated before the zero-length collapse and is strict (`at < open.startedAt`), so a tap a fraction of a second *before* the running entry started is a hard validation failure, while a tap a fraction of a second *after* it — same clock minute, same non-representable duration — is handled gracefully by the collapse. Since the module explicitly contemplates device-supplied timestamps, a couple of seconds of skew between the clock that stamped `open.startedAt` and the clock that stamps `at` turns a clock-out into an error and leaves the entry running.

**Failure:** open = {id:"e1", kind:"job", jobId:"job-a", startedAt:2026-07-24T18:00:05Z}. planTap("end_day", open, 2026-07-24T18:00:04Z, null) → err(validation("tap time is before the running entry started", "at")) — nothing is written and the job segment stays open. planTap("end_day", open, 2026-07-24T18:00:06Z, null) → ok({close:null, open:null, noop:false, discardOpen:true}) — the identical situation one second later resolves cleanly. The failed clock-out leaves a running entry that the next tap (possibly the following morning) closes as a multi-hour segment, exactly the overpay path in the start_day finding.

**Suggested fix:** Test `inSameMinute(at, open.startedAt)` before the backwards guard, so a tap inside the opening minute always collapses regardless of sign, and reserve the hard rejection for taps that precede the start by more than the tolerated skew.

## [MEDIUM] `clock.test.ts:340`
**Problem:** The entire "Totality" describe block asserts nothing about behaviour. `expect(typeof r.ok).toBe("boolean")` is true for every possible Result, and `expect(...).not.toThrow()` is true for any total function. The block's own comment claims it verifies "either an actionable plan or a named validation failure" but it never distinguishes the two.

**Failure:** Verified by mutation: replace the body of `planTap` with an unconditional `return err(validation("MUTANT: everything refused", "tap"));` so that every tap in the app fails and no technician can ever clock in. Run `vitest run clock.test.ts -t "a tap can never throw"` → **3 passed | 64 skipped**. All three tests in the totality block, including the 7x5x4 = 140-combination loop, pass against a planner that refuses 100% of inputs.

**Suggested fix:** Assert the actual dichotomy per combination: when `r.ok`, assert the plan shape is well-formed (`noop === true` implies `close === null && open === null`; `noop === false` implies `close !== null || open !== null`); when `!r.ok`, assert `r.error.kind === "validation"` and that `r.error.field` is one of the known field names.

## [MEDIUM] `clock.test.ts:361`
**Problem:** The immutability test is blind to the mutation most likely to happen. `const snapshot = { ...open }` is a shallow copy, so `snapshot.startedAt` and `open.startedAt` are the SAME Date object; `toEqual` then compares a Date to itself. Any in-place mutation of the caller's timestamp — the one mutable object planTap receives — passes unnoticed.

**Failure:** Verified by mutation: add `if (open !== null) open.startedAt.setTime(0);` to `planTap` before `targetFor`, i.e. planning a tap silently rewrites the caller's running-entry start to 1970-01-01 (which would then be persisted as the segment start). Run `vitest run clock.test.ts -t "leaves the running entry untouched"` → **1 passed**. The test named for immutability is the one test that cannot see it.

**Suggested fix:** Snapshot by value, e.g. `const snapshot = { ...open, startedAt: new Date(open.startedAt.getTime()) }`, or freeze the input (`Object.freeze(open); Object.freeze(open.startedAt)`) and assert the call still succeeds under strict mode.

## [MEDIUM] `wall-clock.ts:199`
**Problem:** wall-clock.ts violates the Result-not-throw rule at its own boundary for non-Date inputs, and is inconsistent with its sibling in the same branch: clock.ts validates with `isValidDate = v instanceof Date && !Number.isNaN(v.getTime())`, while wall-clock.ts calls `.getTime()` / `formatWith`'s `instant.getTime()` directly and only guards NaN. A non-Date reaches the dereference and throws. Nothing in wall-clock.test.ts covers this, whereas clock.test.ts has an explicit "does not throw on malformed input a JS caller could pass" test — so the asymmetry is invisible.

**Failure:** All three throw TypeError instead of returning `err(validation(...))` (run against the live module): `toWallClock("2026-07-07T15:00:00Z" as unknown as Date, "America/Los_Angeles")` → `TypeError: instant.getTime is not a function`; `splitAtMidnight({ startedAt: "2026-07-07T15:00:00Z", endedAt: new Date("2026-07-07T18:00:00Z") }, LA)` → `TypeError: segment.startedAt.getTime is not a function`; `splitAtMidnight({ startedAt: null, endedAt: <Date> }, LA)` → `TypeError: Cannot read properties of null (reading 'getTime')`. A serialized instant (JSON/tRPC payload without a Date transformer) is the realistic source. Per CLAUDE.md the orgTx middleware re-throws inside the transaction, so this turns a nameable validation failure into a rolled-back request and a 500.

**Suggested fix:** Reuse clock.ts's guard: check `instant instanceof Date` before `.getTime()` in `formatWith` and check both ends of `Segment` in `splitAtMidnight`, returning `validation("startedAt is not a valid date", "startedAt")` / `"endedAt"`. Add the sibling's "does not throw on malformed input" test to wall-clock.test.ts.

## [LOW] `clock.ts:105`
**Problem:** The unknown-tap rejection interpolates the untrusted value into a template literal (`unknown tap: "${tap}"`). Symbol values throw on string conversion, so the very line whose job is to reject junk input throws for one class of junk — again inside the dispatch transaction, and again against the documented no-throw contract.

**Failure:** planTap(Symbol("x") as unknown as ClockTap, null, new Date(), null) throws `TypeError: Cannot convert a Symbol value to a string` instead of returning err(validation(...)). Verified by executing the module. (Not reachable across a JSON/tRPC boundary; reachable from any in-process JS caller.)

**Suggested fix:** Interpolate defensively: `validation(`unknown tap: "${String(tap)}"`, "tap")`, or drop the value from the message entirely.

## [LOW] `clock.ts:166`
**Problem:** The zero-length collapse tests minute-floor EQUALITY (`inSameMinute`) rather than elapsed duration, so the "a mis-tap leaves no junk row" guarantee depends on where the taps fall relative to a minute boundary, not on how long the segment was. A 58-second segment inside one minute is discarded, while a 1-second segment straddling a boundary is closed and becomes a real billable minute row.

**Failure:** planTap("arrived", {id:"e1", kind:"travel", jobId:JOB_A, startedAt:2026-07-24T18:00:59Z}, 2026-07-24T18:01:00Z, JOB_A) returns close:{id:"e1", endedAt:18:01:00Z} — a 1-second travel row. splitAtMidnight/toWallClock render it as startTime "18:00" → endTime "18:01", i.e. one paid minute of travel on JOB_A from a fat-fingered double tap. The mirror case (startedAt 18:00:01, tap 18:00:59, 58 s) is correctly discarded.

**Suggested fix:** Collapse on elapsed time, not on minute identity: `at.getTime() - open.startedAt.getTime() < MS_PER_MINUTE` (keeps the six-Dones case and also kills boundary-straddling sub-minute rows). Update the clock.test.ts case at line 240, which currently pins the boundary behaviour.

## [LOW] `wall-clock.ts:252`
**Problem:** The `billable.length === 0` rejection assumes the only ways to land there are a sub-minute segment or a repeated fall-back hour ("Neither covers a whole clock minute"). A segment that straddles local midnight in the 23:59→00:00 window produces two zero-length candidate rows (23:59→23:59 and 00:00→00:00), so a segment of up to ~2 real minutes is refused outright with a message that misstates why.

**Failure:** startedAt 2026-07-08T06:59:15Z (2026-07-07 23:59:15 PDT), endedAt 2026-07-08T07:00:45Z (2026-07-08 00:00:45 PDT), America/Los_Angeles — 90 real seconds spanning two distinct clock minutes — returns err(validation("segment covers no whole clock minute", "endedAt")). Same for 23:59:01→00:00:59 (118 seconds). The caller records nothing at all, and the failure is indistinguishable from the genuine sub-minute case, so a clock-out or visit-to-timesheet conversion at the stroke of midnight fails rather than storing the 1 minute that is representable.

**Suggested fix:** Before rejecting, keep the crossing case: when the candidate rows straddle midnight and the total elapsed covers at least one whole minute, emit the single representable row (e.g. the earlier day's 23:59→00:00 collapsed to the later day's 00:00→00:01, or the earlier day's 23:58→23:59 equivalent), and reserve the error message for genuinely sub-minute or wholly-repeated-hour segments.

## [LOW] `wall-clock.test.ts:142`
**Problem:** `expect(elapsedMinutes(startedAt, endedAt)).toBe(120)` (and the identical assertion at line 153) asserts arithmetic on the test's own literal inputs using the test's own helper — it subtracts two hard-coded Dates and compares to a hard-coded number. It constrains nothing about wall-clock.ts and would still pass if `splitAtMidnight` returned any well-formed rows at all. Contrast line 185, where the same helper is genuinely load-bearing because it is differenced against `billedMinutes(rows)`.

**Failure:** `elapsedMinutes(new Date("2026-03-08T09:00:00Z"), new Date("2026-03-08T11:00:00Z")) === 120` is true by construction of the literals and the helper; no value produced by the module under test appears in the expression. Deleting the import of `splitAtMidnight` would not change its outcome — only the `toEqual` row assertion above it does any work.

**Suggested fix:** Either drop the two inert assertions, or make them load-bearing the way line 185 does: assert the DST relationship the test is actually about, e.g. `expect(billedMinutes(rows)).toBe(180)` while `expect(elapsedMinutes(startedAt, endedAt)).toBe(120)` — pinning that the wall clock advanced three hours for two real hours of work.

## [LOW] `clock.test.ts:137`
**Problem:** The "a tap repeated on the state it produces writes nothing" block adds no coverage: all 7 of its `repeats` cases are byte-identical in inputs (same tap, same open entry, same `LATER`, same jobId) to matrix rows already asserted, with a strictly weaker expectation. It inflates the suite's apparent size (96 tests) without killing a single mutant the matrix does not already kill. Only the eighth test in the block, "a different job on the same kind is a real move", is new.

**Failure:** Case-by-case duplication of MATRIX: `start_day`+shop = line 81; `enroute`+travel/JOB_A = line 91; `arrived`+job/JOB_A = line 101; `done`+shop = line 84; `break`+break = line 112; `end_break`+shop = line 86; `end_day`+null = line 78. Each matrix row already asserts the stronger `expect(plan).toEqual({ close: null, open: null, noop: true })`, whereas the repeat asserts the three fields separately. Any implementation change that fails a repeat has already failed its matrix twin.

**Suggested fix:** Delete the `repeats` table and keep only the "different job on the same kind is a real move" test, which is the one genuinely new constraint. If the double-tap intent is worth stating, make it a real double tap — apply the first tap's plan via `applyPlan`, then tap again and assert the row count is unchanged.
