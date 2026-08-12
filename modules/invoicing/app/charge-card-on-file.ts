import type { OrgId, InvoiceId, UserId, Result, AppError } from "@mallet/shared/types";
import { notFound, conflict, validation, precondition, ok, err, isOk } from "@mallet/shared/types";
import { platformFeeCents } from "@mallet/platform/payments/platform-fee";
import type { Invoice } from "../domain/invoice";
import type { InvoiceRepository } from "../domain/invoice-repository";
import type { CardChargeGateway } from "../domain/card-charge-gateway";
import type { ConnectTargetReader } from "../domain/connect-target-reader";
import type { PaymentProfileStore } from "../domain/payment-profile-store";
import type { RecordCardPaymentUseCase } from "./record-card-payment";

// Stripe's minimum USD charge — the same floor the Checkout and Tap paths guard: a sub-minimum
// request fails deterministically at Stripe AND counts toward the shared breaker.
const STRIPE_MIN_CHARGE_CENTS = 50;

const CONNECT_NOT_READY =
  "this shop hasn't finished Stripe payment setup — complete onboarding in Settings → Payments to accept cards";

const NO_CARD_ON_FILE =
  "This customer has no card on file — collect with the QR code or record the payment instead.";

export interface ChargeCardOnFileCommand {
  readonly orgId: OrgId;
  readonly invoiceId: InvoiceId;
  /** Already namespaced by the router (invoice + acting user + client attempt key). */
  readonly idempotencyKey: string;
  /** The human who tapped Charge — stamped on the ledger row (anti-pocketing attribution). */
  readonly chargedByUserId: UserId;
}

export interface ChargedOnFile {
  readonly invoice: Invoice;
  /** What Stripe settled, echoed for the surface that needs to say a number out loud. */
  readonly chargedCents: number;
}

/**
 * Charge the customer's card on file for an invoice's FULL balance — the real "paid before they
 * left" play, and the sibling of CreatePaymentUseCase / CreateTapPaymentIntentUseCase holding
 * every one of their rules: only a sent/partial invoice takes money, the amount is the balance
 * due (never a caller choice), sub-minimum balances are refused before Stripe is dialed, and
 * Connect onboarding must be finished.
 *
 * THE ONE THING THIS MUST NEVER BE: a ledger row without money. The old close-out button
 * "charged" a card by recording a manual payment — the record-without-money hazard this class
 * exists to kill. Here the ledger writes ONLY after the gateway confirms Stripe settled, through
 * the SAME idempotent RecordCardPaymentUseCase the webhook uses, keyed on the pi_… id — so if a
 * webhook for this intent ever arrives, the two deliveries dedupe to one row.
 *
 * ORDER OF OPERATIONS, and the crash window it leaves. Charge first, record second: if the
 * process dies between the two, money moved with no ledger row. The client's retry (same
 * namespaced key) replays the SAME succeeded intent out of Stripe's idempotency cache and the
 * recorder picks it up — the path self-heals on the identity, exactly like the webhook/reconcile
 * pair. Recording first would invert the failure into a ledger row for money that never moved,
 * which is the worse lie.
 *
 * A DECLINE PASSES THROUGH VERBATIM (`conflict`, Stripe's own user-facing sentence): the person
 * at the door reads it to the customer and picks another method. It is not an outage and must
 * never be dressed as one.
 */
export class ChargeCardOnFileUseCase {
  constructor(
    private readonly repo: InvoiceRepository,
    private readonly profiles: PaymentProfileStore,
    private readonly gateway: CardChargeGateway,
    private readonly connect: ConnectTargetReader,
    private readonly recorder: RecordCardPaymentUseCase,
  ) {}

  async exec(cmd: ChargeCardOnFileCommand): Promise<Result<ChargedOnFile, AppError>> {
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

    // The card is the CUSTOMER's, so it hangs off the invoice's lead — the same row the close-out
    // names. Absent means the button raced a change (or a stale device): a precondition that
    // names the next step, never a crash.
    const profile = await this.profiles.findByLead(invoice.props.leadId);
    if (!profile) return err(precondition(NO_CARD_ON_FILE));

    const applicationFeeCents = platformFeeCents(dueCents);
    const charged = await this.gateway.chargeSavedCard({
      orgId: cmd.orgId,
      invoiceId: cmd.invoiceId,
      amountCents: dueCents,
      currency: "usd",
      description: `Invoice ${invoice.props.num}`,
      customerId: profile.props.stripeCustomerId,
      paymentMethodId: profile.props.stripePaymentMethodId,
      connectedAccountId: target.connectedAccountId,
      applicationFeeCents,
      idempotencyKey: cmd.idempotencyKey,
    });
    if (!isOk(charged)) return err(charged.error);

    // Record what Stripe SETTLED, keyed on the intent — the webhook's own identity and figure.
    const recorded = await this.recorder.exec({
      orgId: cmd.orgId,
      invoiceId: cmd.invoiceId,
      amountCents: charged.value.amountReceivedCents,
      paymentIntentId: charged.value.paymentIntentId,
      recordedByUserId: cmd.chargedByUserId,
    });
    if (!isOk(recorded)) return err(recorded.error);
    if (!recorded.value) return err(notFound("invoice"));
    return ok({ invoice: recorded.value, chargedCents: charged.value.amountReceivedCents });
  }
}
