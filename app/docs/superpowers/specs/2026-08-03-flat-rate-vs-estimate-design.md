# Flat rate vs Estimate — design

**Date:** 2026-08-03
**Status:** approved model (Owen, in conversation); spec awaiting his read
**Mockup:** published as a private artifact — "Flat rate vs Estimate" (booking, the fork, both exits, front desk)

## The model in one line

At booking there is exactly one question: **do we already have a price?**
Yes → **Flat rate**. No → **Estimate** — someone drives out to look.

## Why the old model was wrong

The New job modal asked "Type: Estimate | Job", which grouped service calls (tech prices at the
door) with flat-rate work under "Job", and reserved "Estimate" for scope-and-send-to-office.

That split is an **outcome, not a booking decision**. When the call comes in about a water heater,
the dispatcher does not know whether the tech will price it and fix it on the spot, or come back
with photos for the office to quote. It depends on what the tech finds. Asking the office to pick
at booking time is asking them to predict the visit.

Jobber, Housecall Pro and ServiceTitan were researched before this spec (all three separate the
trip from the priced document; none asks the dispatcher to predict how the trip resolves). Nothing
here is exotic: ServiceTitan ships "Estimate" as a stock job type beside "Service Call"; this
model simply stops pretending the two are different *bookings*.

## The two types

### Flat rate — the price is known

A clogged toilet at $99. A drain cleaning off the pricebook. Work sold from an accepted quote.
Behaviour is today's "Job": price built at booking (or carried from the quote), checklist
available, billable when complete.

### Estimate — someone has to look first

A water heater that might be a $200 thermostat or a $2,400 replacement. A kitchen remodel.
No price section at booking, because the whole point is that nobody knows it yet.

**The visit ends one of two ways, decided at the door — THE FORK:**

- **Exit A — priced on site.** The tech opens Price & sign, the customer signs, and the job is now
  priced work: do it, bill it. (The path already exists — the on-glass field quote +
  `Estimate.sellOnSite`, which records an accepted estimate with `origin='field'`.)
- **Exit B — sent to the office.** Scope notes, photos and measurements go back; the office quotes
  it from the composer; the customer accepts; **the same job becomes the sold work.**

Exit A vs Exit B is *recorded*, not *chosen up front*: the estimate row's existing `origin`
field (`'field'` | `'office'`) already says which way a job resolved, so "how many did we close at
the door this month" stays a one-query answer.

## What each surface shows

**New job modal** — Type: `( Flat rate ) ( Estimate )`.
Flat rate shows **Build the price**. Estimate shows no price section; in its place one quiet line:
*"No price yet — the tech prices it at the door, or the office quotes it after the visit."*
Default visit length: flat rate → the org's repair/install minutes; estimate → its scope minutes.

**Office job modal**
- Flat rate: today's Job view, price row showing.
- Estimate, unpriced: scope section is the star (tech's notes, photos, measurements for measured
  trades). No price section. After the visit completes, the primary action is **Quote it →**
  (composer, seeded from this job).
- After Exit A: the price row **shows** the signed price and lines, stamped *Signed on site*.
  (Bug fix: today a signed on-site job hides its price forever because the UI keys on
  `svc='estimate'`.)
- After Exit B's accept: the **same record**, now carrying the quote's lines and a link to the
  estimate (`From quote EST-…`). No duplicate job.

**Tech's phone**
- Flat rate: do the work, wrap up, collect.
- Estimate: scope tools (notes, photos, scan/trace), then two actions:
  **Price it & sign** (primary when the customer is standing there) and **Send to the office**.

**Board / pipeline / Money** — unchanged in behaviour: estimate jobs stay out of billing until
priced; the pipeline's "quote it ›" card remains the Exit-B trigger. Only the predicate that
identifies an estimate job changes (see Data).

## Front desk rework

Lanes collapse from three to **two — `flat` and `estimate`** — because the repair lane was really
an estimate booking with two extra properties: the caller is told the tech prices it on site, and
the org's visit fee applies. Those become a per-service flag instead of a lane:

- `flat` lane → books a **Flat rate** job, carrying the service's price.
- `estimate` lane → books an **Estimate** job. Per-service flag **"visit fee applies"**:
  - fee on → the AI says *"the technician will price it on site — there's an $89 visit fee,
    credited toward the work"*; default duration = repair minutes. (Today's repair lane.)
  - fee off → *"we'll come take a look and get you a quote"*; default duration = scope minutes.
    (Today's estimate lane.)

Playbooks (code constants) are edited directly: repair-lane services → estimate + fee on;
estimate-lane services → estimate + fee off. Existing orgs' booking JSONB is mapped **at read
time** (`'repair'` reads as estimate + fee) and rewritten on next save — no risky blob migration.

`kindForLane` becomes 1:1, which fixes the standing bug where a voice-booked estimate renders as
regular work (the front desk writes `kind='estimate'` but every surface reads `svc`).

## Data changes

- **`jobs.kind` stays two-valued and becomes the single source of truth.** Internal values stay
  `'work' | 'estimate'` — `'work'` simply gains the UI label "Flat rate". Keeping the value avoids
  churning ~1,880 production rows for a rename.
- **Backfill is 13 rows**: the jobs with `svc='estimate'` get `kind='estimate'`; `svc` returns to
  being purely the trade label it was declared as. (Zero rows have ever carried
  `kind='estimate'`, so there is nothing else to migrate.)
- **Predicates consolidate onto `kind`.** Today three hand-maintained copies key on
  `svc === 'estimate'` (`features/jobs/jobs-helpers.ts`, `features/pipeline/pipeline-utils.ts`,
  `modules/customers/infra/lead-views.ts` + `modules/jobs/infra/job-views.ts` server twins).
- **`estimates.job_id`** (nullable, composite FK) — the office quote finally records which visit
  produced it. Nullable because desk quotes with no visit are a normal state.
- **Accept converts instead of duplicating.** When an estimate with `job_id` is accepted and that
  job is `kind='estimate'`: set `source_estimate_id`, copy the sold lines, flip `kind` to
  `'work'`, and seed the install visit(s) on the **same job** — its scope visit stays in history
  as visit #1 (the model already supports multi-visit jobs). Today this path mints a second job
  and strands the first on the board forever, unarchived.
- **Exit A needs no new data** — `record-field-sale` already writes the accepted estimate, links
  `source_estimate_id`, and stamps the signature. The only change is display: price gating moves
  off `svc` so the signed price shows.

## Order of work

1. Backfill + predicate consolidation onto `kind` (fixes the voice-booking render bug and the
   hidden-signed-price bug in one move).
2. New job modal: two chips + per-type sections.
3. `estimates.job_id` + convert-on-accept (kills the duplicate-job orphan).
4. Front desk lane collapse + fee flag + read-time mapping.

Steps 1–2 ship together; 3 and 4 are each independently shippable.

## Out of scope

Charging for estimate visits (quote-lane fees), deposits at signing, change orders (already
built), and any three-way job type — rejected because the service-call/office split is an outcome
the `origin` field already records.
