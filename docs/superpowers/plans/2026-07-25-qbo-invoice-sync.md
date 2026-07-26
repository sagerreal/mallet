# Invoices into QuickBooks

**Ask, Owen, 25 Jul 2026:** make invoices sync to QuickBooks.

Approved-hours sync went live the same day (three TimeActivity records, verified against the QBO
API). This plan covers the harder half: the money.

## What already exists — the good news first

Almost all the hard infrastructure is built and now proven in production:

- **The connection.** OAuth, refresh-token rotation, HMAC-signed CSRF state, `EnsureFreshAccessToken`
  holding the row lock across the Intuit call. Live and working.
- **Idempotency.** `qbo_entity_links` (Mallet id → QBO id) and `qbo_sync_log` (a partial unique
  index on succeeded rows). Both generic over `entity_type` from day one.
- **The delivery mechanism.** Outbox + relay, at-least-once, per-row tenant re-scoping, poison
  handling. Registered handlers dispatch; unregistered names drain as no-ops.
- **The whole invoice event lifecycle already emits.** Nothing needs adding:
  `invoice.created` · `invoice.drafted` · `invoice.updated` · `invoice.sent` ·
  `invoice.payment.recorded` · `invoice.payment.unapplied` · `invoice.paid` · `invoice.voided`

So this is not a from-scratch integration. It is new mappings and new gateway methods on a spine
that has already carried real data.

## Three structural blockers, found in our own code

These are the reason this is not a weekend's work. Each was verified in the schema/domain, not
assumed.

### 1. `invoices.total_cents` is a SNAPSHOT, not the sum of the lines

`modules/invoicing/domain/invoice.ts:37,58` — *"snapshot from the source job — never re-derived
from lines"*, and `withLines` deliberately **keeps** the snapshot when lines change.

A QuickBooks invoice total is *always* the sum of its lines. There is no field for "the total is
actually something else". So the moment Mallet's snapshot diverges from its lines, we push a number
the shop never agreed to — silently, into their books, on a document a customer already paid.

Today both live invoices are $0 with no lines, so nothing is broken yet. That is luck, not safety.

**This must be resolved before a single invoice is pushed.** Options, in order of preference:

- **(a) Refuse to sync a divergent invoice.** Compare `total_cents` to `Σ(quantity × rate_cents)`;
  on mismatch, log `TOTAL_LINE_MISMATCH` and skip with a message naming the two numbers. Cheap,
  honest, and never wrong. Ship this regardless of what else is chosen.
- **(b) Reconcile the model** so lines are the source of truth for the total, with the snapshot kept
  only for historically-sent invoices. Correct, larger, touches the invoice domain.
- **(c) Push a balancing adjustment line.** Rejected — it puts a fictional line item on a customer's
  invoice to paper over our own inconsistency.

### 2. Sales tax does not exist on invoices

`invoices` has **no tax column**. Yet `estimates.tax_bps` exists AND
`modules/quoting/domain/estimate.ts:241` already computes it:
`money(Math.round((net * taxBps) / BPS_DENOMINATOR))`. Pricebook items and materials each carry a
`taxable` boolean. **Tax is modelled upstream and dropped on the way to the invoice.**

That is a Mallet product bug independent of QuickBooks: a plumbing shop selling $400 of parts in
California owes sales tax, and Mallet currently prints an invoice without it.

**What QuickBooks' Automated Sales Tax changes** (verified, see Sources): every US QBO company
created since 10 Nov 2017 calculates sales tax itself, from the shipping address (falling back to
billing, then to the company address). `TxnTaxDetail.TxnTaxCodeRef` must be sent to signal intent;
`TxnTaxDetail.TotalTax` overrides the computed amount and is prorated across the assigned rates.

So we do **not** need rate tables, nexus logic, or jurisdiction lookups. But we cannot simply let
QBO compute it either, because **Mallet is the system that bills the customer** — the number on the
emailed invoice has to be right before QuickBooks ever sees it, and if QBO adds tax that Mallet did
not charge, the books show a balance the customer never owed and payments stop reconciling.

**Therefore:** Mallet gets its own tax number (small — the math exists on estimates), and we send it
to QBO as `TotalTax` so both agree exactly.

### 3. Invoice lines have no item reference

`invoice_lines` is `description / quantity / rate_cents / cost_cents / position`. QuickBooks needs
an `ItemRef` on every `SalesItemLineDetail`. Two ways out, and we want both:

- **Fallback:** one org-level default item (exactly like the "Hours" item the timesheet sync already
  uses). Everything lands under it. Books are right; the revenue *breakdown* is lost — which is
  much of why a bookkeeper wants the sync.
- **Real mapping:** `qbo_entity_links` with `entity_type = 'service_item'` (already permitted by the
  check constraint) linking pricebook items to QBO items, and `invoice_lines.source_job_line_id` →
  pricebook item as the join. Better, and it is what makes the P&L useful.

Ship the fallback first so nothing blocks; add mapping as its own phase.

## Decisions to take before building

