import { call, CircuitBreaker, TimeoutError } from "@mallet/platform/resilience";
import { logger } from "@mallet/shared/observability";
import type { Result, ExternalServiceError } from "@mallet/shared/types";
import { ok, err, externalService } from "@mallet/shared/types";
import type {
  PaymentLinkGateway,
  CreatePaymentSessionCmd,
  HostedPayment,
} from "@mallet/invoicing";

// Binds the PaymentLinkGateway port to Square. The port is provider-neutral by design — Stripe was
// never the architecture, only the first adapter.
//
// TWO SHAPES THAT DIFFER FROM STRIPE, and both are load-bearing:
//
// 1. There is no connected-account HEADER. Square acts on behalf of the seller because the request
//    carries THAT SELLER'S OAuth access token. So the token is a constructor argument, resolved
//    per-org by the caller, rather than an account id passed per call. `connectedAccountId` on the
//    command is therefore unused here; the port keeps it because Stripe needs it.
//
// 2. The platform fee rides in `checkout_options.app_fee_money`, verified against the live sandbox:
//    a link created with app_fee_money 247 echoes it back on the created link. This is the whole
//    platform revenue model on Square, and it only works because the seller granted
//    PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS at connect time.
const HOSTS = {
  sandbox: "https://connect.squareupsandbox.com",
  production: "https://connect.squareup.com",
} as const;

export interface SquarePaymentLinkConfig {
  readonly environment: "sandbox" | "production";
  /** The connected seller's OAuth access token, already unsealed by the caller. */
  readonly accessToken: string;
  /** The seller location the payment is taken against. Square scopes payments by location. */
  readonly locationId: string;
  /** Where Square sends the payer after paying. */
  readonly redirectUrl: string;
}

interface LinkResponse {
  payment_link?: { url?: unknown; id?: unknown };
  errors?: unknown;
}

const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.length > 0;

export class SquarePaymentLinkGateway implements PaymentLinkGateway {
  private readonly breaker = new CircuitBreaker("square-checkout", {
    failureThreshold: 5,
    resetMs: 30_000,
  });

  constructor(private readonly config: SquarePaymentLinkConfig) {}

  async createPaymentSession(
    cmd: CreatePaymentSessionCmd,
  ): Promise<Result<HostedPayment, ExternalServiceError>> {
    const body: Record<string, unknown> = {
      // Square's own idempotency, fed by the caller's key: a retried send must not mint a second
      // link for the same invoice.
      idempotency_key: cmd.idempotencyKey.slice(0, 128),
      quick_pay: {
        name: cmd.description,
        price_money: { amount: cmd.amountCents, currency: cmd.currency.toUpperCase() },
        location_id: this.config.locationId,
      },
      checkout_options: {
        redirect_url: this.config.redirectUrl,
        // Zero is a legitimate answer (a shop on a plan with no per-transaction fee), and sending
        // app_fee_money: 0 is not — Square rejects a zero fee. Omit it instead.
        ...(cmd.applicationFeeCents > 0
          ? { app_fee_money: { amount: cmd.applicationFeeCents, currency: cmd.currency.toUpperCase() } }
          : {}),
      },
    };

    try {
      const res = await call(
        (signal) =>
          fetch(`${HOSTS[this.config.environment]}/v2/online-checkout/payment-links`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.config.accessToken}`,
              "Content-Type": "application/json",
              Accept: "application/json",
              "Square-Version": "2025-01-23",
            },
            body: JSON.stringify(body),
            signal,
          }),
        {
          timeoutMs: 15_000,
          // Safe to retry BECAUSE of the idempotency key above — Square collapses a repeat into
          // the same link rather than minting a second one.
          idempotent: true,
          retries: 2,
          breaker: this.breaker,
          shouldRetry: (e) => e instanceof TimeoutError || e instanceof TypeError,
        },
      );

      const json = (await res.json()) as LinkResponse;
      if (!res.ok || json.errors) {
        // The error detail is logged server-side; the caller gets one actionable sentence. A 401
        // here means the seller's token is dead — they must reconnect Square.
        logger.warn({ status: res.status, invoiceId: cmd.invoiceId }, "square.payment_link.failed");
        return err(
          externalService(
            "square",
            res.status === 401
              ? "Square rejected the connection — reconnect Square in Settings"
              : "couldn't create the payment link — try again",
            res.status >= 500 || res.status === 429,
          ),
        );
      }

      const url = json.payment_link?.url;
      const id = json.payment_link?.id;
      if (!isNonEmpty(url) || !isNonEmpty(id)) {
        // A 200 without a URL is a protocol failure, not a link. Returning ok here would send a
        // customer an invoice with nowhere to pay.
        logger.error({ invoiceId: cmd.invoiceId }, "square.payment_link.malformed");
        return err(externalService("square", "Square returned an unexpected response", false));
      }
      return ok({ url, externalRef: id });
    } catch (e: unknown) {
      logger.error(
        { err: e instanceof Error ? e.message : String(e), invoiceId: cmd.invoiceId },
        "square.payment_link.threw",
      );
      return err(externalService("square", "couldn't reach Square — try again", true));
    }
  }
}
