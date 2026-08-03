# Three flows, real money — design

Owner intent (Owen, Aug 3 2026): the three service flows — published price, priced on site,
office quote — must work end-to-end **including the money**, with or without the AI front desk.
Flow map (approved): https://claude.ai/code/artifact/d7067e84-ae93-4908-9d71-bd352baf2cd5

## The three flows, restated as money requirements

1. **Published price** ("$99 drain clearing"): the booked price is ON the job from creation;
   the wrap-up invoice is a one-line receipt; collect at the door (card on the tech's phone,
   cash, check) or send the invoice with a link the customer can pay from.
2. **Priced on site** ("$89 visit fee, credited"): signed price becomes the invoice with its
   line detail; paid before the truck leaves. If the customer declines, the tech can collect
   the visit fee — a one-line fee invoice at the org's configured amount.
3. **Office quote**: accept converts the SAME job (no duplicate); a deposit, when the quote
   asked for one, is genuinely paid from the accept page; final invoice = signed price minus
   the deposit, carries PO number + Net-terms, payable from a link.

## What exists today (verified by code scout, Aug 3)

- Stripe Checkout charging EXISTS: `CreatePaymentUseCase` (invoice must be `sent|partial`,
  balance ≥ 50¢, Connect required) → `StripePaymentLinkGateway` → destination charge with
  `PLATFORM_FEE_BPS = 25`; webhook `app/api/webhooks/stripe/route.ts` records
  `checkout.session.completed` via `RecordCardPaymentUseCase`. `/pay/success` + `/pay/cancel`
  render static copy.
- Express Connect onboarding EXISTS (`modules/settings`, stripe columns on `org_settings`).
- `recordPayment` ledger is solid (idempotency-key claimed first, atomic `applyPayment`).
- Convert-on-accept is SPECCED (2026-08-03-flat-rate-vs-estimate-design.md step 3) but not
  built: both accept paths mint a NEW job via `CreateJobFromEstimateUseCase` (`kind:"work"`
  hardcoded); `estimates.job_id` does not exist; the pipeline "quote it ›" card passes
  `?lead=` only.
- Broken/fake/missing:
  - Invoice **Send** only flips status — nothing is ever delivered to the customer
    (`outbox-registry.ts:21-23`), templates have NO link, `sendInvoiceReminder` has zero UI
    callers. No public invoice page; `invoices` has no token column.
  - Close-out **"Tap to Pay"** is a `Simulate tap →` button — records money as paid without
    charging anyone. Must not survive this build.
  - `CreateInvoiceFromJobUseCase` copies NO lines (`lines: []`) and snapshots `job.totalCents`,
    which the door-sign path does not maintain.
  - Deposits are display-only theater: `Estimate.accept()` fakes `depPaid = depositDue()`
    with no payment; invoices never credit it.
  - Unpriced estimate visits are structurally excluded from close-out
    (`ScopeHandoffBlock`) — no way to collect a declined-visit fee; the fee chip hardcodes
    `"89"` instead of `booking.serviceFee`.
  - `CreateManualJobUseCase` cannot take lines (`total: zeroMoney` hardcoded); `book_visit`
    never persists the spoken flat price and its tool deps lack a pricebook reader.
  - `po_number` exists nowhere.

## Design decisions

- **D1 — Door card = Stripe Checkout on the tech's phone.** The card step at close-out mints
  the existing Checkout session and presents it as a QR code + "Open payment page" button;
  the customer pays on their own phone (or the tech hands theirs). Close-out polls the invoice
  until `paid`. The `Simulate tap` step is deleted. True NFC tap-to-pay stays a later native
  build. New dependency: `qrcode` (battle-tested, MIT) rendered to a data-URL `<img>`.
- **D2 — Send delivers.** `v1.invoicing.send` keeps the status flip; the UI send action now
  also delivers the invoice message (SMS if the lead has a phone, else email; if neither,
  surface PRECONDITION_FAILED per the `assertDelivered` house pattern). The message includes
  the public pay link. This is the product change the approved flow map draws.
- **D3 — Public invoice page** `/i/<token>` mirrors `/q/<token>`: `invoices.public_token`
  (64-hex, partial unique index), GET view + POST `create_checkout` on
  `app/api/public/invoice/[token]/route.ts`. Shows lines, totals, deposit credit, PO,
  `Net N · due <date>`, status; primary `Pay $X` when balance > 0 and org charges enabled.
