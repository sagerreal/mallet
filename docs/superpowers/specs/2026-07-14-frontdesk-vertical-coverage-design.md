# AI Voice Front Desk — Vertical Coverage design spec

**Date:** 2026-07-14 · **Status:** approved direction (brainstorm w/ Owen)
**Goal:** Close the red-team gaps so the voice front desk genuinely serves the top-10 trade ICP
verticals at **1–15 office sizing**, without changing the one-off product model or requiring A2P.

## Context

The front desk (`modules/frontdesk`) answers calls, routes via the org's booking playbook
(`org_settings.booking` jsonb: `services[{name,lane,price?,triggers}]`, `notServices`,
`serviceFee`, `feeCredited`), offers discrete start times (`slots.ts` + `check_availability`),
and books via `book_visit` (EnsureCustomer → CreateManualJob → CreateVisit, auto-assigned to the
first field crew). A red-team (Jul 14) found: books pile on crew #1; service area is an LLM
city-string guess; no found-work capture; no ballpark price signal; emergency keywords hardcoded
to plumbing; no human-callback escape hatch; no photo intake. This spec addresses all of those.

**Explicitly OUT of scope** (deferred, with reasons): live outbound SMS / A2P (Owen deferring —
confirmations/quotes go by callback per PR #88); multi-location (single-location for now); per-crew
skill tags + service→skill zones (dispatch stays load + proximity this round); HVAC memberships /
financing and septic pumping routes (product-model changes, not front-desk work).

## Resolved decisions

1. **Ballpark ranges:** owner-set, **off by default**. A new optional per-service `ballpark`
   string ("$25–45/linear ft"). If set, the estimate lane may speak it with an "exact price after
   we see it" disclaimer, then book. If blank, behaves exactly as today.
2. **Service origin:** the owner sets a **service-origin address** (their shop/office); geocoded
   once to a lat/lng and stored on `org_settings`. All distance checks measure from there.
3. **Ballpark × price audit:** the post-call price audit's allowed set is extended to include each
   service's ballpark range figures, so an owner-authored ballpark is treated like a flat price and
   never flagged. The AI still never *computes* a number.
4. **Photo intake channel:** by **email** (confirmed live — `ResendEmailSender` exists). Reuses the
   existing `SupabasePhotoStorageGateway.createUploadUrl` to attach photos to the lead before the visit.
5. **Dispatch depth:** per-crew schedules + least-loaded round-robin + **proximity** (book a crew's
   next job near their existing jobs). Skills/zones deferred. Built progressively across sub-phases.

## Architecture

**Geocoding is a shared foundation.** A new `Geocoder` port (`modules/frontdesk/domain`) with a
Census-geocoder adapter (`infra`) — free, US, no API key — turns an address into `{lat,lng}` or
null. It is used by BOTH the service-area check and proximity dispatch. Graceful degradation is a
hard rule: a geocode miss NEVER blocks a booking — the service-area check falls back to today's
city-string behavior, and proximity falls back to plain least-loaded.

**Per-crew schedules** move crew working-hours out of the single org hours triple into a
`crew_schedules` concept (a small table keyed by `(org_id, user_id, weekday)` with open/close, or a
per-user hours jsonb — chosen in the plan). `computeSlots` becomes crew-aware: it only offers a
window some crew actually works, and capacity is per-crew-per-window.

**Playbook extensions** (all additive to the `booking` jsonb, back-compatible — absent = today):
per-service `ballpark?: string`, per-service `emergencyTriggers?: string`; org-level
`serviceOriginAddress` + `originLat`/`originLng` columns (or a jsonb `origin`), and an org-level
`deferKeywords?: string` (the human-callback triggers).

**The human-callback escape hatch** generalizes insurance screening: a single `escalate_callback`
tool (or an extension of `take_message` with a `reason`) that the prompt calls whenever the agent
can't confidently handle a request — out-of-scope service, insurance/claim/warranty language,
repeated confusion, an explicit "talk to a person," or a no-same-day emergency. It files a
**high-priority callback task** with a reason and speaks "let me have someone call you right back."

## Phases (each lands as a PR with the full gate: tsc · lint · unit · int · coverage · build)

### Phase 1 — Geocoding foundation + real service-area check
- `Geocoder` port + Census adapter (`infra`), with an in-memory cache and a timeout; returns null
  on failure (never throws).
- `org_settings`: add `service_origin_address` (text), `origin_lat`/`origin_lng` (numeric, null
  until geocoded). A settings mutation geocodes the address on save. Migration + RLS unaffected
  (existing table).
- `check_availability` + `book_visit`: before offering/booking, geocode the caller address and
  compute haversine distance to the origin; if `distance > areaRadiusMi`, do NOT offer a slot —
  route to the human-callback/decline path (Phase 4; interim: the existing out-of-area decline copy).
  Geocode miss OR missing origin → fall back to the current city-string behavior.
- Settings UI: a "service origin address" field in the front-desk/area settings card.
- Tests: haversine + in/out-of-radius unit tests; geocoder adapter integration (a known address →
  plausible lat/lng, an unresolvable string → null); the fallback path (no origin → city behavior).

### Phase 2 — Dispatch: per-crew schedules + load-balanced + proximity
- **2a — per-crew schedules + least-loaded round-robin:** a `crew_schedules` table (hand-written
  RLS) or per-user hours; `computeSlots` offers only windows a crew works and counts capacity
  per-crew; `book_visit` assigns to the **least-loaded** qualified-available crew (not always #1).
- **2b — proximity:** persist each visit's geocoded `lat/lng` (from Phase 1); when choosing among
  least-loaded crews, prefer the crew whose same-day jobs are nearest the new address (minimize
  added drive); fall back to least-loaded when no location signal.
- Availability reader returns per-crew schedules + same-day booked-job locations (no N+1).
- Tests: slot math respects per-crew hours; assignment distributes across crews; proximity picks
  the nearer crew; all degrade cleanly with 1 crew / no geocode.

### Phase 3 — Found-work / scope capture
- A per-lane **scope question** in the prompt ("anything else you've noticed — age of the unit,
  condition of what's visible?") whose answer is written to a first-class `scope` field on the job
  (new `jobs.scope` text column, or the visit notes promoted) that the tech sees pre-arrival.
- Optionally lengthen the visit block and set a `likelyFoundWork` flag when the scope signal is
  strong (heuristic keywords), surfaced to the office. No pricing — capture only.
- Tests: the scope answer persists and reads back on the job; block length adjusts; flag sets.

### Phase 4 — Escalation & human-callback (generalizes insurance screening)
- Per-service owner-configurable `emergencyTriggers` in the playbook (replaces the hardcoded
  plumbing keywords in the prompt); the prompt renders each service's own emergency words.
- Org-level `deferKeywords` + prompt rules: insurance/claim/adjuster/Xactimate/warranty, an
  out-of-scope service, repeated confusion, or "talk to a person" → the human-callback path.
- **No-same-day-emergency escalation:** when an emergency has no slot today, the agent offers a
  "someone will call you within the hour" callback instead of silently defaulting to tomorrow.
- Mechanism: `escalate_callback` (or `take_message` with a `reason` + priority) → a high-priority
  callback task the office sees first. The audit trail records the disposition (`callback`/`screened`).
- Tests: emergency triggers per service; insurance/out-of-scope → callback task (not an estimate
  slot burned); no-same-day emergency → callback offer; disposition recorded.

### Phase 5 — Ballpark ranges
- Playbook `ballpark?: string` per service + settings UI field. Estimate lane: if a ballpark exists,
  the agent may state it once with an "exact price after we see it" disclaimer, then book; else
  unchanged. Extend the price-audit allowed set to include ballpark figures so they don't trip it.
- Tests: prompt renders the ballpark for a service that has one; estimate lane with no ballpark is
  unchanged; the price audit does NOT flag an owner-set ballpark; a stray non-configured $ still flags.

### Phase 6 — Photo intake (email)
- `book_visit` / a new `send_photo_link` step: capture the caller's email, generate a Supabase
  upload URL (reuse `createUploadUrl`), email a one-tap link (Resend), and attach uploaded photos to
  the lead/job before the visit. Prompt offers it for visual-estimate services (tree/roofing/fencing).
- Tests: email-link send (stub asserts recipient + link); an uploaded photo attaches to the job;
  no-email path degrades to a spoken "bring photos / the tech will assess" without failing the booking.

## Error handling & guardrails (cross-phase)
- Every new external call (geocoder, email) has a timeout and degrades gracefully — never fails a
  booking. Geocode/email misses are logged, not thrown.
- The price guardrail holds: the only spoken dollars remain serviceFee + flat prices + (new)
  owner-set ballpark ranges; the post-call audit is updated in lockstep.
- Tenant safety unchanged: org from the To-number lookup; new tables get hand-written RLS; the
  crew-schedule + origin data is org-scoped.

## Testing strategy
Test pyramid per phase: unit (haversine, slot math, dispatch selection, scope persistence, ballpark
render, audit) · integration against live RLS (geocoder adapter, crew schedules, proximity
assignment, callback task, photo attach) · coverage gate 80/75 holds. Each phase is independently
shippable and live-testable by calling the Twilio number.
