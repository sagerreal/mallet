# ADR 0001: Stripe card payments for the pilot

- **Status:** Accepted
- **Date:** 2026-06-30
- **Context:** Phase 2 — the Invoicing vertical already records *manual* payments (cash/check/ACH/terminal) through an append-only ledger with an atomic denormalized balance. This ADR covers adding *online card* payments so an invoice can carry a "Pay now" link.

## Decision

### 1. Hosted Checkout Session, not Payment Links or embedded Elements

We create a Stripe **Checkout Session** (`mode: "payment"`) per pay request and hand back the hosted `session.url`. The customer pays on Stripe's page; we never touch card data (SAQ-A scope).

- **Rejected — Payment Links:** they are reusable, product-catalog objects with no clean per-invoice amount/metadata binding and no natural idempotency per pay attempt. A Session is single-purpose, carries our `orgId`/`invoiceId` metadata, and expires.
- **Rejected — embedded Elements / PaymentIntents UI:** more PCI scope and a custom card form we don't need for a pilot. We can migrate later without changing the ledger.

The amount is sent as an inline `price_data.unit_amount` (integer cents) for the invoice balance — no pre-created Price/Product objects to keep in sync.

### 2. Platform charge now; Stripe Connect deferred

Pilot money settles to **Mallet's own Stripe account** (a platform charge). Multi-tenant payouts to each contractor's own Stripe account (Connect destination charges) are deferred to a later phase. The adapter reserves optional `connectedAccountId` / `applicationFeeCents` parameters so the migration is additive, not a rewrite.

- **Why:** Connect onboarding (KYC, payout schedules, `account.updated` webhooks) is a whole slice of its own. It is not needed to prove the pilot loop (lead → quote → job → invoice → paid). Contractors are reimbursed out-of-band during the pilot.

### 3. The Stripe `payment_intent` id is the ledger idempotency key

Card payments settle **asynchronously**: `createPayment` only returns a URL (no ledger write); the money is recorded later when the `checkout.session.completed` webhook fires. We record it through the **same** idempotent + atomic path as manual payments, keyed on the immutable `pi_…` id.

- **Idempotency:** `payments` is deduped on `(org_id, idempotency_key)` and `idempotency_key = external_id = payment_intent.id`. So webhook **redelivery**, or receiving *both* `checkout.session.completed` and a future `payment_intent.succeeded`, records the money **exactly once** (`insertPayment` claims the key first; an already-claimed key is a no-op that returns the current invoice).
- **No `processed_stripe_events` table:** the ledger's `payment_intent`-keyed dedup is authoritative, and skipping a second table keeps every write inside the one `withTenant` transaction. (We do not need per-`event.id` dedup because the money is keyed on the payment intent, not the event.)
- **We record the amount Stripe actually settled** (`amount_total`), not the amount we asked for, so a partial/adjusted capture reconciles correctly. If the invoice moved to `paid`/`void` between session-create and settlement, the ledger row still stands (real money) but is **not** applied — it surfaces for manual reconciliation rather than un-voiding or double-paying.

## Security properties (why cross-tenant writes are impossible)

`orgId`/`invoiceId` come **only** from the signature-verified event `metadata` we stamped at session-create — never from request headers or the URL. Even so, defense in depth holds:

- The webhook route verifies the HMAC signature over the **raw** body before any parsing; a tampered body is a `400` with zero DB work.
- The record runs inside `withTenant(orgId)`, so RLS scopes the write to the claimed org.
- The composite FK `payments(org_id, invoice_id) → invoices(org_id, id)` means a payment claiming org B against org A's invoice has no valid parent row and the insert throws (`500`, Stripe retries) — it can never write to the real owner's invoice.

These three are covered by `app/api/webhooks/stripe/route.int.test.ts` (valid signed → paid + idempotent redelivery; tampered → 400; cross-tenant metadata → 500, no write) against live RLS.

## Consequences

- Stripe is **optional**: the app boots and falls back to manual payments if `STRIPE_SECRET_KEY` / `PUBLIC_APP_URL` are unset (`createPayment` returns `PRECONDITION_FAILED`; the webhook route returns `503`).
- The Stripe SDK is confined to one adapter (`platform/adapters/stripe/stripe-client.ts`); use-cases and tests depend on the `PaymentLinkGateway` port, never the SDK.
- Create calls go through the platform resilience wrapper (timeout + idempotent retry + per-service circuit breaker); the Stripe `Idempotency-Key` makes a retried create return the *same* session, not a duplicate.
- **Deferred / operational:** obtain a production `whsec_` from `stripe listen` (or the dashboard Webhooks page) for real end-to-end testing; A2P/Connect live registration is a Phase-2+ task.
