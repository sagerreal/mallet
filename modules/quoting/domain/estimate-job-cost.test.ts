/**
 * What the job costs beyond the quote's lines.
 *
 * The rule that matters most is the one about what these DON'T do: they move the margin the
 * office reads and nothing the customer is shown. A job cost that reached a subtotal would
 * charge a customer for the shop's dumpster.
 */
import { describe, it, expect } from "vitest";
import {
  EstimateJobCost,
  jobCostTotalCents,
  pulledOrderIds,
  MAX_JOB_COST_DESCRIPTION_CHARS,
} from "./estimate-job-cost";
import { Estimate, EstimateLine, type EstimateProps } from "./estimate";
import {
  asOrgId,
  asLeadId,
  asEstimateId,
  asEstimateLineId,
  money,
  zeroMoney,
} from "@mallet/shared/types";

const built = (over: Partial<Parameters<typeof EstimateJobCost.create>[0]> = {}) => {
  const r = EstimateJobCost.create({
    id: "c-1",
    description: "Dumpster, 20 yard",
    amountCents: 40_000,
    purchaseOrderId: null,
    position: 0,
    ...over,
  });
  if (!r.ok) throw new Error(`expected a job cost, got ${r.error.message}`);
  return r.value;
};

const failure = (over: Partial<Parameters<typeof EstimateJobCost.create>[0]>) => {
  const r = EstimateJobCost.create({
    id: "c-1",
    description: "Dumpster",
    amountCents: 40_000,
    purchaseOrderId: null,
    position: 0,
    ...over,
  });
  if (r.ok) throw new Error("expected a validation error");
  return r.error;
};

describe("EstimateJobCost", () => {
  it("keeps a typed cost and a pulled one apart by what it came from", () => {
    expect(built().props.purchaseOrderId).toBeNull();
    expect(built({ purchaseOrderId: "po-1" }).props.purchaseOrderId).toBe("po-1");
  });

  it("refuses a cost with nothing written on it", () => {
    expect(failure({ description: "   " }).field).toBe("description");
  });

  it("refuses a negative amount — a cost is money out, never money in", () => {
    expect(failure({ amountCents: -1 }).field).toBe("amountCents");
  });

  it("refuses fractional cents and a description longer than the column", () => {
    expect(failure({ amountCents: 12.5 }).field).toBe("amountCents");
    expect(failure({ description: "x".repeat(MAX_JOB_COST_DESCRIPTION_CHARS + 1) }).field).toBe("description");
  });
});

describe("jobCostTotalCents", () => {
  it("adds them up in cents", () => {
    expect(jobCostTotalCents([built(), built({ id: "c-2", amountCents: 21_050 })])).toBe(61_050);
  });

  it("is zero for a quote with none", () => {
    expect(jobCostTotalCents([])).toBe(0);
  });
});

describe("pulledOrderIds", () => {
  it("names the orders already on the quote, so the picker cannot offer one twice", () => {
    // A doubled $2,140 order is a margin that reads right and is not.
    const ids = pulledOrderIds([built({ purchaseOrderId: "po-1" }), built({ id: "c-2" })]);
    expect([...ids]).toEqual(["po-1"]);
  });
});

describe("Estimate — job costs never touch the customer's numbers", () => {
  const line = () => {
    const r = EstimateLine.create({
      id: asEstimateLineId("11111111-1111-4111-8111-111111111111"),
      description: "Interior repaint",
      quantity: 1,
      rate: money(449_500),
      cost: zeroMoney,
      isOptional: false,
      needsPhoto: false,
      position: 0,
      tier: null,
      materialId: null,
    });
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };

  const estimate = (over: Partial<EstimateProps> = {}) => {
    const now = new Date("2026-08-30T00:00:00Z");
    const r = Estimate.create({
      id: asEstimateId("00000000-0000-0000-0000-00000000e572"),
      orgId: asOrgId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
      num: "EST-7002",
      leadId: asLeadId("11111111-1111-1111-1111-111111111111"),
      title: null,
      status: "draft",
      discBps: 0,
      taxBps: 1000,
      depBps: 0,
      depPaid: zeroMoney,
      validDays: null,
      sentAt: null,
      acceptedAt: null,
      declinedAt: null,
      declineReason: null,
      changeRequestedAt: null,
      changeOrderForJobId: null,
      jobId: null,
      changeRequest: null,
      publicToken: null,
      recommendedTier: null,
      acceptedTier: null,
      tierNames: null,
      termsSnapshot: null,
      lines: [line()],
      createdAt: now,
      updatedAt: now,
      ...over,
    });
    if (!r.ok) throw new Error(r.error.message);
    return r.value;
  };

  it("leaves the subtotal, tax and total exactly where they were", () => {
    const without = estimate();
    const with$ = estimate({ jobCosts: [built({ amountCents: 40_000 })] });
    expect(with$.subtotal()).toBe(without.subtotal());
    expect(with$.taxableBase()).toBe(without.taxableBase());
    expect(with$.taxAmount()).toBe(without.taxAmount());
    expect(with$.total()).toBe(without.total());
    expect(with$.depositDue()).toBe(without.depositDue());
  });

  it("reports what the job costs as its own number", () => {
    expect(estimate({ jobCosts: [built(), built({ id: "c-2", amountCents: 21_050 })] }).jobCostTotal()).toBe(61_050);
    expect(estimate().jobCostTotal()).toBe(0);
  });

  it("reads them in the order the estimator entered them", () => {
    const out = estimate({
      jobCosts: [built({ id: "c-2", description: "Permit", position: 1 }), built({ description: "Dumpster", position: 0 })],
    });
    expect(out.jobCosts.map((c) => c.props.description)).toEqual(["Dumpster", "Permit"]);
  });
});
