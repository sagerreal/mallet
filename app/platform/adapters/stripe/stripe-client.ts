import Stripe from "stripe";
import { call, CircuitBreaker, TimeoutError } from "@mallet/platform/resilience";

// The ONLY file that imports the Stripe SDK. Wraps the two calls the app needs behind a tiny
// surface so use-cases/tests never touch the SDK directly. The create call goes through the
// resilience wrapper (timeout + idempotent retry + per-service breaker); the Stripe Idempotency-Key
// makes a retry return the SAME session rather than a duplicate charge.

// Only TRANSIENT failures are worth retrying. A deterministic client error (bad request, auth,
// declined card) fails identically on every attempt, so retrying it wastes round-trips AND — because
// the breaker is shared process-wide (ONE client via getSharedStripeClient below) — counts N times
// toward the circuit breaker, which could trip card payments for EVERY tenant. So those must throw on the first
// attempt; we retry only timeouts, dropped connections, 5xx (StripeAPIError), and 429 (rate limit).
export const isRetriableStripeError = (error: unknown): boolean =>
  error instanceof TimeoutError ||
  error instanceof Stripe.errors.StripeConnectionError ||
  error instanceof Stripe.errors.StripeAPIError ||
  error instanceof Stripe.errors.StripeRateLimitError;

/**
 * The customer-facing sentence on a CARD refusal ("Your card has insufficient funds."), or null
 * when the error is anything else. Lives here because this is the only file allowed to touch the
 * SDK's error classes — the charge gateway needs to tell "the bank said no" (surface verbatim,
 * never retry) from "Stripe is down" (generic copy, retriable) without importing Stripe itself.
 * Stripe authors these messages for end users; when one is somehow absent, a plain fallback still
 * names the actual problem.
 */
export const stripeCardDeclineMessage = (error: unknown): string | null => {
  if (!(error instanceof Stripe.errors.StripeCardError)) return null;
  const message = error.message?.trim();
  return message && message !== "" ? message : "The card was declined.";
};

/**
 * WHAT the money is for. Stamped into the session metadata as `kind`, which is how the webhook and
 * the success-page reconcile decide which recorder a settled session belongs to — an invoice
 * payment goes to the payments ledger, a quote deposit goes to estimates.dep_paid_cents. A single
 * untagged `invoiceId` could not express the second one, and a deposit session that fell through
 * to the invoice recorder would credit an unrelated invoice.
 *
 * Sessions minted before `kind` existed carry only {orgId, invoiceId}; both readers still treat an
 * absent kind as "payment", so in-flight ones settle correctly.
 */
export type CheckoutSubject =
  | { readonly kind: "payment"; readonly invoiceId: string }
  | { readonly kind: "deposit"; readonly estimateId: string };

export interface CreateCheckoutParams {
  readonly amountCents: number;
  readonly currency: string; // "usd"
  readonly orgId: string;
  readonly subject: CheckoutSubject;
  readonly description: string;
  readonly idempotencyKey: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  // Connect destination charge: settle to the shop's connected account and skim the platform fee.
  readonly connectedAccountId?: string;
  readonly applicationFeeCents?: number;
}

export interface CheckoutResult {
  readonly url: string;
  readonly sessionId: string;
}

// ── Connect (Express) — PR1 onboarding. No charge/transfer here. ──────────────
export interface CreateExpressAccountParams {
  readonly country: string; // "US"
  readonly idempotencyKey: string;
}

export interface CreateAccountLinkParams {
  readonly accountId: string;
  readonly refreshUrl: string;
  readonly returnUrl: string;
}

export interface ConnectAccountStatus {
  readonly chargesEnabled: boolean;
  readonly payoutsEnabled: boolean;
  readonly detailsSubmitted: boolean;
}

export class StripeClient {
  private readonly stripe: Stripe;
  private readonly breaker = new CircuitBreaker("stripe", { failureThreshold: 5, resetMs: 30_000 });

  // maxNetworkRetries: 0 — retries are owned by the resilience wrapper so the policy is uniform.
  constructor(secretKey: string) {
    this.stripe = new Stripe(secretKey, { maxNetworkRetries: 0 });
  }

