import { describe, it, expect } from "vitest";
import {
  asEstimateId,
  asEstimateLineId,
  asOrgId,
  asLeadId,
  money,
  zeroMoney,
  isOk,
} from "@mallet/shared/types";
import { Estimate, EstimateLine, type EstimateProps, type EstimateLineProps } from "./estimate";

let lineSeq = 0;
const line = (overrides: Partial<EstimateLineProps> = {}): EstimateLine => {
  lineSeq += 1;
  const props: EstimateLineProps = {
    id: asEstimateLineId(`00000000-0000-0000-0000-00000000000${lineSeq % 10}`),
    description: "Labor",
    quantity: 1,
    rate: money(10_000),
    cost: zeroMoney,
    isOptional: false,
    needsPhoto: false,
    position: lineSeq,
    tier: null,
    ...overrides,
  };
  const result = EstimateLine.create(props);
  if (!isOk(result)) throw new Error(result.error.message);
  return result.value;
};

const estimate = (overrides: Partial<EstimateProps> = {}): Estimate => {
  const props: EstimateProps = {
    id: asEstimateId("11111111-1111-1111-1111-111111111111"),
    orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
    num: "EST-1000",
    leadId: asLeadId("33333333-3333-3333-3333-333333333333"),
    title: "Kitchen remodel",
    status: "draft",
    discBps: 0,
    taxBps: 0,
    depBps: 0,
    depPaid: zeroMoney,
    validDays: 30,
    sentAt: null,
    acceptedAt: null,
    declinedAt: null,
    declineReason: null,
    changeRequestedAt: null,
    changeRequest: null,
    publicToken: null,
    recommendedTier: null,
    acceptedTier: null,
    tierNames: null,
    termsSnapshot: null,
    lines: [line()],
    createdAt: new Date("2026-06-01T00:00:00Z"),
    updatedAt: new Date("2026-06-01T00:00:00Z"),
    ...overrides,
  };
  const result = Estimate.create(props);
  if (!isOk(result)) throw new Error(result.error.message);
  return result.value;
};

describe("EstimateLine", () => {
  it("rejects a blank description and negatives", () => {
    expect(EstimateLine.create({ ...line().props, description: " " }).ok).toBe(false);
    expect(EstimateLine.create({ ...line().props, quantity: -1 }).ok).toBe(false);
    expect(EstimateLine.create({ ...line().props, rate: money(-1) }).ok).toBe(false);
  });

  it("rounds the extended amount to whole cents", () => {
    // 2.5 units * 333c = 832.5 -> 833c
    expect(line({ quantity: 2.5, rate: money(333) }).amount()).toBe(833);
  });

  it("accepts up to 2 decimal places but rejects finer precision (no persistence drift)", () => {
    expect(EstimateLine.create({ ...line().props, quantity: 2.55 }).ok).toBe(true);
    expect(EstimateLine.create({ ...line().props, quantity: 0.01 }).ok).toBe(true);
    expect(EstimateLine.create({ ...line().props, quantity: 2.555 }).ok).toBe(false);
  });
});

describe("Estimate.create", () => {
  it("rejects a blank number and out-of-range bps", () => {
    expect(Estimate.create({ ...estimate().props, num: "  " }).ok).toBe(false);
    expect(Estimate.create({ ...estimate().props, discBps: 10_001 }).ok).toBe(false);
    expect(Estimate.create({ ...estimate().props, taxBps: -1 }).ok).toBe(false);
  });
});

describe("Estimate money derivations", () => {
  it("derives subtotal from non-optional lines only", () => {
    const est = estimate({
      lines: [line({ quantity: 1, rate: money(100_000) }), line({ rate: money(50_000), isOptional: true })],
    });
    expect(est.subtotal()).toBe(100_000);
  });

  it("computes discount, then tax on the net, then total and deposit in integer cents", () => {
    const est = estimate({
      lines: [line({ quantity: 1, rate: money(100_000) })],
      discBps: 1_000, // 10%
      taxBps: 825, // 8.25%
      depBps: 2_000, // 20%
    });
    expect(est.subtotal()).toBe(100_000);
    expect(est.discountAmount()).toBe(10_000);
    expect(est.netAfterDiscount()).toBe(90_000);
    expect(est.taxAmount()).toBe(7_425); // round(90000 * 825 / 10000)
    expect(est.total()).toBe(97_425);
    expect(est.depositDue()).toBe(19_485); // round(97425 * 2000 / 10000)
  });
});

