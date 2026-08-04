import { describe, it, expect } from "vitest";
import { OrgSettings, normalizeBookingService } from "./org-settings";
import { baseSettingsProps } from "./org-settings.fixtures";

/**
 * The legacy "repair" lane, normalised at the domain boundary.
 *
 * The front desk's three lanes collapsed to two — flat and estimate — because the repair lane
 * ("service call") was an estimate booking with the visit fee attached. But production blobs
 * still HOLD 'repair' rows (E2E Plumbing's live booking has three), and stale clients still send
 * them. OrgSettings.create is the one choke point every read and write passes through, so the
 * mapping lives there: nothing downstream ever sees a 'repair'.
 *
 * Screenshot-verified against the live E2E Plumbing org before this test was written: its three
 * stored repair rows render "Estimate · fee", its estimate rows "Estimate · free".
 */

describe("normalizeBookingService", () => {
  it("maps the legacy repair lane to an estimate WITH the fee", () => {
    const out = normalizeBookingService({ name: "AC / heating repair", lane: "repair", triggers: "no heat" });
    expect(out.lane).toBe("estimate");
    expect(out.feeApplies).toBe(true);
  });

  it("leaves a modern estimate untouched — free stays free", () => {
    const out = normalizeBookingService({ name: "Repipe", lane: "estimate", triggers: "repipe" });
    expect(out.lane).toBe("estimate");
    expect(out.feeApplies).toBeUndefined();
  });

  it("leaves flat untouched", () => {
    const out = normalizeBookingService({ name: "Drain cleaning", lane: "flat", triggers: "clog" });
    expect(out.lane).toBe("flat");
  });
});

describe("OrgSettings.create normalises the stored blob", () => {
  it("converts every legacy repair row on the way in — the E2E Plumbing shape", () => {
    const r = OrgSettings.create(
      baseSettingsProps({
        booking: {
          services: [
            { name: "Water heater repair", lane: "estimate", triggers: "no hot water" },
            // Stored pre-collapse rows, exactly as they sit in production blobs today.
            { name: "AC / heating repair", lane: "repair" as never, triggers: "no heat" },
            { name: "Leak detection & repair", lane: "repair" as never, triggers: "leak" },
            { name: "Drain cleaning", lane: "flat", price: 99, triggers: "clog" },
          ],
          notServices: "",
          serviceFee: 89,
          feeCredited: true,
        },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lanes = r.value.props.booking.services.map((s) => `${s.lane}${s.feeApplies ? "+fee" : ""}`);
    expect(lanes).toEqual(["estimate", "estimate+fee", "estimate+fee", "flat"]);
  });
});
