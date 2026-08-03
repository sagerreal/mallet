# Onboarding — design

**Date:** 2026-08-02
**Status:** approved (Owen), ready for an implementation plan

## The problem

Signing up today collects a business name, a person's name, an email and a password. `/welcome`
then asks for the business name and a ZIP — the ZIP only so the Twilio number has a local area
code. Everything else in `org_settings` takes a default, and several of those defaults are
someone else's answers.

Three of them are load-bearing and wrong:

- **`timezone` defaults to `America/Los_Angeles` and has no UI anywhere in the app.** It is read by
  the AI front desk (`modules/frontdesk/app/build-assistant.ts:138`) and by the in-app agent's
  sense of "today" (`modules/ai/infra/tools/read-tools.ts:61`). A Boston shop is on Pacific time
  permanently and cannot correct it.
- **Business hours default to 8–5 weekdays, closed weekends.** Invalid hours are what produced
  "the schedule is full" on every front desk call (fixed in #122); a shop that actually works
  Saturdays now inherits a front desk that refuses Saturday bookings.
- **`frontDesk` defaults to `true`.** A shop is given a phone number pointed at an assistant
  configured with none of the above.

And one thing is missing rather than wrong: there is **no shop-level default tax rate**. Estimates
and invoices each carry their own `taxBps`, so a new shop's quotes start at 0% and under-bill. The
same missing model is what blocks QBO invoice sync.

## What onboarding is for

**A new shop reaches a working version of the thing they came for, and is never asked to configure
a thing they are not using.**

The second half is the correction that shaped this design. Measuring what actually reads each
setting:

| Setting | Read by |
|---|---|
| Business hours | `build-assistant.ts` — **nothing else** |
| Service area (cities, radius) | front desk `check-availability`, `book-visit` — **nothing else** |
| Timezone | front desk, in-app AI agent |
| `users.callback_number` | click-to-call — **every shop** |

Hours and service area are front-desk-only. A shop that never turns the front desk on and is asked
to set a service radius has been interrogated about a product it is not using.

## Shape

**A universal core, then outcome-led groups.** Not a wizard: a six-step gate before anyone sees the
product is where unattended signups die, and it cannot be resumed when a shop drops out mid-flow —
which matters because in the pilot Owen walks each shop through this on a call.

### 1. Core — `/welcome`, everyone

Three fields. Business name, ZIP, and the owner's mobile.

- **ZIP** already picks the number's area code. It now also **derives the timezone**, which removes
  the single most consequential wrong default without adding a question.
- **Mobile** does double duty: it is `users.callback_number`, without which click-to-call
  dead-ends, and it is the after-hours emergency transfer target for shops that later switch the
  front desk on.

Provisioning (org + number purchase) happens here so the shop is inside the app quickly.

### 2. One orienting question

*"What do you want Mallet doing first?"* — multi-select, no wrong answer, nothing gated on it. It
orders the checklist. It also records what shops arrive wanting, which is worth knowing while the
roadmap is still open.

### 3. Three groups, in the dashboard checklist

Each group states what completing it buys. A shop sees the groups it picked first; the others stay
available, collapsed.

| Group | Items | Buys them |
|---|---|---|
| **Answer my phone** | business hours · service area · 3–5 bookable services · emergency transfer · trade | the front desk goes live |
| **Quote and get paid** | default tax rate · payment terms · logo and business details | a quote that is not 0% tax and does not look unbranded |
| **Run my jobs** | invite techs · import customers | a schedule board with real names on it |

## Decisions taken

**The front desk stays OFF until its group is complete.** `frontDesk` flips to defaulting `false`.
It switches on only when hours, service area and at least one bookable service exist, with an
explicit "your front desk is live" moment. A shop that never picks that group never has an
assistant answering a number its customers were given.

This is also the guard for the empty-service-list problem: a front desk that knows no services can
book nothing, so it must not be answering.

**Services are typed by the shop, not seeded.** No trade-specific pricebook or playbook seeding.
The existing `PLUMBING_SEED_CATEGORIES` / `PLUMBING_SEED_SERVICES` seed stays where it is (an
opt-in pricebook action) and is not wired into onboarding — it is plumbing-only and would hand a
garage-door shop plumbing services.

**`trade` moves into the front desk group.** It currently drives nothing: it is stored, mapped and
exposed on the DTO, and no code branches on it. With services typed by hand it still drives
nothing. Its one honest use is flavouring the front desk's system prompt so the assistant answers
like a plumbing shop rather than a generic receptionist — so it belongs with the front desk
questions or nowhere.

## Deliberately not asked in the core

Tax rate, team, pricebook, branding, payment setup. Each is real; none is needed to get in; each is
a reason to abandon. They live in the groups, and outside onboarding they surface at the moment
they first matter — the pattern the app already uses for first-run empty states
(`FirstRunEmptyState`).

## What this depends on that already exists

- `v1.calls.setCallbackNumber` — **shipped**. Onboarding needs no new backend for the mobile field.
  Worth noting why the ask matters: **1 of 81 users currently has a callback number set**, so the
  endpoint exists and nobody has found it.
- `AddressInput` autocomplete — used for the service origin address.
- CSV customer import — used by "Run my jobs".
- Stripe Connect onboarding (#119) — used by "Quote and get paid".
- `FirstRunEmptyState` and the `shouldShowFirstRun` predicates.

## What has to be built

1. **ZIP → timezone derivation.** An offline ZIP3-prefix table, not a network call. States split
   across zones (FL, IN, KY, TN, ND, SD, NE, KS, TX, MI, OR, ID) make a prefix table approximate,
   so the derived value must be **visible and correctable**, not silent.
2. **A timezone control.** None exists today; the derived value needs somewhere to be corrected.
3. **A shop-level default tax rate** — new `org_settings` column, applied to new estimates and
   invoices. This is the piece with the widest blast radius; it also unblocks QBO invoice sync.
4. **`frontDesk` default flips to `false`**, plus the readiness predicate and the go-live moment.
5. **The checklist surface** on `/dashboard`, with per-group completion derived from settings
   rather than stored flags — so it self-heals if a shop configures something from Settings
   instead.
6. **The orienting question** and somewhere to record the answer.

## Risks

- **Existing orgs.** Flipping the `frontDesk` default must not switch off a live front desk for an
  org already using it. The default change applies to new rows only; existing rows keep their
  stored value.
- **A derived timezone is a guess.** Shown, not silent. A shop on the wrong side of a state line
  must be able to fix it in one click.
- **Checklist completion derived from settings** can read as complete when a shop typed a
  placeholder. Accepted: the alternative is a stored flag that drifts from reality, which is worse.
- **The tax rate change touches money.** New estimates and invoices only; nothing recomputes an
  existing document.

## Out of scope

Multi-state sales tax by service address (Housecall Pro's model). One shop-level rate is the
correct size for a 1–3 tech shop; anything more is a tax engine.
