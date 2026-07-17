# Stripe Connect Express — Onboarding Foundation (PR1) Design

**Status:** approved direction (Owen chose Express Connect; test-mode first). This spec covers
**PR1 only** — the onboarding foundation. Charging on the connected account + platform fee +
`account.updated` webhook are **PR2**; Tap to Pay (Capacitor + Stripe Terminal) is **PR3**.

## Goal

Let a shop (org) connect its own bank to Stripe via **Express** onboarding — Stripe-hosted KYC —
so it becomes able to receive payments. Store the connected account id + onboarding status on the
org, surface a "Get paid" card in Settings, and reflect connected/not-connected state. No money
moves in this PR.

## Why this split

- PR1 needs **no platform fee** (nothing is charged yet) and **no webhook change** (status is
  refreshed on the onboarding-return redirect + an explicit status query). Both belong to PR2.
- The connected account is a **prerequisite for both** online invoice payments (PR2) and Tap to
  Pay (PR3), so building onboarding first is the correct order regardless of what ships next.

## Charge model (decided — informs PR2, recorded here for context)

**Destination charges with `on_behalf_of` + `application_fee_amount`.** The existing
`StripeClient.CreateCheckoutParams` already reserves `connectedAccountId` + `applicationFeeCents`
with the comment *"reserved for the Connect migration (destination charges)"* — the checkout path
is already shaped for this. Destination charges keep the charge on Mallet's platform account
(so the current metadata-based webhook keeps working **unchanged**), while `on_behalf_of` makes
the **shop** the merchant of record — the customer sees the shop's name on their statement, and
the shop bears Stripe's processing fees. This is the standard marketplace pattern and the
least-disruptive path. (Direct charges were the alternative: fuller merchant separation but a
Connect-aware webhook rewrite — not worth it for the pilot.) **PR1 does not implement charging;
this is documented so the schema/port shapes are forward-compatible.**

## Data model

Add to `org_settings` (one row per org, already RLS'd via migration 0045 — **no new RLS needed**,
additive columns only). Migration `0083`:

| column | type | notes |
|---|---|---|
| `stripe_connected_account_id` | `text` (nullable) | the `acct_...` id; null until onboarding begins |
| `stripe_charges_enabled` | `boolean NOT NULL DEFAULT false` | mirrors Stripe `Account.charges_enabled` |
| `stripe_payouts_enabled` | `boolean NOT NULL DEFAULT false` | mirrors `Account.payouts_enabled` |
| `stripe_details_submitted` | `boolean NOT NULL DEFAULT false` | mirrors `Account.details_submitted` |
| `stripe_onboarded_at` | `timestamptz` (nullable) | first time charges_enabled flipped true |

`stripe_connected_account_id` validation at the domain boundary: non-empty, must start with
`acct_`. Status booleans default false and only ever move to Stripe's reported truth.

## Architecture (hexagonal, follows existing patterns)

- **`platform/adapters/stripe/stripe-client.ts`** — the ONLY Stripe-SDK file. Add three methods,
  each wrapped in the existing `call(...)` resilience helper (timeout + retry + shared breaker),
  mirroring `createCheckoutSession`:
  - `createExpressAccount(params: { orgId; country; idempotencyKey }) → { accountId }`
    (`accounts.create({ type: "express", ... })`, `country` default `"US"`).
  - `createAccountLink(params: { accountId; refreshUrl; returnUrl }) → { url }`
    (`accountLinks.create({ type: "account_onboarding" })`). Account links are single-use and
    short-lived — created fresh each time onboarding is (re)started; **not** idempotency-keyed.
  - `retrieveAccount(accountId) → { chargesEnabled; payoutsEnabled; detailsSubmitted }`
    (`accounts.retrieve`; GET, retriable).
- **`modules/settings/domain/connect-gateway.ts`** — new `ConnectGateway` port (mirrors
  `PaymentLinkGateway`): the three ops above returning `Result<..., ExternalServiceError>`.
- **`modules/settings/infra/stripe-connect-gateway.ts`** — `StripeConnectGateway implements
  ConnectGateway`, wraps `StripeClient`, logs provider detail server-side, returns generic
  `externalService("stripe", ...)` to callers (never leak Stripe internals). Mirrors
  `StripePaymentLinkGateway`.
- **`modules/settings` domain/repo** — extend `OrgSettingsProps` with the 5 fields + a
  `patchStripe(fields, now)` method (immutable, returns new instance); extend `SettingsRepository`
  with `saveStripeAccountId(accountId)` + `saveStripeStatus(status)`; the Drizzle repo + mapper
  read/write the new columns.
