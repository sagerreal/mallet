import type { OrgId, InvoiceId } from "@mallet/shared/types";
import { isOk } from "@mallet/shared/types";
// Deep domain import ON PURPOSE (matches tech-quote-builder's authorization-text import): the
// settings BARREL includes the API router, which pulls the config validator — and this file is
// deliberately import-light so its unit tests never touch DB/config wiring.
import {
  effectiveInvoiceFooter,
  effectivePayInstructions,
  effectiveReceiptNote,
} from "@/modules/settings/domain/document-wording";
import type { Invoice, InvoiceStatus } from "../domain/invoice";
import type { PaymentMethod } from "../domain/payment";
import type { InvoiceRepository } from "../domain/invoice-repository";
import type { PaymentLinkGateway } from "../domain/payment-link-gateway";
import type { ConnectTargetReader } from "../domain/connect-target-reader";
import { CreatePaymentUseCase } from "./create-payment";

// Pure view/checkout core for the public invoice page — deliberately import-light (domain + one
// use-case only) so unit tests never pull the DB/config wiring. The withTenant/ownerDb
// orchestration lives in public-invoice.ts, same split as quoting's public-accept-policy.ts.

export interface PublicInvoiceLine {
  readonly description: string;
  readonly quantity: number;
  readonly rateCents: number;
  /** Does this line take sales tax — marked on the document so the customer can see which
   *  line the rate was not charged on. */
  readonly taxable: boolean;
}

/**
 * One settled payment, as the customer's own copy states it.
 *
 * The aggregate `amountPaidCents` alone cannot make this page a RECEIPT — a document that says
 * "Paid −$185.00" but not when, how much, or by what means is a statement, not proof of payment.
 * The rows were always in the payments ledger; they simply were not projected.
 *
 * Deliberately NARROW: the amount, the method and the date only. `recordedByUserId` (which
 * technician took the cash), the idempotency key and the Stripe id are the shop's reconciliation
 * data and have no business on an unauthenticated page.
 */
export interface PublicInvoicePayment {
  readonly amountCents: number;
  readonly method: PaymentMethod;
  readonly receivedAt: Date;
}

/**
 * The facts a DOCUMENT OF RECORD states that the invoice row itself does not carry, resolved by
 * the orchestrator (public-invoice.ts) and handed in here.
 *
 * They live in a context object rather than as five more positional arguments because every one of
 * them is optional-in-practice — a shop that has not filled in Settings, a lead with no address, a
 * bill with no source job — and a positional list of five nullable strings is a call site nobody
 * can read. Keeping them OUT of this module's data access is the point: this file stays
 * import-light (domain + one use-case) so its unit tests never pull DB or config wiring.
 */
export interface PublicInvoiceContext {
  /** orgs.name, resolved from the token — never from the page. */
  readonly orgName: string;
  readonly chargesEnabled: boolean;
  /** The shop's address/phone/email/website/licence, from org_settings via the settings use-case. */
  readonly business: PublicInvoiceBusiness;
  /**
   * What the customer signed, when a signature exists. Null on a hand-made bill nobody approved.
   *
   * The OVERAGE half deliberately does not travel: a bill exceeding its authorisation is a warning
   * for the shop to act on BEFORE sending, not an accusation to hand the customer. This is the
   * citation only — who signed, when, which document, and for how much.
   */
  readonly authorization: PublicInvoiceAuthorization | null;
  /** leads.name for the invoice's own lead. Null only when the lead is gone. */
  readonly customerName: string | null;
  /** leads.address — null on most leads, and omitted from the document when it is. */
  readonly serviceAddress: string | null;
  /** The source job's completed visit. Null when there is no job, or no completed visit. */
  readonly serviceAt: Date | null;
  /**
   * The org's document-wording OVERRIDES for the three slots this page renders — raw and
   * nullable, from org_settings via the settings use-case. Null = the standard sentence;
   * resolution happens in toPublicInvoiceView through the settings domain's resolvers, so this
   * page and the office's copy can never disagree about the fallback.
   */
  readonly wording: PublicInvoiceWording;
}

export interface PublicInvoiceWording {
  readonly invoiceFooter: string | null;
  readonly payInstructions: string | null;
  readonly receiptNote: string | null;
}

/**
 * The shop's identity as the customer's copy states it. `name` is deliberately ABSENT: the public
 * page's branded header already prints it an inch above the document body, and a second copy there
 * would be the shop's name twice.
 */
export interface PublicInvoiceBusiness {
  readonly address: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly site: string | null;
  readonly license: string | null;
}

// The redacted shape the unauthenticated customer page renders: display lines WITHOUT cost,
// money in integer cents, plus the two flags the Pay button needs.
/** The signature a bill rests on, as the customer's own copy states it. */
export interface PublicInvoiceAuthorization {
  readonly signerName: string;
  readonly signedAt: Date;
  /** The document signed — "EST-1044", or the job's own reference. */
  readonly documentRef: string;
  readonly authorizedCents: number;
}