  async createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutResult> {
    // Stamped on BOTH the session and the payment intent: the webhook reads the session's copy,
    // and the intent's copy survives on the charge for anyone auditing it in the Stripe dashboard.
    const metadata: Record<string, string> =
      params.subject.kind === "deposit"
        ? { orgId: params.orgId, estimateId: params.subject.estimateId, kind: "deposit" }
        : { orgId: params.orgId, invoiceId: params.subject.invoiceId, kind: "payment" };
    // Destination charge (Connect, PR2): settle the funds to the shop's connected account and skim
    // Mallet's application fee. on_behalf_of makes the charge present as the shop's; transfer_data
    // .destination routes the money. Attached only when a connected account is supplied so the
    // platform-charge shape stays available for tests / a Stripe-not-Connected fallback.
    const paymentIntentData: Stripe.Checkout.SessionCreateParams.PaymentIntentData = { metadata };
    if (params.connectedAccountId) {
      paymentIntentData.on_behalf_of = params.connectedAccountId;
      paymentIntentData.transfer_data = { destination: params.connectedAccountId };
      if (params.applicationFeeCents !== undefined) {
        paymentIntentData.application_fee_amount = params.applicationFeeCents;
      }
    }
    const session = await call(
      () =>
        this.stripe.checkout.sessions.create(
          {
            mode: "payment",
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: params.currency,
                  unit_amount: params.amountCents,
                  product_data: { name: params.description },
                },
              },
            ],
            metadata,
            // Card on file, DEFAULT-ON: every settled checkout saves the card for later
            // off-session charging ("charge card on file" at the door). `customer_creation:
            // "always"` mints the platform Customer a payment-mode session otherwise skips, and
            // `setup_future_usage: "off_session"` attaches the paying card to it — with Stripe's
            // own on-page consent language shown to the customer at pay time. The saved pointers
            // stay on the PLATFORM account (this is a platform-held destination charge), which
            // is exactly where the later charge runs. Capture of the resulting facts happens in
            // the webhook/reconcile paths (captureCardOnFile); sessions minted before this
            // simply have nothing to capture.
            customer_creation: "always",
            payment_intent_data: { ...paymentIntentData, setup_future_usage: "off_session" },
            success_url: params.successUrl,
            cancel_url: params.cancelUrl,
          },
          // timeout: the SDK aborts ITS OWN socket at the deadline (v22 has no AbortSignal option),
          // so a retry can't overlap a still-open request. idempotencyKey keeps retries money-safe.
          { idempotencyKey: params.idempotencyKey, timeout: 10_000 },
        ),
      { idempotent: true, retries: 2, timeoutMs: 10_000, breaker: this.breaker, shouldRetry: isRetriableStripeError },
    );
    if (!session.url) throw new Error("stripe returned a checkout session without a url");
    return { url: session.url, sessionId: session.id };
  }

  // Read back a Checkout Session (success-page reconcile). GET — safe to retry; no expansions
  // needed (payment_intent arrives as its string id, which is all the recorder keys on).
  async retrieveCheckoutSession(sessionId: string): Promise<Stripe.Checkout.Session> {
    return call(
      () => this.stripe.checkout.sessions.retrieve(sessionId, {}, { timeout: 10_000 }),
      { idempotent: true, retries: 2, timeoutMs: 10_000, breaker: this.breaker, shouldRetry: isRetriableStripeError },
    );
  }

  // Create an Express connected account for a shop. Idempotency-keyed so a retry returns the SAME
  // account rather than minting a duplicate. card_payments + transfers requested so the account can
  // later take destination charges (PR2); onboarding collects the rest via the hosted link.
  async createExpressAccount(params: CreateExpressAccountParams): Promise<{ accountId: string }> {
    const account = await call(
      () =>
        this.stripe.accounts.create(
          {
            type: "express",
            country: params.country,
            capabilities: {
              card_payments: { requested: true },
              transfers: { requested: true },
            },
          },
          { idempotencyKey: params.idempotencyKey, timeout: 10_000 },
        ),
      { idempotent: true, retries: 2, timeoutMs: 10_000, breaker: this.breaker, shouldRetry: isRetriableStripeError },
    );
    return { accountId: account.id };
  }

  // Create a single-use, short-lived Stripe-hosted onboarding link. NOT idempotency-keyed: each
  // (re)start of onboarding must mint a FRESH link (a reused/expired link is a dead end).
  async createAccountLink(params: CreateAccountLinkParams): Promise<{ url: string }> {
    const link = await call(
      () =>
        this.stripe.accountLinks.create({
          account: params.accountId,
          refresh_url: params.refreshUrl,
          return_url: params.returnUrl,
          type: "account_onboarding",
        }),
      { idempotent: false, retries: 2, timeoutMs: 10_000, breaker: this.breaker, shouldRetry: isRetriableStripeError },
    );
    if (!link.url) throw new Error("stripe returned an account link without a url");
    return { url: link.url };
  }

  // Read the connected account's onboarding/capability status. GET — safe to retry.
  async retrieveAccount(accountId: string): Promise<ConnectAccountStatus> {
    const account = await call(
      () => this.stripe.accounts.retrieve(accountId),
      { idempotent: true, retries: 2, timeoutMs: 10_000, breaker: this.breaker, shouldRetry: isRetriableStripeError },
    );
    return {
      chargesEnabled: account.charges_enabled ?? false,
      payoutsEnabled: account.payouts_enabled ?? false,
      detailsSubmitted: account.details_submitted ?? false,
    };
  }

  // Verifies the webhook signature against the raw body. Throws on any tampering / bad signature.
  constructEvent(rawBody: string, signature: string, webhookSecret: string): Stripe.Event {
    return this.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  }

  // ── Card on file — capture + off-session charge (platform-held, like Checkout) ─────────────

  /**
   * The reusable card a settled intent saved, or null when it saved nothing — a session minted
   * before setup_future_usage was requested, or an instrument with no card behind it. Platform
   * call, no Stripe-Account header: the Checkout session that saved the card was platform-held,
   * so the Customer and payment method live on the platform account. GET — safe to retry.
   */
  async retrieveSavedCardFromIntent(paymentIntentId: string): Promise<{
    customerId: string;
    paymentMethodId: string;
    brand: string;
    last4: string;
  } | null> {
    const intent = await call(
      () =>
        this.stripe.paymentIntents.retrieve(
          paymentIntentId,
          { expand: ["payment_method"] },
          { timeout: 10_000 },
        ),
      { idempotent: true, retries: 2, timeoutMs: 10_000, breaker: this.breaker, shouldRetry: isRetriableStripeError },
    );
    // Only an intent that ASKED to save the card attached it for reuse — anything else holds a
    // one-off payment method that off_session charging would refuse.
    if (!intent.setup_future_usage) return null;
    const customerId = typeof intent.customer === "string" ? intent.customer : (intent.customer?.id ?? null);
    const pm = intent.payment_method;
    if (!customerId || !pm || typeof pm === "string" || !pm.card) return null;
    return {
      customerId,
      paymentMethodId: pm.id,
      brand: pm.card.brand,
      last4: pm.card.last4,
    };
  }

  /**
   * Charge a saved card off-session — the "card on file" charge. Same destination-charge posture
   * as createCheckoutSession (platform-held intent, on_behalf_of + transfer_data + application
   * fee), because that is where the saved Customer lives. confirm: true — the charge happens on
   * this call or throws; a decline arrives as StripeCardError (see stripeCardDeclineMessage) and
   * is DETERMINISTIC, so isRetriableStripeError keeps it off the retry path and away from the
   * shared breaker.
   */
  async chargeSavedCard(params: {
    amountCents: number;
    currency: string;
    customerId: string;
    paymentMethodId: string;
    description: string;
    orgId: string;
    invoiceId: string;
    connectedAccountId: string;
    applicationFeeCents: number;
    idempotencyKey: string;
  }): Promise<{ paymentIntentId: string; amountReceivedCents: number }> {
    const intent = await call(
      () =>
        this.stripe.paymentIntents.create(
          {
            amount: params.amountCents,
            currency: params.currency,
            customer: params.customerId,
            payment_method: params.paymentMethodId,
            off_session: true,
            confirm: true,
            description: params.description,
            // `kind: "onfile"` keeps this intent out of the Checkout recorders' path the same
            // way "tap" does for Terminal — the use-case records it directly, keyed on the id.
            metadata: { orgId: params.orgId, invoiceId: params.invoiceId, kind: "onfile" },
            on_behalf_of: params.connectedAccountId,
            transfer_data: { destination: params.connectedAccountId },
            application_fee_amount: params.applicationFeeCents,
          },
          { idempotencyKey: params.idempotencyKey, timeout: 10_000 },
        ),
      { idempotent: true, retries: 2, timeoutMs: 10_000, breaker: this.breaker, shouldRetry: isRetriableStripeError },
    );
    if (intent.status !== "succeeded") {
      // requires_action (3DS on an off-session charge) or any other non-terminal state: no money
      // moved and this flow has no customer device to complete it on. Deterministic — not retried.
      throw new Stripe.errors.StripeCardError({
        type: "card_error",
        code: "authentication_required",
        message: "The card requires the customer's confirmation — send the payment link instead.",
      });
    }
    return { paymentIntentId: intent.id, amountReceivedCents: intent.amount_received };
  }
  // ── Terminal (Tap to Pay) — DIRECT charges on the connected account ─────────
  // Every call below carries the Stripe-Account header: with direct charges, connection tokens,
  // locations and card_present PaymentIntents all belong to the shop's connected account
  // (docs.stripe.com/terminal/features/connect, direct variant). One breaker covers these too.

  // Mint a Terminal connection token for the connected account, optionally scoped to a location.
  // Not idempotency-keyed on purpose (each reader session wants a FRESH token, like account
  // links); still safe to retry — an extra unused token just expires.
  async createTerminalConnectionToken(params: {
    connectedAccountId: string;
    locationId?: string | null;
  }): Promise<{ secret: string }> {
    const token = await call(
      () =>
        this.stripe.terminal.connectionTokens.create(
          params.locationId ? { location: params.locationId } : {},
          { stripeAccount: params.connectedAccountId, timeout: 10_000 },
        ),
      { idempotent: true, retries: 2, timeoutMs: 10_000, breaker: this.breaker, shouldRetry: isRetriableStripeError },
    );
    return { secret: token.secret };
  }

  // Create the shop's Terminal Location on its connected account. Idempotency-keyed (stable per
  // org+account upstream) so a retry after a rolled-back save returns the SAME location. The
  // address is best facts on file: country is always US (the only country Connect accounts are
  // created in — see createExpressAccount), line1 is the shop's free-text address when present.
  async createTerminalLocation(params: {
    connectedAccountId: string;
    displayName: string;
    addressLine1?: string | null;
    idempotencyKey: string;
  }): Promise<{ locationId: string }> {
    const location = await call(
      () =>
        this.stripe.terminal.locations.create(
          {
            display_name: params.displayName,
            address: { country: "US", ...(params.addressLine1 ? { line1: params.addressLine1 } : {}) },
          },
          { idempotencyKey: params.idempotencyKey, stripeAccount: params.connectedAccountId, timeout: 10_000 },
        ),
      { idempotent: true, retries: 2, timeoutMs: 10_000, breaker: this.breaker, shouldRetry: isRetriableStripeError },
    );
    return { locationId: location.id };
  }

  // Mint the card_present PaymentIntent a phone-reader collects against — a DIRECT charge on the
  // connected account, with Mallet's fee as application_fee_amount. capture_method automatic per
  // the Terminal docs' one-step option: there is no tip/reconciliation step between collect and
  // capture in this flow, and manual capture's failure mode (an authorization nobody captures
  // expiring after 2 days) is a silent money loss this codebase refuses by construction.
  async createCardPresentPaymentIntent(params: {
    connectedAccountId: string;
    amountCents: number;
    currency: string;
    description: string;
    orgId: string;
    invoiceId: string;
    applicationFeeCents?: number;
    idempotencyKey: string;
  }): Promise<{ paymentIntentId: string; clientSecret: string }> {
    const intent = await call(
      () =>
        this.stripe.paymentIntents.create(
          {
            amount: params.amountCents,
            currency: params.currency,
            payment_method_types: ["card_present"],
            capture_method: "automatic",
            description: params.description,
            // `kind: "tap"` is what lets the reconcile read refuse to double-record a Checkout
            // intent, and vice versa — the same discriminator role CheckoutSubject.kind plays.
            metadata: { orgId: params.orgId, invoiceId: params.invoiceId, kind: "tap" },
            ...(params.applicationFeeCents !== undefined
              ? { application_fee_amount: params.applicationFeeCents }
              : {}),
          },
          { idempotencyKey: params.idempotencyKey, stripeAccount: params.connectedAccountId, timeout: 10_000 },
        ),
      { idempotent: true, retries: 2, timeoutMs: 10_000, breaker: this.breaker, shouldRetry: isRetriableStripeError },
    );
    if (!intent.client_secret) throw new Error("stripe returned a payment intent without a client secret");
    return { paymentIntentId: intent.id, clientSecret: intent.client_secret };
  }

  // Read back a PaymentIntent from a connected account (tap reconcile). GET — safe to retry.
  async retrieveConnectedPaymentIntent(
    connectedAccountId: string,
    paymentIntentId: string,
  ): Promise<Stripe.PaymentIntent> {
    return call(
      () =>
        this.stripe.paymentIntents.retrieve(paymentIntentId, {}, { stripeAccount: connectedAccountId, timeout: 10_000 }),
      { idempotent: true, retries: 2, timeoutMs: 10_000, breaker: this.breaker, shouldRetry: isRetriableStripeError },
    );
  }
}

// ── process-wide shared instance ─────────────────────────────────────────────
//
// The circuit breaker lives ON the client, so a client constructed per request carries a breaker
// that is thrown away before it can ever accumulate five failures — a breaker that cannot trip.
// Every request-path caller (DI root, webhook, reconcile, public checkout) must take the client
// from here so one breaker sees ALL Stripe traffic in the process. Keyed by the secret key so a
// rotation (or a test with a different key) mints a fresh client instead of talking with a stale
// credential. Same lazy-singleton shape as trpc/di.ts's getAppDeps cache.
let sharedClient: { key: string; client: StripeClient } | null = null;

export const getSharedStripeClient = (secretKey: string): StripeClient => {
  if (!sharedClient || sharedClient.key !== secretKey) {
    sharedClient = { key: secretKey, client: new StripeClient(secretKey) };
  }
  return sharedClient.client;
};
