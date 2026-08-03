import { describe, it, expect } from "vitest";
import type { BookingService } from "@/lib/store/slices/settings-slice";
import {
  LANE_OPTIONS,
  emergencyWordsApply,
  flatPriceMissing,
  laneChipLabel,
  laneConsequence,
  parseBallpark,
  formatBallpark,
} from "./booking-lanes";

const svc = (over: Partial<BookingService> = {}): BookingService =>
  ({ name: "Drain cleaning", lane: "estimate", feeApplies: true, triggers: "clog", ...over }) as BookingService;

describe("LANE_OPTIONS", () => {
  /**
   * TWO lanes since the flat-rate/estimate rework — the same two the job record has. The old
   * "service call" lane was an estimate booking with the visit fee attached; that is the
   * per-service feeApplies flag now, not a type a caller can be filed under.
   */
  it("offers the two lanes the job model has", () => {
    expect(LANE_OPTIONS.map((o) => o.value)).toEqual(["flat", "estimate"]);
  });
});

describe("emergencyWordsApply", () => {
  it("allows emergency words on flat work and fee visits, never on a free quote-first estimate", () => {
    // An emergency caller needs someone who will FIX something — a free estimate visit is never
    // the answer to a burst pipe.
    expect(emergencyWordsApply({ lane: "flat" })).toBe(true);
    expect(emergencyWordsApply({ lane: "estimate", feeApplies: true })).toBe(true);
    expect(emergencyWordsApply({ lane: "estimate" })).toBe(false);
  });
});

describe("flatPriceMissing", () => {
  it("flags a flat lane with no usable price", () => {
    // Left unflagged, book-visit-speak falls back to the SERVICE FEE — a different number than
    // the owner meant to charge, spoken to a real caller.
    expect(flatPriceMissing("flat", "")).toBe(true);
    expect(flatPriceMissing("flat", "   ")).toBe(true);
    expect(flatPriceMissing("flat", "0")).toBe(true);
    expect(flatPriceMissing("flat", "abc")).toBe(true);
  });

  it("accepts a positive price", () => {
    expect(flatPriceMissing("flat", "99")).toBe(false);
    expect(flatPriceMissing("flat", "285.50")).toBe(false);
  });

  it("never flags the estimate lane, which has no price field at all", () => {
    expect(flatPriceMissing("estimate", "")).toBe(false);
  });
});

describe("laneChipLabel", () => {
  it("names the type on the collapsed row, fee state included", () => {
    expect(laneChipLabel(svc({ lane: "estimate", feeApplies: true }))).toBe("Estimate · fee");
    expect(laneChipLabel(svc({ lane: "estimate", feeApplies: undefined }))).toBe("Estimate · free");
  });

  it("carries the flat price itself, so the list is readable without opening a row", () => {
    expect(laneChipLabel(svc({ lane: "flat", price: 149 }))).toBe("$149 flat");
  });

  it("says a flat service has no price rather than showing a bare type", () => {
    expect(laneChipLabel(svc({ lane: "flat" }))).toBe("Price not set");
    expect(laneChipLabel(svc({ lane: "flat", price: 0 }))).toBe("Price not set");
  });
});

describe("laneConsequence", () => {
  it("states the visit fee against the service that charges it", () => {
    // This is the sentence the old two-button control had nowhere to put, which is why the $95
    // read as if it came from nowhere.
    expect(laneConsequence("estimate", "", 95, true)).toContain("$95");
    expect(laneConsequence("estimate", "", 95, true)).toContain("prices it on site");
  });

  it("promises no price at all on a free estimate", () => {
    expect(laneConsequence("estimate", "", 95)).not.toContain("$");
  });

  it("quotes the flat price back as the caller will hear it", () => {
    expect(laneConsequence("flat", "149", 95)).toContain("$149");
  });

  it("asks for the price instead of describing a booking that cannot happen", () => {
    expect(laneConsequence("flat", "", 95)).toBe("Enter the price the caller will be quoted.");
  });

  it("promises no price at all on an estimate", () => {
    const c = laneConsequence("estimate", "", 95);
    expect(c).toContain("no price");
    expect(c).not.toContain("95");
  });
});

describe("parseBallpark / formatBallpark round-trip", () => {
  it("parses the canonical stored form", () => {
    expect(parseBallpark("$150–$300")).toEqual({ low: "150", high: "300" });
  });

  it("parses a single figure and legacy prose", () => {
    expect(parseBallpark("around $200")).toEqual({ low: "200", high: "" });
    expect(parseBallpark("$1,250.00")).toEqual({ low: "1250.00", high: "" });
    expect(parseBallpark("")).toEqual({ low: "", high: "" });
    expect(parseBallpark("no numbers here")).toEqual({ low: "", high: "" });
  });

  it("formats both, one, or no figures", () => {
    expect(formatBallpark({ low: "150", high: "300" })).toBe("$150–$300");
    expect(formatBallpark({ low: "200", high: "" })).toBe("$200");
    expect(formatBallpark({ low: "", high: "300" })).toBe("$300");
    expect(formatBallpark({ low: "", high: "" })).toBe("");
  });

  it("round-trips the canonical form", () => {
    expect(formatBallpark(parseBallpark("$150–$300"))).toBe("$150–$300");
  });
});