export interface PublicInvoiceView {
  readonly num: string;
  readonly title: string | null;
  readonly lines: readonly PublicInvoiceLine[];
  /** Settled payments, OLDEST FIRST — a receipt reads in the order the money arrived. */
  readonly payments: readonly PublicInvoicePayment[];
  readonly totalCents: number;
  readonly taxCents: number;
  /** What came off the line sum before tax. The lines print at full rates, so the document
   *  must state it or the total reads as an arithmetic error. */
  readonly discountCents: number;
  readonly depositPaidCents: number;
  readonly amountPaidCents: number;
  readonly balanceDueCents: number;
  readonly status: InvoiceStatus;
  readonly termsDays: number;
  readonly dueAt: Date | null;
  readonly poNumber: string | null;
  readonly orgName: string;
  readonly chargesEnabled: boolean;
  /**
   * WHO billed, WHO was billed, WHERE the work happened and WHEN — what separates a document of
   * record from a pay page. For a long time this page carried none of it: not the customer's own
   * name, not the shop's address or licence, not the invoice date. See PublicInvoiceContext.
   */
  readonly business: PublicInvoiceBusiness;
  /** The signature this bill rests on — see PublicInvoiceContext.authorization. */
  readonly authorization: PublicInvoiceAuthorization | null;
  readonly customerName: string | null;
  readonly serviceAddress: string | null;
  /** When the bill was raised — invoices.created_at, always present. */
  readonly invoicedAt: Date;
  /** When the work was done. NEVER a fallback for invoicedAt; null when genuinely unknown. */
  readonly serviceAt: Date | null;
  // EFFECTIVE document wording — override when the shop set one, otherwise the standard
  // sentence, resolved once here so the page renders strings and decides nothing.
  /** Note at the bottom of the document. Null = no footer, exactly what the page always did. */
  readonly footerNote: string | null;
  /** How to settle when card payment isn't available. Always a sentence. */
  readonly payInstructions: string;
  /** The settled-state line under "Paid — thank you!". Always a sentence. */
  readonly receiptNote: string;
}

export const toPublicInvoiceView = (
  invoice: Invoice,
  context: PublicInvoiceContext,
): PublicInvoiceView => {
  const p = invoice.props;
  const { orgName, chargesEnabled, business, customerName, serviceAddress, serviceAt, wording, authorization } =
    context;
  return {
    num: p.num,
    title: p.title,
    lines: [...p.lines]
      .sort((a, b) => a.props.position - b.props.position)
      .map((line) => ({
        description: line.props.description,
        quantity: line.props.quantity,
        rateCents: line.props.rate,
        taxable: line.props.taxable,
      })),
    payments: [...p.payments]
      .sort((a, b) => a.props.receivedAt.getTime() - b.props.receivedAt.getTime())
      .map((payment) => ({
        amountCents: payment.props.amount,
        method: payment.props.method,
        receivedAt: payment.props.receivedAt,
      })),
    totalCents: p.total,
    taxCents: p.tax,
    discountCents: p.discount,
    depositPaidCents: p.depositPaid,
    amountPaidCents: p.amountPaid,
    // The domain's due() — total − deposit − paid, clamped ≥ 0 — never recomputed by a page.
    balanceDueCents: invoice.due(),
    status: p.status,
    termsDays: p.termsDays,
    dueAt: p.dueAt,
    poNumber: p.poNumber,
    orgName,
    chargesEnabled,
    business,
    authorization,
    customerName,
    serviceAddress,
    // The bill's own creation stamp. Always present — an invoice cannot exist without one.
    invoicedAt: p.createdAt,
    serviceAt,
    footerNote: effectiveInvoiceFooter(wording.invoiceFooter),
    payInstructions: effectivePayInstructions(wording.payInstructions, orgName),
    receiptNote: effectiveReceiptNote(wording.receiptNote),
  };
};

// ── checkout ─────────────────────────────────────────────────────────────────

export interface PublicCheckoutDeps {
  readonly repo: InvoiceRepository;
  readonly gateway: PaymentLinkGateway;
  readonly connect: ConnectTargetReader;
}

/**
 * Outcome of a public checkout attempt, pre-mapped to what an UNAUTHENTICATED caller may learn.
 * `rejected` carries customer-appropriate copy — the use-case's own messages name office concepts
 * ("finish onboarding in Settings → Payments") that mean nothing to the person holding the link.
 */
export type PublicCheckoutOutcome =
  | { kind: "ok"; url: string }
  | { kind: "not_found" }
  | { kind: "rejected"; message: string }
  | { kind: "unavailable" };

const CUSTOMER_REJECTION = "Online payment isn't available for this invoice — contact the business to pay.";

// Reuse CreatePaymentUseCase so every guard (status sent|partial, balance ≥ 50¢ Stripe minimum,
// Connect charges enabled) rides along — no parallel checkout path to drift.
export async function createCheckoutWithDeps(
  orgId: OrgId,
  invoiceId: InvoiceId,
  deps: PublicCheckoutDeps,
): Promise<PublicCheckoutOutcome> {
  const useCase = new CreatePaymentUseCase(deps.repo, deps.gateway, deps.connect);
  const result = await useCase.exec({ orgId, invoiceId });
  if (isOk(result)) return { kind: "ok", url: result.value.url };
  switch (result.error.kind) {
    case "not_found":
      return { kind: "not_found" };
    case "external_service":
      return { kind: "unavailable" };
    default:
      // validation (no/sub-minimum balance) or conflict (wrong status, Connect not ready).
      return { kind: "rejected", message: CUSTOMER_REJECTION };
  }
}
