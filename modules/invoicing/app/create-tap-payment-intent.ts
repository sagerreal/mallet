import type { OrgId, InvoiceId, Result, AppError } from "@mallet/shared/types";
import { notFound, conflict, validation, ok, err, isOk, precondition } from "@mallet/shared/types";
import { platformFeeCents } from "@mallet/platform/payments/platform-fee";
import type { InvoiceRepository } from "../domain/invoice-repository";
import type { TerminalGateway } from "../domain/terminal-gateway";
import type { ConnectTargetReader } from "../domain/connect-target-reader";
import { CONNECT_NOT_READY } from "./terminal-connection-token";

// Stripe's minimum USD charge — the same floor the Checkout path guards (see create-payment.ts):
// a sub-minimum request fails deterministically at Stripe AND counts toward the shared breaker.
const STRIPE_MIN_CHARGE_CENTS = 50;

export interface CreateTapPaymentIntentCommand {
  readonly orgId: OrgId;
  readonly invoiceId: InvoiceId;
}

export interface CreatedTapIntent {
  readonly paymentIntentId: string;
  readonly clientSecret: string;
  /** What the phone will collect — the FULL balance, echoed so the device shows the real figure. */
  readonly amountCents: number;
}

/**
 * Mint the card_present PaymentIntent a phone-reader collects against — the Tap to Pay sibling
 * of CreatePaymentUseCase, holding every one of its rules: only a sent/partial invoice takes
 * money, the amount is the balance due (never a caller choice), sub-minimum balances are refused
 * before Stripe is dialed, and Connect onboarding must be finished.
 *
 * Like the Checkout path, this touches NO ledger: the intent is confirmed on the device
 * (Terminal SDK collect + confirm, PR2) with AUTOMATIC capture, and settled money is recorded by
 * reconcileTapPayment through the same idempotent RecordCardPaymentUseCase the webhook uses —
 * keyed on this intent's pi_… id, so however many delivery paths eventually observe it, the
 * money lands exactly once.
 *
 * The one deliberate divergence from CreatePaymentUseCase: the not-onboarded refusal is
 * `precondition` (→ PRECONDITION_FAILED) rather than `conflict`, per the Terminal endpoints'
 * shared contract — the older Checkout path keeps its CONFLICT to leave existing clients alone.
 */
export class CreateTapPaymentIntentUseCase {
  constructor(
    private readonly repo: InvoiceRepository,
    private readonly gateway: TerminalGateway,
    private readonly connect: ConnectTargetReader,
  ) {}

  async exec(cmd: CreateTapPaymentIntentCommand): Promise<Result<CreatedTapIntent, AppError>> {
    const invoice = await this.repo.findById(cmd.invoiceId);
    if (!invoice) return err(notFound("invoice"));
    if (invoice.props.status !== "sent" && invoice.props.status !== "partial") {
      return err(conflict(`cannot collect a payment on a ${invoice.props.status} invoice`));
    }
    const dueCents = invoice.due();
    if (dueCents <= 0) return err(validation("invoice has no balance due", "amount"));
    if (dueCents < STRIPE_MIN_CHARGE_CENTS) {
      return err(
        validation(
          `the balance due ($${(dueCents / 100).toFixed(2)}) is below the $${(STRIPE_MIN_CHARGE_CENTS / 100).toFixed(2)} card minimum`,
          "amount",
        ),
      );
    }

    const target = await this.connect.read();
    if (!target.connectedAccountId || !target.chargesEnabled) {
      return err(precondition(CONNECT_NOT_READY));
    }

    const applicationFeeCents = platformFeeCents(dueCents);
    const intent = await this.gateway.createTapPaymentIntent({
      orgId: cmd.orgId,
      invoiceId: cmd.invoiceId,
      connectedAccountId: target.connectedAccountId,
      amountCents: dueCents,
      currency: "usd",
      description: `Invoice ${invoice.props.num}`,
      applicationFeeCents,
      // Key includes the account + fee so a later config change can't collide with a prior intent
      // (same convention as the Checkout path's `pl:` key). A repeat call for the same balance
      // reuses the SAME intent — which is also Stripe's own guidance for declined-card retries.
      idempotencyKey: `tap:${cmd.orgId}:${cmd.invoiceId}:${dueCents}:${target.connectedAccountId}:${applicationFeeCents}`,
    });
    if (!isOk(intent)) return err(intent.error);
    return ok({
      paymentIntentId: intent.value.paymentIntentId,
      clientSecret: intent.value.clientSecret,
      amountCents: dueCents,
    });
  }
}