| Question | Recommendation |
|---|---|
| Which event triggers the push? | **`invoice.sent`**, not `invoice.created`. A draft is not a financial fact; pushing drafts puts unissued revenue in the books. |
| Customer matching | Match on **email**, then exact name; **create** when absent. Never fuzzy-match — a wrong match files a customer's money against a stranger. |
| Numbering | Send Mallet's `num` as `DocNumber`. Handle QBO's duplicate-number error explicitly (some companies enforce uniqueness) by retrying without it and logging that we did. |
| Edits after sync | Sparse update with `SyncToken`. A stale token is a 5xx-class conflict → re-read, re-apply, retry once. |
| Void | Push a QBO void, never a delete. Mallet is soft-delete-only; the books must be too. |
| Deposits | `deposit_paid_cents` is money already taken. It must land as a **Payment**, not as a discount line. |

## Phases

Each is its own PR. The order is deliberate: nothing that can fail silently ships before the screen
that shows failures.

### PR0 — Show sync results *(prerequisite, already flagged to Owen)*

Nothing in the app reads `qbo_sync_log`. Today one handler can fail invisibly; this plan adds five
more failure modes. Building them on top of a silent pipeline violates the no-silent-failures rule
in `docs/design-principles.md`.

A list on the QuickBooks settings card: what was sent, when, what failed and **why**, with the
error codes mapped to sentences a shop can act on (`UNMAPPED_EMPLOYEE` → "match this person to a
QuickBooks employee"). Retry control for failed rows.

### PR1 — Tax on invoices *(prerequisite; valuable with or without QuickBooks)*

- Migration: `invoices.tax_bps` + `invoices.tax_cents`, and `invoice_lines.taxable`.
- Carry `tax_bps` from the accepted estimate through `create-invoice-from-job`; default from org
  settings otherwise.
- Reuse the estimate's computation rather than writing a second one.
- Show tax on the invoice modal and the customer-facing document.
- **This is the piece that must exist before any shop that charges sales tax can use invoice sync.**

### PR2 — Customers in QuickBooks

- `EnsureQboCustomer` use-case: look up `qbo_entity_links('customer', leadId)`; else query QBO by
  email/name; else create. Store the link.
- Gateway: `findCustomer`, `createCustomer`.
- Address: `leads.address` is a single free-text field while QBO wants structured `BillAddr`. Send
  it as `Line1` and accept the imprecision — do **not** hand-roll an address parser. (Structured
  addresses are a separate, larger question; AST falls back to the company address, so tax still
  computes.)

### PR3 — Item mapping

- Extend the setup screen with pricebook-item → QBO-item matching, mirroring the existing crew
  matcher.
- Org default item as the fallback for anything unmapped, reusing the `default_item_qbo_id` pattern.

### PR4 — Push the invoice

- `SyncInvoice` use-case + `toQboInvoice` mapping, modelled on `sync-approved-hours.ts` /
  `time-activity-mapping.ts` — including its per-row failure isolation and its up-front sync-log
  check.
- **Guard first:** refuse on total ≠ Σ lines (blocker 1a).
- Migration: widen `qbo_entity_links_type_check` to include `'invoice'` and `'payment'`.
- Handler on `invoice.sent`, registered in `trpc/outbox-registry.ts`.

### PR5 — Updates and voids

`invoice.updated` → sparse update with `SyncToken`. `invoice.voided` → void. Both no-op when the
invoice was never synced.

### PR6 — Payments

`invoice.payment.recorded` → QBO `Payment` with `LinkedTxn` to the invoice.
`invoice.payment.unapplied` → the reversal. Deposits ride the same path.
This is what closes the loop: without it every synced invoice sits in QuickBooks unpaid forever.

## What we are NOT doing

- **No pulling from QuickBooks.** One direction only. Two-way sync needs conflict resolution and
  doubles the surface; nobody has asked for it.
- **No hand-rolled tax engine.** Mallet computes from one rate; jurisdiction logic stays Intuit's.
- **No address parser.**
- **No invoice sync enabled by default.** Own switch, own consent, off until the shop turns it on —
  the same shape as `send_approved_hours`.

## Verification

- Unit: the mappings (`toQboInvoice`, `toQboPayment`, `toQboCustomer`) and every refusal path — the
  total mismatch, the unmapped item, the missing customer. `modules/**/app/**` is inside the
  coverage gate.
- Integration: real RLS, cross-tenant refusal on every new use-case.
- **End-to-end against the sandbox company**, then read back through the QBO API rather than
  trusting our own sync log — the same check that verified the timesheet push.
- Reconciliation test, the one that matters: create → send → pay in Mallet, then assert QuickBooks
  shows the same total, the same tax and a zero balance.
- Full gate: tsc · lint · lint:css · unit · int · coverage · build · axe.

## Sequencing recommendation

**PR0 and PR1 are prerequisites, not phases** — they are worth building even if invoice sync is
never finished. PR0 makes the existing hours sync trustworthy; PR1 fixes an invoice that is wrong
today for any shop that charges sales tax.

Then PR2 → PR6 in order. PR4 without PR6 is worse than nothing: it fills a shop's books with
invoices that never get marked paid.

## Sources

- [Automated Sales Tax in the QuickBooks Online API](https://medium.com/intuitdev/automated-sales-tax-in-the-quickbooks-online-api-7d990e381ace)
- [Automated Sales Tax – FAQ, Intuit Developer](https://blogs.intuit.com/2018/05/11/automated-sales-tax-faq/)
- [Using QuickBooks Online API for automated sales tax](https://blogs.intuit.com/2017/12/11/using-quickbooks-online-api-automated-sales-tax/)
