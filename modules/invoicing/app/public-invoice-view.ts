import type { OrgId, InvoiceId } from "@mallet/shared/types";
import { isOk } from "@mallet/shared/types";
import type { Invoice, InvoiceStatus } from "../domain/invoice";
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
}

// The redacted shape the unauthenticated customer page renders: display lines WITHOUT cost,
// money in integer cents, plus the two flags the Pay button needs.
export interface PublicInvoiceView {
  readonly num: string;
  readonly title: string | null;
  readonly lines: readonly PublicInvoiceLine[];
  readonly totalCents: number;
  readonly taxCents: number;
  readonly depositPaidCents: number;
  readonly amountPaidCents: number;
  readonly balanceDueCents: number;
  readonly status: InvoiceStatus;
  readonly termsDays: number;
  readonly dueAt: Date | null;
  readonly poNumber: string | null;
  readonly orgName: string;
  readonly chargesEnabled: boolean;
}

export const toPublicInvoiceView = (
  invoice: Invoice,
  orgName: string,
  chargesEnabled: boolean,
): PublicInvoiceView => {
  const p = invoice.props;
  return {
    num: p.num,
    title: p.title,
    lines: [...p.lines]
      .sort((a, b) => a.props.position - b.props.position)
      .map((line) => ({
        description: line.props.description,
        quantity: line.props.quantity,
        rateCents: line.props.rate,
      })),
    totalCents: p.total,
    taxCents: p.tax,
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