- **`modules/settings/app`** — two use cases:
  - `BeginConnectOnboarding` (`ConnectGateway` + `SettingsRepository` + `IdGenerator`): load
    settings; if no `stripe_connected_account_id` → `createExpressAccount` → persist id; then
    `createAccountLink(returnUrl=/settings?tab=payments&connect=return,
    refreshUrl=/settings?tab=payments&connect=refresh)` → `{ url }`.
  - `RefreshConnectStatus` (`ConnectGateway` + `SettingsRepository`): if no account id → return
    `{ connected: false }`; else `retrieveAccount` → `saveStripeStatus` (stamp `onboarded_at` the
    first time `charges_enabled` is true) → return the status.
- **`modules/settings/api/settings-router.ts`** — a `payments` sub-namespace, all
  `ownerOrOffice`, gated on `ctx.deps.connectGateway != null` (`PRECONDITION_FAILED` when Stripe
  unconfigured, mirroring the invoice `createPayment` null-check):
  - `payments.status` (query) → `{ connected, chargesEnabled, payoutsEnabled, detailsSubmitted }`
    (reads persisted status; no Stripe call).
  - `payments.beginOnboarding` (mutation) → `{ url }`.
  - `payments.refresh` (mutation) → the status object (calls Stripe, persists, returns).
- **DI**: `trpc/di.ts` instantiates `StripeConnectGateway` when `STRIPE_SECRET_KEY &&
  PUBLIC_APP_URL` (same gate as the payment gateway); `trpc/deps.ts` adds
  `connectGateway: ConnectGateway | null`.
- **UI**: `app/(office)/settings/payments-card.tsx` — a new `payments` tab + `FoldCard`. States:
  **Not connected** ("Connect your bank to get paid" + primary "Get paid" → `beginOnboarding`,
  redirect to `url`); **Setup incomplete** (`details_submitted` false or `charges_enabled` false
  after a return → "Finish setup" re-runs onboarding); **Connected ✓** (charges + payouts
  enabled). On mount with `?connect=return`, call `payments.refresh`. House rules: no floating UI,
  plain business labels, `btn primary/ghost`, no purple/sparkle.

## Error handling

- Stripe unconfigured → `PRECONDITION_FAILED` (self-disabling gateway, like the payment path).
- Provider/transient failure → gateway returns `ExternalServiceError`; router maps to
  `BAD_GATEWAY`; UI shows a plain "couldn't reach the payment provider — try again". Raw Stripe
  detail is logged server-side only.
- Account link is single-use/expired → user simply re-clicks "Get paid" (fresh link each call).
- Missing/invalid account id shape at the domain boundary → validation error, not a Stripe call.

## Tenant safety

- `orgId` ALWAYS from `ctx.principal.orgId`; the connected account id is looked up **from the
  org's own settings row** under RLS + the org-bound repo — never from client input.
- No cross-org lookup by `acct_id` is introduced in PR1 (that need only arises with the
  `account.updated` webhook in PR2, which will use a deliberate system-scoped query).

## Testing

- **Unit**: `BeginConnectOnboarding` (creates account when none, reuses when present, persists id,
  returns link url); `RefreshConnectStatus` (not-connected short-circuit, status persist,
  `onboarded_at` stamped once); `StripeConnectGateway` error mapping (fake `StripeClient` throwing
  → generic `ExternalServiceError`, no leak); domain `patchStripe` validation (rejects non-`acct_`
  id); mapper round-trips the new columns.
- **Integration** (settings-router, if the harness runs): `payments.status`/`beginOnboarding`
  gated by null gateway; RLS scoping of the new columns.
- Full gate before PR: `tsc --noEmit` · `lint` (0 errors) · `test` · `coverage` (≥80/75) ·
  `build`. `test:int` on the task-specific files (shared-DB hang caveat).

## Out of scope (explicit)

- Charging on the connected account, `application_fee_amount`, `on_behalf_of`, platform-fee config
  — **PR2**.
- `account.updated` webhook + system-scoped org-by-acct lookup — **PR2**.
- Tap to Pay (Capacitor shell + Stripe Terminal Capacitor plugin + ProximityReader entitlement) —
  **PR3**.
- Mallet's own SaaS subscription billing (Stripe Billing on the platform account) — separate track.
- Per-org negotiated fees, payout scheduling UI, dispute handling — YAGNI for the pilot.

## Global constraints

- Stripe SDK is already `^22.3.0`; all SDK calls go through `StripeClient` only.
- App runs on a `sk_test` key today — everything is test-mode; safe to build and deploy.
- Money is integer cents in domain/DTO (not relevant to PR1 — no amounts here).
- New `org_settings` columns are additive; RLS already present (no new policy). Migration is
  single-writer — `0083`, no open PR touches migrations.
- Hexagonal layering (router → use-case → domain → repo); DTO ≠ domain; validate at boundaries;
  no silent failures; resilience only around the real external call (Stripe).