describe("Estimate lifecycle", () => {
  const now = new Date("2026-06-10T00:00:00Z");

  it("sends a draft with a positive subtotal and is idempotent", () => {
    const sent = estimate().send(now);
    expect(isOk(sent) && sent.value.props.status).toBe("sent");
    if (isOk(sent)) {
      expect(sent.value.props.sentAt?.toISOString()).toBe(now.toISOString());
      const again = sent.value.send(new Date("2026-06-11T00:00:00Z"));
      expect(isOk(again) && again.value).toBe(sent.value); // no-op
    }
  });

  it("cannot send a zero-subtotal draft", () => {
    const empty = estimate({ lines: [line({ rate: zeroMoney })] });
    expect(empty.send(now).ok).toBe(false);
  });

  it("accepts only from sent and stamps the derived deposit", () => {
    const draft = estimate({ depBps: 2_000, lines: [line({ rate: money(100_000) })] });
    expect(draft.accept(now).ok).toBe(false); // draft -> accept rejected
    const sent = draft.send(now);
    if (!isOk(sent)) throw new Error("send failed");
    const accepted = sent.value.accept(now);
    expect(isOk(accepted) && accepted.value.props.status).toBe("accepted");
    if (isOk(accepted)) expect(accepted.value.props.depPaid).toBe(20_000);
  });

  it("declines only from sent and is terminal after accept", () => {
    const sent = estimate().send(now);
    if (!isOk(sent)) throw new Error("send failed");
    const declined = sent.value.decline("too expensive", now);
    expect(isOk(declined) && declined.value.props.status).toBe("declined");
    if (isOk(declined)) expect(declined.value.props.declineReason).toBe("too expensive");

    const accepted = sent.value.accept(now);
    if (!isOk(accepted)) throw new Error("accept failed");
    expect(accepted.value.decline("changed mind", now).ok).toBe(false); // terminal
  });

  it("only allows line edits on a draft", () => {
    const sent = estimate().send(now);
    if (!isOk(sent)) throw new Error("send failed");
    expect(sent.value.withLines([line()], now).ok).toBe(false);
  });
});

