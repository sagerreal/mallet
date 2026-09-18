/**
 * Shared fixtures for the quote-deposit tests (checkout mint + deposit recording + the
 * accept→deposit→job→invoice chain). Extracted so the three suites exercise ONE estimate shape and
 * ONE fake writer — a second copy of the conditional-update fake would let the idempotency claim
 * pass in one suite while the other tested something subtly different.
 *
 * Not a *.test.ts file on purpose: it is imported, never run.
 */
import {
  asEstimateId,
  asEstimateLineId,
  asOrgId,
  asLeadId,
  money,
  zeroMoney,
  isOk,
  ok,
  err,
  externalService,
  type EstimateId,
  type OrgId,
  type LeadId,
  type Result,
  type ExternalServiceError,
} from "@mallet/shared/types";
import { Estimate, EstimateLine, type EstimateProps } from "../domain/estimate";
import type {
  EstimateDepositLedger,
  DepositLedgerEntry,
  DepositLedgerResult,
} from "../domain/estimate-deposit-ledger";
import type {
  DepositLinkGateway,
  CreateDepositSessionCmd,
  HostedDeposit,
} from "../domain/deposit-link-gateway";
import type { ConnectChargeTarget, ConnectTargetReader } from "../domain/connect-target-reader";

export const ORG: OrgId = asOrgId("22222222-2222-4222-8222-222222222222");
export const LEAD: LeadId = asLeadId("33333333-3333-4333-8333-333333333333");
export const EST: EstimateId = asEstimateId("11111111-1111-4111-8111-111111111111");
export const TOKEN = "a".repeat(64);

export const estimateLine = (rateCents: number, quantity = 1): EstimateLine => {
  const built = EstimateLine.create({
    id: asEstimateLineId("44444444-4444-4444-4444-444444444444"),
    description: "Labor",
    quantity,
    rate: money(rateCents),
    cost: zeroMoney,
    isOptional: false,
    needsPhoto: false,
    position: 0,
    tier: null,
    materialId: null,
  });
  if (!isOk(built)) throw new Error(built.error.message);
  return built.value;
};

/** An estimate with one $1,000 line, 30% deposit, ACCEPTED and unpaid, unless overridden. */
export const acceptedEstimate = (overrides: Partial<EstimateProps> = {}): Estimate => {
  const props: EstimateProps = {
    id: EST,
    orgId: ORG,
    num: "EST-1000",
    leadId: LEAD,
    title: "Repipe",
    status: "accepted",
    discBps: 0,
    taxBps: 0,
    depBps: 3_000, // 30%
    depPaid: zeroMoney,
    validDays: 30,
    sentAt: new Date("2026-06-01T00:00:00Z"),
    acceptedAt: new Date("2026-06-02T00:00:00Z"),
    declinedAt: null,
    declineReason: null,
    changeRequestedAt: null,
    changeOrderForJobId: null,
    jobId: null,
    changeRequest: null,
    publicToken: TOKEN,
    recommendedTier: null,
    acceptedTier: null,
    tierNames: null,
    termsSnapshot: null,
    lines: [estimateLine(100_000)],
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-02T00:00:00Z"),
    ...overrides,
  };
  const built = Estimate.create(props);
  if (!isOk(built)) throw new Error(built.error.message);
  return built.value;
};

/**
 * A FIELD-born accepted quote — the only kind `resignOnSite` will re-price, and therefore the only
 * shape in which two live checkout sessions can exist for one quote's deposit.
 */
export const fieldAcceptedEstimate = (overrides: Partial<EstimateProps> = {}): Estimate =>
  acceptedEstimate({ origin: "field", ...overrides });

/**
 * Ledger faithful to the Drizzle adapter: an append-only map keyed on payment_ref, with
 * `dep_paid_cents` DERIVED as the sum of its rows.
 *
 * The three behaviours the real thing has to have, and therefore the three this must have:
 *   - the SAME payment_ref twice appends once (the UNIQUE (org_id, payment_ref) conflict);
 *   - TWO DIFFERENT payment_refs both append, and the total ACCUMULATES;
 *   - a non-accepted / missing estimate refuses (the INSERT … SELECT precondition), which is a
 *     distinct outcome from a duplicate — one is money with nowhere to land, the other is harmless.
 *
 * `beforeAppend` simulates a concurrent delivery landing between the use-case's read and this
 * write — the race the precondition and the unique index exist to lose safely.
 */
export class FakeDepositLedger implements EstimateDepositLedger {
  public readonly rows: Array<{ paymentRef: string; amountCents: number }> = [];
  constructor(
    private readonly store: { estimate: Estimate },
    private readonly beforeAppend?: () => void,
  ) {}

  private sum(): number {
    return this.rows.reduce((total, row) => total + row.amountCents, 0);
  }

  async append(entry: DepositLedgerEntry): Promise<DepositLedgerResult> {
    this.beforeAppend?.();
    if (this.rows.some((row) => row.paymentRef === entry.paymentRef)) {
      return { kind: "duplicate", depositPaidCents: this.sum() };
    }
    const current = this.store.estimate;
    // The INSERT … SELECT precondition: only a live, accepted estimate of this org yields a row.
    if (current.props.id !== entry.estimateId || current.props.status !== "accepted") {
      return { kind: "refused" };
    }
    this.rows.push({ paymentRef: entry.paymentRef, amountCents: entry.amountCents });
    const total = this.sum();
    const next = current.withDepositPaid(total, entry.receivedAt);
    if (!isOk(next)) return { kind: "refused" };
    this.store.estimate = next.value;
    return { kind: "appended", depositPaidCents: total };
  }
}

export const connectReady = (
  target: Partial<ConnectChargeTarget> = {},
): ConnectTargetReader => ({
  read: async () => ({ connectedAccountId: "acct_live_1", chargesEnabled: true, ...target }),
});

export const collectingGateway = (
  outcome: Result<HostedDeposit, ExternalServiceError> = ok({
    url: "https://checkout.stripe.com/c/pay/cs_dep_1",
    externalRef: "cs_dep_1",
  }),
): { calls: CreateDepositSessionCmd[]; gateway: DepositLinkGateway } => {
  const calls: CreateDepositSessionCmd[] = [];
  return {
    calls,
    gateway: {
      createDepositSession: async (cmd) => {
        calls.push(cmd);
        return outcome;
      },
    },
  };
};

export const failingGateway = (): DepositLinkGateway => ({
  createDepositSession: async () =>
    err(externalService("stripe", "the payment provider is temporarily unavailable", true)),
});
