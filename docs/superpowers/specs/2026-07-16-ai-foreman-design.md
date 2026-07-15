# AI Foreman — the Jobs pillar (design spec)

**Status:** design, awaiting review
**Author:** Owen + Claude (brainstorming)
**Date:** 2026-07-16

## The thesis

Mallet has two pillars: **leads = AI Front Desk**, **invoicing = AI follow-up**. The missing
third is **jobs** — and it is the most valuable because jobs are where the work (and the
reputation) is actually created, and the one place software has never reached, because the work
happens off-screen in a tech's hands.

The pillar is **AI Foreman**: the role a 3–15 tech shop desperately needs and can't afford — someone
on every job making sure it's done to standard. The one-line thesis:

> **Standards live in the system, not the owner's head — and they get sharper every time reality
> teaches them a lesson.**

The AI Foreman: **sets** the standard (checklists per job type) · **rides along** (a field copilot:
photo + voice "what do I do here?") · **inspects** the work (photo verification) · and — the
innovation nobody in trades does — **learns from every callback to tighten the standard.**

### Why this is the moat (the VC answer)

The AI Front Desk is copyable — any competitor with the same LLM + a playbook rebuilds it in a
month. **A checklist refined by *your shop's own callbacks* is not.** Every job makes the standard
tighter and the product more locked-in; knowledge concentrates in the system as you add techs
instead of diluting. The long game — cross-shop anonymized learning — turns Mallet into the
**system of record for *how the work is done*** across a trade, a tribal-knowledge graph no new
entrant can replicate without the callback data.

Research (2026-07-16, primary vendor docs, 9 claims verified 3-0): ServiceTitan Forms, Jobber job
forms, and Housecall Pro checklist automations **all exist and all stop at static, owner-built
templates** — none close the outcome→checklist loop. Confirmed whitespace.

## What already exists (the seed) vs. what's new

**Already built (the compliance spine):**
- `modules/checklists` — full hexagonal module: `Checklist` templates (`stage: "job" | "scope"`),
  items (`type: "check" | "photo"`, cap 50), repository, router (create/list/archive), + a
  store hydrator. **Backend complete, but headless — no owner-facing management UI yet.**
- `jobs.checklist` (jsonb) — the per-job snapshot the office attaches.
- `job_verify_answers` — per (job, item) crew answer: `state: "pass" | "override"`, via
  `manual | photo`, with an override reason. **This is per-job QA data.**
- `job_photos.verifyPass` — photo evidence auto-passing a photo item.
- `job_addons` — found-work discovered on site (proposed → approved/declined).
- The agent loop (`modules/ai/run-agent-turn` + MCP + tool-confirmations), the photo-upload
  pipeline (signed URL → Supabase job-photos bucket), and the full Vapi voice stack (front desk).

**Net-new for the pillar:** a service→checklist link (auto-attach), the owner-facing Checklists
surface, AI-generated starters, the **callback signal** (the one real data gap), the autopsy
engine, the field copilot, and (later) cross-shop learning.

---

## Phased roadmap

