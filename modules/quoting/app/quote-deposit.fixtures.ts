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
import type { EstimateDepositWriter } from "../domain/estimate-deposit-writer";
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
 * Deposit writer faithful to the Drizzle conditional UPDATE: it writes ONLY while the stored
 * dep_paid_cents is strictly less than the incoming amount and the row is still `accepted`, and it
 * reports the rowcount as a boolean. `beforeWrite` simulates a concurrent delivery landing between
 * the use-case's read and its write — the exact race the WHERE guard exists to lose safely.
 */
export class FakeDepositWriter implements EstimateDepositWriter {
  public writes = 0;
  constructor(
    private readonly store: { estimate: Estimate },
    private readonly beforeWrite?: () => void,
  ) {}

  async recordDepositPaid(estimateId: EstimateId, amountCents: number, now: Date): Promise<boolean> {
    this.beforeWrite?.();
    const current = this.store.estimate;
    if (current.props.id !== estimateId) return false;
    if (current.props.status !== "accepted") return false;
    if (current.props.depPaid >= amountCents) return false; // WHERE dep_paid_cents < $amount
    const next = current.withDepositPaid(amountCents, now);
    if (!isOk(next)) return false;
    this.store.estimate = next.value;
    this.writes += 1;
    return true;
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