- **D4 — Payment truth is webhook + reconcile.** Keep the webhook; add a public reconcile
  endpoint the `/pay/success` page calls with `session_id`: server retrieves the session from
  Stripe, and if `payment_status === "paid"` records it **with the same idempotency key the
  webhook uses (the session id)** so double-recording dedups in the ledger. Local dev and
  webhook outages both stop silently losing money.
- **D5 — Deposits become real.** `Estimate.accept()` stops faking `depPaid`. After a signed
  accept with `depBps > 0`, the accept page shows `Pay the deposit — $X` → deposit Checkout
  session (metadata `kind:'deposit', estimateId`) → webhook/reconcile route on `kind` and
  record `dep_paid_cents = amount` on the estimate. `CreateInvoiceFromJobUseCase` copies the
  source estimate's paid deposit into `invoices.deposit_paid_cents`; `invDue` math already
  subtracts it.
- **D6 — Convert-on-accept per the existing spec.** `estimates.job_id` uuid nullable,
  composite FK `(org_id, job_id) → jobs(org_id, id)`. The pipeline card passes
  `?lead=<id>&job=<scopeVisitJobId>`; the composer persists it on draft. On accept, when the
  estimate has `job_id` and that job is `kind='estimate'`: set `source_estimate_id`, copy sold
  lines, flip `kind` to `'work'`, seed the install visit on the SAME job. No `job_id` → mint
  as today (desk quotes are normal).
- **D7 — Booked price lands on the job.** `CreateManualJobUseCase` accepts optional
  `lines: {description, quantity, rateCents, costCents?}[]` (insert → `replaceLines` in the
  same tx, mirroring `CreateJobFromEstimateUseCase`; job `total` = priced-line sum).
  `book_visit` gains a pricebook price reader in `VoiceToolDeps`, resolves flat-lane prices
  via the existing `resolveBookingPrices`, and passes the one line. The office path needs no
  change (price builder already writes lines).
- **D8 — Invoices from jobs carry the lines.** `CreateInvoiceFromJobUseCase` copies priced
  `job_lines` → `invoice_lines` (with `source_job_line_id`) and, when any priced line exists,
  derives `subtotal = Σ qty×rate`, `tax = round(subtotal × job.taxBps / 10000)`,
  `total = subtotal + tax` instead of trusting the stale `job.totalCents` snapshot. No lines →
  current fallback behavior.
- **D9 — The fee is the org's fee.** Close-out's fee chip and the new decline path read
  `booking.serviceFee` (dollars) from settings. An unpriced estimate visit's close-out
  (ScopeHandoffBlock) gains `Collect the visit fee — $X` → creates a one-line invoice
  ("Visit fee — service call") and opens the normal payment block; declining to charge stays
  one tap away (the existing quiet handoff button remains the default).
- **D10 — PO + terms on the invoice's face.** `invoices.po_number` text nullable; editable in
  the office invoice modal; rendered on the customer preview and the public page as
  `PO <n>` beside `Net <termsDays> · due <date>`.
- **D11 — Platform fee stays 25 bps** as built. No pricing changes in this work.

## Schema changes (one migration, additive, columns on existing RLS'd tables)

- `estimates.job_id` uuid NULL + composite FK `(org_id, job_id) → jobs(org_id, id)`.
- `invoices.po_number` text NULL.
- `invoices.public_token` text NULL + partial unique index
  `invoices_public_token_uidx ON invoices(public_token) WHERE public_token IS NOT NULL`.

## Out of scope

Native tap-to-pay/Stripe Terminal, card-on-file, ACH debit collection, scheduled reminders,
refunds, recurring anything (owner-mandated), estimate reminder templates, QBO invoice sync.

## Verification

Full gate (tsc · lint · lint:css · unit · int · coverage ≥80/75 · build) plus a manual
browser E2E of all three flows WITHOUT the AI front desk, on localhost against the live test
Stripe account (`sk_test`, card 4242): flow 1 booked→receipt→QR pay→paid; flow 2
sign→invoice-with-lines→pay + decline→fee collect; flow 3 scope→quote→accept converts same
job→deposit paid→final invoice minus deposit with PO/Net terms→pay from link.
