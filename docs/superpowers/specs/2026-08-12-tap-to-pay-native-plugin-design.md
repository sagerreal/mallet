# Tap to Pay — Native Plugin Contract (PR2) Design

**Status:** contract for the NEXT PR. The server foundation shipped in PR1
(`feat/tap-to-pay-server`): `v1.terminal.connectionToken` / `location` /
`createTapPaymentIntent` / `reconcileTapPayment`, the `org_settings.stripe_terminal_location_id`
column, `lib/native/tap-to-pay.ts` (availability probe) and the disabled-with-reason button in
the close-out pay block. PR2 is the **iOS shell** work: a `MalletTapToPay` Capacitor plugin
wrapping the Stripe Terminal iOS SDK's Tap to Pay reader, plus the web-side collect flow that
replaces the disabled button with a live one when availability is `ready`.

## What already exists (PR1 — do not rebuild)

| Piece | Where | Contract |
|---|---|---|
| Connection token mint | `v1.terminal.connectionToken` (mutation, anyRole) | `{} → { secret }`. Minted ON the org's connected account (direct-charge model), scoped to the org's location when stored. PRECONDITION_FAILED until Connect onboarding finishes. |
| Location ensure | `v1.terminal.location` (mutation, anyRole) | `{} → { locationId, created }`. Create-once per org on the connected account, from the shop's own name/address; persisted in `org_settings.stripe_terminal_location_id`. |
| Intent mint | `v1.terminal.createTapPaymentIntent` (mutation, anyRole, **assignment-gated** like the field money surface) | `{ invoiceId } → { paymentIntentId, clientSecret, amountCents }`. `payment_method_types: ['card_present']`, `capture_method: 'automatic'`, full balance only, 0.25% `application_fee_amount`, metadata `{orgId, invoiceId, kind:"tap"}`. Idempotency key stable per (org, invoice, balance, account, fee) — a declined-card retry MUST reuse the same intent (Stripe's own double-charge guidance). |
| Recorder | `v1.terminal.reconcileTapPayment` (mutation, anyRole, assignment-gated) | `{ invoiceId, paymentIntentId } → { recorded, reason? }`. Retrieves the intent from the org's OWN connected account, requires `status: succeeded` + matching metadata, records `amount_received` through `RecordCardPaymentUseCase` keyed on the `pi_…` id (idempotent — safe to call twice, safe beside a future Connect webhook). |
| Availability probe | `lib/native/tap-to-pay.ts` | Statuses: `ready · checking · no-native-app · plugin-missing · unsupported-device`. Plugin name is **`MalletTapToPay`** — the probe already looks it up; registering the plugin flips the shell from `plugin-missing` without touching web code. |
| UI | `components/shared/tap-to-pay-unavailable.tsx` + close-out `PayBlock` | Disabled-with-reason for every non-live state. PR2 renders the LIVE button on `ready` and keeps this component for the rest. |

**Reconcile posture (decided in PR1):** the device that confirmed the intent calls
`reconcileTapPayment` — the tap sibling of the Checkout success-page reconcile. The platform
webhook does NOT see direct-charge events; if a Connect webhook endpoint (separate signing
secret, "listen to connected accounts") is ever added, it can record through the same
`RecordCardPaymentUseCase` with zero double-record risk (same `pi_…` idempotency key).

## Native plugin: `MalletTapToPay`

### Shell constraints (from the existing MalletRoomScan precedent — mallet-ios)

- **SPM, not CocoaPods.** Add `stripe-terminal-ios` (StripeTerminal, SDK 3.x+) as an SPM package.
- **Static plugin manifest.** The shell registers plugins from a static list in
  `capacitorDidLoad` — add `MalletTapToPay` there; a build that forgets the entry probes as
  `plugin-missing` (the web UI already says "update the app").
- **Entitlement (the long pole):** `com.apple.developer.proximity-reader.payment.acceptance`
  requires applying to Apple (Tap to Pay on iPhone entitlement request) and a matching
  provisioning profile. Apply EARLY — approval is measured in days-to-weeks. Device floor:
  iPhone XS or newer on a current iOS; the plugin's `available()` reflects exactly this.
- Terminal SDK singleton must be initialized ONCE (`Terminal.setTokenProvider`) before any
  discovery; initialize lazily on first use, not at app launch.

### Plugin surface

```ts
interface MalletTapToPay {
  /** Device gate ONLY (SDK supportsReaders / iOS + model check). Never permissions/Stripe state. */
  available(): Promise<{ available: boolean; reason?: string }>;

  /**
   * One call = one payment. Discovers the LOCAL MOBILE reader (this phone), connects it to
   * `locationId`, retrieves the intent by `clientSecret`, then collect + confirm. The full-screen
   * Apple payment sheet takes over during collection; control returns with the outcome.
   * Rejects (with functional, user-readable messages) on entitlement/connection faults;
   * resolves with a status for normal payment outcomes — a decline is an OUTCOME, not an error.
   */
  collectPayment(options: {
    clientSecret: string;   // from v1.terminal.createTapPaymentIntent
    locationId: string;     // from v1.terminal.location
  }): Promise<
    | { status: "succeeded"; paymentIntentId: string }
    | { status: "canceled" }                          // user/customer backed out
    | { status: "declined"; message: string }         // card declined — same intent is retryable
  >;
}
```

**Connection tokens.** The Terminal SDK demands a `ConnectionTokenProvider` callback, and a
Capacitor plugin cannot synchronously call back into JS. Contract: the plugin emits a
`connectionTokenNeeded` event; the JS driver listens, calls `v1.terminal.connectionToken`, and
answers via `provideConnectionToken(secret: string)` / `connectionTokenFailed(message: string)`
plugin methods. (Fetching one token BEFORE `collectPayment` and passing it in is NOT sufficient —
the SDK refreshes tokens on its own schedule.)

```ts
// additional plugin surface for the token bridge
addListener("connectionTokenNeeded", () => void): PluginListenerHandle;
provideConnectionToken(options: { secret: string }): Promise<void>;
connectionTokenFailed(options: { message: string }): Promise<void>;
```

### Web-side driver (PR2, `lib/native/tap-to-pay.ts` grows these)

1. `ensureTapToPayReady()` — `v1.terminal.location()` once (cache the locationId in module
   state; it never changes), wire the `connectionTokenNeeded` listener once.
2. `collectTapPayment(invoiceId)`:
   `v1.terminal.createTapPaymentIntent({invoiceId})` → `plugin.collectPayment({clientSecret,
   locationId})` → on `succeeded`: `v1.terminal.reconcileTapPayment({invoiceId,
   paymentIntentId})` → re-read via `v1.fieldInvoicing.get` and adopt (identical to the checkout
   QR poll's adoption path). On `declined`: offer retry — DO NOT mint a new intent; the stable
   idempotency key returns the same one, which is the double-charge guard.
3. Close-out `PayBlock`: `availability.status === "ready"` renders the live Tap to Pay button
   (same `copay-tap` shape) driving `collectTapPayment`; every other status keeps
   `TapToPayUnavailable`. Failure keeps the "record it instead" escape hatch visible, exactly
   like the card step.

### Test plan (PR2)

- Unit: token-bridge driver (event → tRPC → provide), decline-retry reuses the intent,
  reconcile-after-success adoption. Simulated plugin via the existing `nativePlugin` mock seam.
- Device (manual, Stripe **test mode**): the Terminal SDK's Tap to Pay simulated reader
  (`simulated: true` discovery) works in the iOS Simulator for the whole flow short of real NFC.
- Server already covered: `modules/invoicing/api/terminal-router.int.test.ts` (live RLS).

### Out of scope for PR2

- Connect webhook endpoint for `payment_intent.succeeded` on connected accounts (redundant with
  the reconcile call; add only if unreconciled succeeded intents actually show up).
- Tipping, surcharging, receipts-from-Stripe (Mallet's own document flow already covers the
  customer copy), refunds from the phone.
