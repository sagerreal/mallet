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