- **Phase 1 (this spec's build target) — Standard in the system + the callback signal.** The
  Checklists tab under Jobs (give the headless backend a home), AI-generated starter checklists per
  job type, service→checklist auto-attach, and **callback auto-detection** over completed jobs.
  Ships value alone (consistency day one, "you've had N callbacks" insight from day-one history) AND
  starts generating the data the autopsy needs.
- **Phase 2 — The Callback Autopsy loop.** Correlate callbacks → skipped/overridden items / missing
  photos by job type → the one-tap "here's your leak, fix it" card on Home. *The demo money slide.*
- **Phase 3 — The field copilot.** Photo + push-to-talk voice "what do I do here?" in the tech app
  (assembly of the existing agent loop + photo upload + Vapi stack), verifying critical steps inside
  the help. Tech gets help; owner gets assurance.
- **Phase 4 — Cross-shop learning + vision QA.** Anonymized callback→checklist learning across
  shops (network effect); the moonshot of AI vision QA on trade photos.

**This spec details Phase 1** and sketches Phase 2–4 only enough to keep the architecture honest.

---

## Phase 1 design

### 1a. Checklists tab under Jobs

Jobs already has `?tab=`-driven sub-nav (`Schedule` = `/jobs?tab=schedule`, `Timesheets` =
`/jobs?tab=timesheets`, in `components/shell/section-tabs.tsx` + `sidebar.tsx`). Add
**`/jobs?tab=checklists`** — one `NavSub` + one section. It's the third leg: Schedule = *when*,
Timesheets = *labor*, **Checklists = the standard for *how*.**

The surface (the owner's **library of standards**):
- A **list of checklists**, one per job type, list-first like the booking services (compact rows:
  name · linked service · item count · a "⚡ from callbacks" chip once Phase 2 lands).
- Click a row → an **editor** (in-flow, matching the booking-service-card pattern): checklist name,
  the linked **service** (the auto-attach key), and its **items** — each an ordered row with a text
  label + a type toggle **Check / Photo** (photo items require a photo to pass). Add/remove/reorder
  items; a "Remove checklist" action.
- **"+ New checklist"** and **"Starter checklists"** buttons at the top (mirrors the booking tab's
  add-service modal + starter-playbook picker).
- No grey helper text; labels + placeholders carry meaning (house rule).

The tab is the plain utility name ("Checklists"); the pillar brand is "AI Foreman" (surfaces on Home
in Phase 2).

### 1b. Service → checklist auto-attach

New nullable `service_id` on checklist templates (composite FK `(org_id, service_id) →
pricebook_services(org_id, id)`), so a checklist is **the standard for a service.** When a job is
created for that service — by the office OR **by the AI Front Desk booking that service** — the
job's `checklist` snapshot is seeded from the linked template. This ties the jobs pillar to the
booking playbook we already built (a "Water heater repair" service and its checklist are one
standard). A checklist with no service is a manual/global template (today's behavior, preserved).

Design note: the booking playbook's services (in `org_settings.booking`) and the pricebook services
are currently distinct catalogs. Phase 1 links checklists to **pricebook services** (the stable,
id-bearing catalog); mapping a booked front-desk service to a pricebook service for snapshot
seeding is a small resolver (match by name/lane) — spec'd in the plan, kept behind graceful
degradation (no match → no auto-attach, never blocks a booking).

### 1c. AI-generated starter checklists

Blank checklists are as bad as the blank booking playbook was. Same solution as the trade
playbooks: **starter checklists per job type**, seeded in one click.

- A curated static seed set per ICP trade + common job types (plumbing: water-heater repair,
  drain cleaning, leak repair…; HVAC: AC repair, furnace repair…; garage door: spring replacement…)
  — the same authorship discipline as `trade-playbooks.ts` (no `$` tokens, photo items on the steps
  that actually cause callbacks: check-valve/expansion-tank photo on water heaters, etc.). This is
  the cold-start value: a shop starts with checklists that encode known failure points before it has
  any callback data of its own.
- **AI-drafted** option (uses the existing agent loop): "draft a before-you-leave checklist for
  {job type}" → a proposed item list the owner edits and saves. Kept owner-in-control (suggest, never
  auto-apply). This is the AI-generation half of the pillar's promise, at the template level.

### 1d. Callback auto-detection (the one real data gap)

Because **Mallet is strictly one-off jobs (no recurring)**, a repeat at the same site for the
same/similar service in a short window is an unusually clean callback signal — no recurring schedule
to create false positives.

**The signal (pure derivation over existing completed-job data — zero new input):**

> a job whose customer (or address) matches a **completed** job, for the **same or similar service**
> (same service / same pricebook category / same lane), scheduled **within N days** (default ~45) of
> that job's completion → a **candidate callback** linked to the original.

Data model: a nullable self-referential `callback_of` (job id) + `callback_reason` on `jobs`
(composite FK `(org_id, callback_of) → jobs(org_id, id)`). The auto-detector proposes; a human
confirms the **reason**, which separates the three cases the raw signal can't:
- **callback** — a redo (the QA-relevant one, feeds the autopsy)
- **new issue** — unrelated work at the same site (not a callback)
- **found-work follow-up** — they came back to do work flagged on the first visit (good — proves the
  found-work→revenue loop)

**The detection spectrum (baseline → sharper):**
1. **Auto-detect** from job proximity — the engine; runs **retroactively over the shop's whole
   history the moment they sign up** ("you've had 6 callbacks in 90 days, here's the pattern" — value
   from their own past, day one).
2. **Front-desk-detected** — when a known customer calls back about a prior job, the AI Front Desk
   tags the new job as a callback (the leads pillar feeding the jobs pillar; deferred to Phase 2/3,
   the architecture just needs the `callback_of` field this phase adds).
3. **One-tap confirm** — office/tech confirms the reason on the candidate; the label trains it.

Surfaces this phase: candidate callbacks appear as a **confirm prompt** on the job (and a simple
"Callbacks" count/list) — the full autopsy insight card is Phase 2. The point of Phase 1 is to
*capture the signal cleanly*; Phase 2 *acts on it*.

---

## Architecture (follows the house patterns)

- **Checklists module** (`modules/checklists`) gains: the `service_id` link (schema + domain
  passthrough + repo + DTO), the auto-attach at job-create (a small use-case that reads the linked
  template and seeds `jobs.checklist`), and starter-seed data (`app/(office)/.../checklist-starters.ts`,
  a static curated set mirroring `trade-playbooks.ts`).
- **Callback signal** lives in `modules/jobs`: additive `callback_of` + `callback_reason` columns
  (one migration, `jobs` already has RLS), domain passthrough, a pure `detectCallbacks(...)` app
  function (org-scoped query of completed jobs → candidate links), and a confirm mutation. Pure
  detection = exhaustively unit-testable; the query adapter is the only I/O.
- **UI**: `app/(office)/jobs` gains the `?tab=checklists` section (new `checklist-card.tsx` +
  `add-checklist-modal.tsx` + `starter-checklists-modal.tsx`, reusing the booking-tab components'
  visual language — `.field`/`.seg`/list-first accordion, the Modal shell).
- **Tenant safety**: org id always from `ctx.principal.orgId`; every new query org-scoped; the new
  columns/FK follow the composite-FK + RLS conventions; graceful degradation on any resolver miss.
- **Design principles** (`.superpowers/sdd/design-principles.md`): SOLID/DI/ports/repository,
  DTO≠domain, validate at boundaries, no silent fail, YAGNI. Immutability, small files.

## What Phase 1 explicitly does NOT do (deferred)

- The autopsy correlation + Home insight card (Phase 2 — needs the callback data this phase starts
  collecting).
- The field copilot / voice (Phase 3).
- Cross-shop learning / vision QA (Phase 4).
- Front-desk callback tagging (Phase 2/3 — the `callback_of` field is added now so it's ready).

## Open questions for review

1. **Checklist ↔ service link target:** pricebook services (id-bearing, chosen here) vs. the booking
   playbook services (name-keyed jsonb). Confirm pricebook is the right anchor, or should Phase 1
   unify them?
2. **Callback window default (~45 days)** and the "similar service" match rule (same service only, vs.
   same pricebook category, vs. same lane) — how loose to cast the net before a human confirms.
3. **Tab name:** "Checklists" (clear to a trade owner) vs. "Standards" (pillar-y) — ship which now?
4. **Retroactive scan on signup:** run callback detection over imported history immediately (the
   day-one "here's your callback pattern" demo) — in Phase 1, or hold until the autopsy (Phase 2) can
   actually act on it?

## Success criteria (Phase 1)

- An owner can manage a library of per-job-type checklists under Jobs → Checklists, seeded from
  starters in one click, never facing a blank page.
- A checklist auto-attaches to jobs of its linked service (office-created and front-desk-booked).
- Completed jobs that come back are auto-detected as candidate callbacks and confirmable, producing
  the clean, labeled callback dataset the autopsy (Phase 2) will consume.
- Full gate green (tsc · lint · unit · int · coverage · build); adversarial review; one PR.