describe("Estimate.requestChange", () => {
  const now = new Date("2026-07-11T10:00:00Z");

  it("rejects a change request on a draft (not sent)", () => {
    const draft = estimate();
    const r = draft.requestChange("Please add gutters", now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
  });

  it("rejects a change request on an accepted estimate", () => {
    const sent = estimate().send(now);
    if (!isOk(sent)) throw new Error("send failed");
    const accepted = sent.value.accept(now);
    if (!isOk(accepted)) throw new Error("accept failed");
    const r = accepted.value.requestChange("add gutters", now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
  });

  it("rejects an empty message (whitespace only)", () => {
    const sent = estimate().send(now);
    if (!isOk(sent)) throw new Error("send failed");
    const r = sent.value.requestChange("   ", now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("message");
  });

  it("rejects a message over 2000 characters", () => {
    const sent = estimate().send(now);
    if (!isOk(sent)) throw new Error("send failed");
    const r = sent.value.requestChange("x".repeat(2001), now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("validation");
  });

  it("happy path: sets changeRequestedAt and trimmed changeRequest, returns new immutable instance", () => {
    const sent = estimate().send(now);
    if (!isOk(sent)) throw new Error("send failed");
    const r = sent.value.requestChange("  Please add a discount  ", now);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.changeRequestedAt).toEqual(now);
    expect(r.value.props.changeRequest).toBe("Please add a discount");
    expect(r.value.props.status).toBe("sent"); // status unchanged
    // Immutability: sent instance is untouched
    expect(sent.value.props.changeRequestedAt).toBeNull();
  });

  it("re-request overwrites the previous message (latest wins)", () => {
    const sent = estimate().send(now);
    if (!isOk(sent)) throw new Error("send failed");
    const r1 = sent.value.requestChange("first request", now);
    if (!isOk(r1)) throw new Error("first requestChange failed");
    const later = new Date("2026-07-11T11:00:00Z");
    const r2 = r1.value.requestChange("updated request", later);
    expect(isOk(r2)).toBe(true);
    if (!isOk(r2)) return;
    expect(r2.value.props.changeRequest).toBe("updated request");
    expect(r2.value.props.changeRequestedAt).toEqual(later);
  });
});

describe("Estimate.clearChangeRequest", () => {
  const now = new Date("2026-07-11T10:00:00Z");
  const later = new Date("2026-07-11T11:00:00Z");

  it("returns validation error when no change request is present", () => {
    const sent = estimate().send(now);
    if (!isOk(sent)) throw new Error("send failed");
    const r = sent.value.clearChangeRequest(later);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("validation");
      expect(r.error.field).toBe("changeRequest");
    }
  });

  it("clears changeRequestedAt and changeRequest, returns new immutable instance", () => {
    const sent = estimate().send(now);
    if (!isOk(sent)) throw new Error("send failed");
    const withChange = sent.value.requestChange("Please adjust price", now);
    if (!isOk(withChange)) throw new Error("requestChange failed");

    const cleared = withChange.value.clearChangeRequest(later);
    expect(cleared.ok).toBe(true);
    if (!isOk(cleared)) return;
    expect(cleared.value.props.changeRequestedAt).toBeNull();
    expect(cleared.value.props.changeRequest).toBeNull();
    expect(cleared.value.props.updatedAt).toEqual(later);
    expect(cleared.value.props.status).toBe("sent"); // status unchanged

    // Immutability: withChange instance is untouched
    expect(withChange.value.props.changeRequestedAt).toEqual(now);
    expect(withChange.value.props.changeRequest).toBe("Please adjust price");
  });

  it("canClearChangeRequest returns true only when a change request is present", () => {
    const sent = estimate().send(now);
    if (!isOk(sent)) throw new Error("send failed");
    expect(sent.value.canClearChangeRequest()).toBe(false);
    const withChange = sent.value.requestChange("change me", now);
    if (!isOk(withChange)) throw new Error("requestChange failed");
    expect(withChange.value.canClearChangeRequest()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Good/Better/Best tiers
// ---------------------------------------------------------------------------

// A GBB fixture: one line per tier + an optional add-on in "better". Odd pricing so
// every rounding step is exercised through the shared chain.
const gbbEstimate = (overrides: Partial<EstimateProps> = {}): Estimate =>
  estimate({
    recommendedTier: "better",
    discBps: 1_000, // 10%
    taxBps: 825, // 8.25%
    depBps: 2_000, // 20%
    lines: [
      line({ tier: "good", rate: money(100_000) }),
      line({ tier: "better", rate: money(90_000) }),
      line({ tier: "better", rate: money(5_000), isOptional: true }),
      line({ tier: "best", rate: money(150_000) }),
    ],
    ...overrides,
  });

describe("EstimateLine tier", () => {
  it("accepts each tier value and null", () => {
    expect(EstimateLine.create({ ...line().props, tier: "good" }).ok).toBe(true);
    expect(EstimateLine.create({ ...line().props, tier: "better" }).ok).toBe(true);
    expect(EstimateLine.create({ ...line().props, tier: "best" }).ok).toBe(true);
    expect(EstimateLine.create({ ...line().props, tier: null }).ok).toBe(true);
  });

  it("rejects an unknown tier value (mapper corruption fails loud)", () => {
    expect(EstimateLine.create({ ...line().props, tier: "premium" as never }).ok).toBe(false);
  });
});

describe("Estimate tier invariants", () => {
  it("a tiered estimate (recommendedTier set) requires EVERY line to carry a tier", () => {
    const r = Estimate.create({
      ...estimate().props,
      recommendedTier: "good",
      lines: [line({ tier: "good" }), line({ tier: null })],
    });
    expect(r.ok).toBe(false);
  });

  it("a tiered estimate may leave a tier empty while drafting", () => {
    const r = Estimate.create({
      ...estimate().props,
      recommendedTier: "better",
      lines: [line({ tier: "better" })], // good + best empty — fine
    });
    expect(r.ok).toBe(true);
  });

  it("a TWO-tier GBB payload passes consistency validation and survives send → accept", () => {
    // The composer drops empty tiers from the payload — nothing requires all
    // three tiers to be non-empty. recommendedTier set + every line tagged is
    // a valid tiered estimate with only good + better populated.
    const now = new Date("2026-06-10T00:00:00Z");
    const twoTier = estimate({
      recommendedTier: "good",
      lines: [
        line({ tier: "good", rate: money(50_000) }),
        line({ tier: "better", rate: money(80_000) }),
      ],
    });
    const sent = twoTier.send(now);
    expect(isOk(sent)).toBe(true);
    if (!isOk(sent)) return;
    const accepted = sent.value.accept(now, "better");
    expect(isOk(accepted)).toBe(true);
    if (!isOk(accepted)) return;
    expect(accepted.value.props.acceptedTier).toBe("better");
    expect(accepted.value.subtotal()).toBe(80_000);
  });

  it("a single-format estimate rejects tiered lines", () => {
    const r = Estimate.create({
      ...estimate().props,
      recommendedTier: null,
      lines: [line({ tier: "good" })],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown recommendedTier value", () => {
    const r = Estimate.create({
      ...estimate().props,
      recommendedTier: "premium" as never,
      lines: [line({ tier: "good" })],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects acceptedTier without recommendedTier", () => {
    const r = Estimate.create({ ...estimate().props, acceptedTier: "good" });
    expect(r.ok).toBe(false);
  });

  it("a resolved estimate (acceptedTier set) rejects lines that still carry tier tags", () => {
    const r = Estimate.create({
      ...estimate().props,
      recommendedTier: "better",
      acceptedTier: "better",
      lines: [line({ tier: "better" })],
    });
    expect(r.ok).toBe(false);
  });

  it("a resolved estimate with untiered lines is valid", () => {
    const r = Estimate.create({
      ...estimate().props,
      status: "accepted",
      acceptedAt: new Date("2026-07-01T00:00:00Z"),
      recommendedTier: "better",
      acceptedTier: "best",
      lines: [line({ tier: null })],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects tierNames without recommendedTier and blank tier names", () => {
    const names = { good: "Basic", better: "Standard", best: "Premium" };
    expect(Estimate.create({ ...estimate().props, tierNames: names }).ok).toBe(false);
    const gbb = gbbEstimate();
    expect(Estimate.create({ ...gbb.props, tierNames: names }).ok).toBe(true);
    expect(Estimate.create({ ...gbb.props, tierNames: { ...names, better: "  " } }).ok).toBe(false);
  });
});

describe("Estimate tiered money", () => {
  it("pre-accept totals derive from the RECOMMENDED tier's non-optional lines only", () => {
    const est = gbbEstimate();
    // better tier: 90_000 fixed (5_000 optional excluded)
    expect(est.subtotal()).toBe(90_000);
    expect(est.discountAmount()).toBe(9_000);
    expect(est.netAfterDiscount()).toBe(81_000);
    expect(est.taxAmount()).toBe(6_683); // round(81000 * 825 / 10000) = round(6682.5)
    expect(est.total()).toBe(87_683);
    expect(est.depositDue()).toBe(17_537); // round(87683 * 2000 / 10000)
  });

  it("totalsForTier runs each tier through the SAME rounding chain", () => {
    const est = gbbEstimate();
    const good = est.totalsForTier("good");
    expect(good.subtotal).toBe(100_000);
    expect(good.discount).toBe(10_000);
    expect(good.tax).toBe(7_425); // round(90000 * 825 / 10000)
    expect(good.total).toBe(97_425);
    expect(good.depositDue).toBe(19_485);
    // The recommended tier's totalsForTier matches the estimate-level derivations.
    const better = est.totalsForTier("better");
    expect(better.total).toBe(est.total());
    expect(better.depositDue).toBe(est.depositDue());
  });

  it("linesForTier returns only that tier's lines", () => {
    const est = gbbEstimate();
    expect(est.linesForTier("better")).toHaveLength(2);
    expect(est.linesForTier("best")).toHaveLength(1);
    expect(est.linesForTier("good")).toHaveLength(1);
  });

  it("single-format money is unchanged when tier fields are null", () => {
    const est = estimate({ lines: [line({ rate: money(100_000) })] });
    expect(est.subtotal()).toBe(100_000);
    expect(est.total()).toBe(100_000);
  });
});

describe("Estimate tiered send", () => {
  const now = new Date("2026-06-10T00:00:00Z");

  it("cannot send a tiered draft whose recommended tier has no lines", () => {
    const est = estimate({
      recommendedTier: "best",
      lines: [line({ tier: "good", rate: money(50_000) })], // best tier empty
    });
    expect(est.canSend()).toBe(false);
    expect(est.send(now).ok).toBe(false);
  });

  it("sends a tiered draft whose recommended tier has a positive subtotal", () => {
    const sent = gbbEstimate().send(now);
    expect(isOk(sent) && sent.value.props.status).toBe("sent");
  });
});

describe("Estimate tiered accept", () => {
  const now = new Date("2026-06-10T00:00:00Z");

  const sentGbb = (): Estimate => {
    const sent = gbbEstimate().send(now);
    if (!isOk(sent)) throw new Error("send failed");
    return sent.value;
  };

  it("a tiered estimate requires a chosenTier to accept", () => {
    const r = sentGbb().accept(now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("chosenTier");
  });

  it("a single-format estimate rejects a chosenTier", () => {
    const sent = estimate().send(now);
    if (!isOk(sent)) throw new Error("send failed");
    const r = sent.value.accept(now, "good");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("chosenTier");
  });

  it("accept resolves to the chosen tier: other tiers' lines drop, tags clear, acceptedTier stamps", () => {
    const r = sentGbb().accept(now, "best");
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    const accepted = r.value;
    expect(accepted.props.status).toBe("accepted");
    expect(accepted.props.acceptedTier).toBe("best");
    expect(accepted.props.recommendedTier).toBe("better"); // kept for display
    expect(accepted.props.lines).toHaveLength(1);
    expect(accepted.props.lines.every((l) => l.props.tier === null)).toBe(true);
    // Post-accept money derives from the resolved (chosen-tier) lines:
    // 150_000 → disc 15_000 → net 135_000 → tax round(11137.5)=11_138 → total 146_138.
    expect(accepted.subtotal()).toBe(150_000);
    expect(accepted.total()).toBe(146_138);
    // depPaid stamped from the CHOSEN tier's chain, not the recommended tier's.
    expect(accepted.props.depPaid).toBe(29_228); // round(146138 * 2000 / 10000)
  });

  it("accept keeps already-resolved (untiered) lines committed by the accept use-case", () => {
    // Mirrors the public path: the use-case replaces lines with a tier-cleared committed
    // set BEFORE calling accept — accept must keep them all.
    const committed = [line({ tier: null, rate: money(90_000) }), line({ tier: null, rate: money(5_000) })];
    const replaced = sentGbb().withLinesForAccept(committed, now);
    const r = replaced.accept(now, "better");
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.lines).toHaveLength(2);
    expect(r.value.subtotal()).toBe(95_000);
    expect(r.value.props.acceptedTier).toBe("better");
  });

  it("single-format accept still stamps the deposit from the unchanged line set", () => {
    const sent = estimate({ depBps: 2_000, lines: [line({ rate: money(100_000) })] }).send(now);
    if (!isOk(sent)) throw new Error("send failed");
    const r = sent.value.accept(now);
    expect(isOk(r)).toBe(true);
    if (!isOk(r)) return;
    expect(r.value.props.depPaid).toBe(20_000);
    expect(r.value.props.acceptedTier).toBeNull();
  });
});
