# AI Voice Front Desk — Vertical Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to
> implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the red-team coverage gaps so the voice front desk serves the top-10 trade ICP
verticals at 1–15 offices — real service-area distance, load+proximity dispatch, found-work
capture, a human-callback escape hatch, owner-set ballpark ranges, and photo intake — without
changing the one-off product model or requiring A2P/SMS.

**Architecture:** Extend `modules/frontdesk` (hexagonal domain/app/infra/api). A shared `Geocoder`
port (Census adapter) underpins both the service-area check and proximity dispatch. Playbook
extensions are additive to the `org_settings.booking` jsonb (absent = today's behavior). Each phase
is an independently shippable PR.

**Tech Stack:** Next.js 16 route handler · Drizzle/Supabase RLS · Vapi webhook · zod · Vitest.
Reuse: `SupabasePhotoStorageGateway.createUploadUrl`, `ResendEmailSender`, `DrizzleAvailabilityReader`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-14-frontdesk-vertical-coverage-design.md` (read first).
- Every external call (geocoder, email) has a timeout and **degrades gracefully — never fails a
  booking**; a geocode/email miss is logged, never thrown.
- Price guardrail holds: the only spoken dollars are `serviceFee` + flat `price` + (new) owner-set
  `ballpark`; the post-call price audit's allowed set is updated in lockstep whenever ballpark ships.
- Playbook/schema changes are ADDITIVE and back-compatible (absent field = current behavior).
- Org id ONLY from the To-number lookup; new tenant tables get hand-written `ENABLE`+`FORCE` RLS +
  composite FKs; repos filter `eq(orgId)`. New migrations auto-numbered; verify the table exists
  after `npm run db:migrate` (ledger-collision gotcha).
- computeSlots stays PURE (`now` is an input; no argless `Date`); DST-safe calendar-date math.
- DI; immutable; no `any`; files ≤400 lines pref / 800 hard; no barrel import in unit tests.
- Full gate before each PR: `npx tsc --noEmit` · `npm run lint` · `npm test` · `npm run test:int` ·
  `npm run coverage` (80/75) · `npm run build`. Each phase = one PR; Owen merges.
- OUT of scope: A2P/live SMS, multi-location, per-crew skill/zone tags, HVAC memberships/financing,
  septic routes.

---

## Phase 1 — Geocoding foundation + real service-area check

### Task 1.1: Geocoder port + Census adapter

**Files:**
- Create: `modules/frontdesk/domain/geocoder.ts` (port), `modules/frontdesk/infra/census-geocoder.ts`
- Test: `modules/frontdesk/infra/census-geocoder.int.test.ts`

**Interfaces — Produces:**
```ts
export interface GeoPoint { readonly lat: number; readonly lng: number }
export interface Geocoder { geocode(address: string): Promise<GeoPoint | null> }
```

- [ ] Write failing int test: a known US address ("1600 Pennsylvania Ave NW, Washington DC") returns
  a GeoPoint near 38.89,-77.03 (±0.05); an unresolvable string ("zzz not an address") returns null;
  a network/timeout path returns null (not a throw).
- [ ] Implement `CensusGeocoder` hitting `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress`
  (`benchmark=Public_AR_Current`, `format=json`), 3s `AbortController` timeout, an in-process
  `Map` cache keyed by normalized address, returns `{lat,lng}` from the first match else null. All
  errors caught → null + `logger.warn`.
- [ ] Add `Geocoder` to `ToolDeps`/`VoiceToolDeps` construction (a singleton adapter is fine — it's
  request-independent). Export from the frontdesk barrel.
- [ ] Run int test → PASS. Commit `feat(frontdesk): Geocoder port + Census adapter`.

### Task 1.2: Service origin on org_settings

**Files:**
- Modify: `shared/db/schema/org-settings.ts`, `modules/settings/domain/org-settings.ts`,
  `modules/settings/infra/settings-mapper.ts`, `modules/settings/api/settings-router.ts` +
  settings DTO, `app/(office)/settings/page.tsx` (origin field in the area card)
- Migration: generated `00NN_service_origin` (3 nullable columns)

**Interfaces — Produces:** `OrgSettings.props.serviceOriginAddress: string | null`,
`originLat: number | null`, `originLng: number | null`.

- [ ] `npm run db:generate` after adding `service_origin_address text`, `origin_lat`/`origin_lng`
  (numeric, nullable) to the org_settings schema. No RLS change (existing table). Verify columns live.
- [ ] Thread the three fields through the domain aggregate, mapper, settings DTO, and `updateConfig`
  input (all optional/nullable). Unit-test the mapper round-trip.
- [ ] On `updateConfig`, when `serviceOriginAddress` changes, geocode it (Task 1.1) and persist
  `originLat/Lng` (null if geocode fails — logged). Unit-test with a fake geocoder.
- [ ] Settings UI: an "Address we drive from (service origin)" input in the area section. Screenshot-verify.
- [ ] Commit `feat(settings): service origin address (geocoded)`.

### Task 1.3: Distance-based service-area check in the tools

**Files:**
- Create: `modules/frontdesk/app/service-area.ts` (pure `haversineMiles` + `isInServiceArea`)
- Modify: `modules/frontdesk/app/tools/check-availability.ts`, `book-visit.ts`, `build-assistant.ts`
  (pass origin + geocoder into VoiceToolDeps), route factory in `app/api/frontdesk/vapi/route.ts`

**Interfaces — Consumes:** `Geocoder`, origin lat/lng from settings.
Produces: `haversineMiles(a: GeoPoint, b: GeoPoint): number`, `isInServiceArea(addr, origin, radiusMi, geocoder): Promise<"in" | "out" | "unknown">` (`unknown` = no geocode/no origin → caller falls back to city behavior).

- [ ] Unit-test `haversineMiles` (SF↔LA ≈ 347 mi ±5) and `isInServiceArea`: in-radius → "in",
  out → "out", geocode-null OR no origin → "unknown".
- [ ] `check_availability`/`book_visit`: before offering/booking, call `isInServiceArea`. "out" →
  return the out-of-area decline (interim copy; Phase 4 routes to callback). "in"/"unknown" →
  proceed (unknown falls back to the existing city-string behavior). Geocode the address ONCE per
  call and reuse the point (also feeds proximity in Phase 2).
- [ ] Unit-test both tools with a fake geocoder: out-of-area address is declined, not booked;
  no-origin org books as today.
- [ ] Int test (live): a booking with an in-area address succeeds; an out-of-area one is declined.
- [ ] Full gate. Commit. **PR: Phase 1.**

---

## Phase 2 — Dispatch: per-crew schedules + least-loaded + proximity

### Task 2.1: crew_schedules table + reader

**Files:**
- Create: `shared/db/schema/crew-schedules.ts`, migration `00NN_crew_schedules` + hand-written
  `00NN_crew_schedules_rls.sql`; extend `modules/frontdesk/domain/availability.ts` +
  `infra/drizzle-availability-reader.ts`
- Test: reader int test

**Interfaces — Produces:** table `crew_schedules (org_id, user_id, weekday int, open_hour int,
close_hour int)` composite PK `(org_id, user_id, weekday)`, composite FK `(org_id,user_id)→users`.
`AvailabilityReader.readCrewSchedules(): Promise<Map<userId, WeekdayHours[]>>` and existing
field-crew ids; a crew with NO schedule rows falls back to the org hours.

- [ ] Schema + generated migration + hand-written RLS (ENABLE+FORCE+tenant policy, mirror 0071).
  Verify live.
- [ ] Extend the reader (still ≤2 queries / no N+1): field crew + their schedules + same-day booked
  visits. Int test: seeded schedules read back per crew; RLS isolates.
- [ ] Commit `feat(frontdesk): per-crew schedules table + reader`.

### Task 2.2: crew-aware slot math (least-loaded)

**Files:** Modify `modules/frontdesk/app/slots.ts`, `check-availability.ts`; settings UI for crew hours.

- [ ] `computeSlots` becomes crew-aware: a window is offerable if ANY crew works it AND that crew has
  capacity (per-crew-per-window count < 1); capacity aggregates across crews. Falls back to org hours
  for crews with no schedule. Keep pure + spread-offer + MAX_SLOTS. Unit-test: a window only some
  crews work is offered while any is free; fully-booked-for-all-working-crews window is dropped.
- [ ] Settings UI: per-crew working hours editor (progressive disclosure — simple default, expand per
  crew). Screenshot-verify.
- [ ] Commit `feat(frontdesk): crew-aware slot availability`.

### Task 2.3: least-loaded + proximity assignment in book_visit

**Files:** Create `modules/frontdesk/app/dispatch.ts` (pure `chooseCrew`); modify `book-visit.ts`,
availability reader (same-day job locations), persist visit lat/lng.

**Interfaces — Produces:** `chooseCrew(input: { candidates: CrewLoad[]; jobPoint: GeoPoint | null }): UserId | null`
where `CrewLoad = { userId; sameDayJobs: { point: GeoPoint | null }[] }`; picks the least-loaded
crew, tie-broken by nearest same-day job to `jobPoint`; null → unassigned.

- [ ] Persist the geocoded `lat/lng` on the created visit (add nullable `lat`/`lng` to `job_visits`
  or store on the job — pick the visit; additive migration). The point comes from the Phase-1
  geocode already computed in the call.
- [ ] Unit-test `chooseCrew`: fewer jobs wins; on a tie, nearest same-day job wins; no geocode →
  least-loaded only; no candidates → null.
- [ ] `book_visit` calls `chooseCrew` (candidates = field crew available in the chosen window) and
  assigns that crew (replaces "first field crew"). Int test: two crews, second booking goes to the
  emptier one; a booking near crew-A's existing job goes to crew A.
- [ ] Full gate. Commit. **PR: Phase 2.**

---

## Phase 3 — Found-work / scope capture

**Files:** Migration add `jobs.scope text`; modify jobs domain/mapper/DTO (passthrough),
`book-visit.ts` (accept + persist `scope`), `book-visit-input.ts` (add optional `scope_signal`),
`prompt.ts` (per-lane scope question), `disposition`/office surface unaffected.

- [ ] `jobs.scope` nullable text column (additive migration, verify live); thread through the jobs
  domain as a passthrough (unit-test default null + preserved).
- [ ] `book_visit` input gains optional `scope_signal` (the caller's "anything else you noticed"
  answer); persisted to `jobs.scope`; unit-test it lands on the job.
- [ ] Prompt: a per-lane scope question ("anything else you've noticed — age of the unit / condition
  of what's visible?") the agent asks before booking; write its answer to `scope_signal`. Prompt
  test asserts the scope question is present.
- [ ] Optional: lengthen the visit block + set a `likelyFoundWork` note when the scope answer trips
  owner-agnostic keywords (old/rusty/leaking/damage). Unit-test the heuristic.
- [ ] Full gate. Commit. **PR: Phase 3.**

---

## Phase 4 — Escalation & human-callback

**Files:** Playbook `emergencyTriggers?` per service + org `deferKeywords?` (settings + domain +
jsonb); `prompt.ts` (render per-service emergency triggers; deferral + no-same-day rules); a new
`escalate_callback` tool OR extend `take_message` with `reason` + priority; disposition adds
`callback`; `record-call`/office surface shows callbacks first.

- [ ] Add `emergencyTriggers?: string` per `BookingService` and `deferKeywords?: string` on
  `BookingCfg` (additive jsonb; settings UI fields). Domain/mapper unit tests.
- [ ] Prompt: render EACH service's own emergency triggers (remove the hardcoded plumbing list);
  render the defer rules (insurance/claim/adjuster/Xactimate/warranty, out-of-scope service, repeated
  confusion, "talk to a person" → human-callback). Prompt tests per rule.
- [ ] `escalate_callback` tool (name exact; input `{ caller_name, phone, reason }`) → EnsureCustomer +
  a HIGH-PRIORITY callback task ("CALL BACK — {reason}"); disposition `callback`. Unit-test (fake
  ports): insurance/out-of-scope → callback task, NOT an estimate booking.
- [ ] No-same-day-emergency escalation: when an emergency has no today slot, the agent offers a
  "someone will call you within the hour" callback via `escalate_callback` instead of tomorrow.
  Unit-test the branch.
- [ ] Full gate. Commit. **PR: Phase 4.**

---

## Phase 5 — Owner-set ballpark ranges

**Files:** Playbook `ballpark?: string` per service (settings + domain + jsonb); `prompt.ts`
(estimate-lane ballpark line); `price-audit.ts` (allowed set includes ballpark figures); book-visit
confirmation unchanged.

- [ ] Add `ballpark?: string` per `BookingService` (additive; settings UI field). Domain/mapper tests.
- [ ] Prompt: estimate lane, if the matched service has a `ballpark`, may state it ONCE with an
  "exact price after we see it" disclaimer, then book; absent → unchanged. Prompt test: ballpark
  rendered when present; estimate with no ballpark unchanged; the ballpark string's $ tokens are NOT
  redacted (owner-authored, allowed).
- [ ] `price-audit.ts`: extend the allowed dollar set to include each service's ballpark figures so
  an owner-set ballpark spoken on a call is NOT flagged; a non-configured $ still flags. Unit-test both.
- [ ] Full gate. Commit. **PR: Phase 5.**

---

## Phase 6 — Photo intake (email)

**Files:** Create `modules/frontdesk/app/tools/send-photo-link.ts`; reuse
`SupabasePhotoStorageGateway.createUploadUrl` + `ResendEmailSender`; a photo-upload page/endpoint
that attaches to the lead/job; `prompt.ts` offers it for visual-estimate services; VoiceToolDeps +
route factory wire the email sender + storage gateway.

- [ ] `send_photo_link` tool: input `{ caller_name, email, service_name }`; validates email; creates
  an upload URL (reuse `createUploadUrl`); emails a one-tap link via Resend; speaks "sent — reply
  with photos before your visit." Degrades (no email / send fails) to a spoken "the tech will assess
  on site" WITHOUT failing anything. Unit-test (fake email sender + storage): link emailed to the
  address; failure path degrades.
- [ ] Wire uploaded photos to attach to the lead/job before the visit (reuse the existing job-photo
  attach path). Int test: an upload attaches to the job.
- [ ] Prompt: for visual-estimate services (tree/roofing/fencing lanes), offer to email a photo link.
  Prompt test asserts the offer for those lanes.
- [ ] Full gate. Commit. **PR: Phase 6.**

---

## Execution notes
- Branch per phase off the latest `main` (Owen merges fast — open a fresh PR per phase; don't stack
  onto a just-merged branch).
- Adversarial review per phase (the price guardrail, tenant scoping, graceful-degrade, and pure slot
  math are the recurring review lenses).
- Phase order is dependency-ordered: Phase 1 geocoding is a hard prerequisite for Phase 2 proximity
  and the Phase 1 service-area check. Phases 3–6 are independent and can reorder if priorities shift.
