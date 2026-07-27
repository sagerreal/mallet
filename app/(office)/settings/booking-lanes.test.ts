import { describe, it, expect } from "vitest";
import type { BookingService } from "@/lib/store/slices/settings-slice";
import {
  LANE_OPTIONS,
  isBookableLane,
  flatPriceMissing,
  laneChipLabel,
  laneConsequence,
  parseBallpark,
  formatBallpark,
} from "./booking-lanes";

const svc = (over: Partial<BookingService> = {}): BookingService =>
  ({ name: "Drain cleaning", lane: "repair", triggers: "clog", ...over }) as BookingService;

describe("LANE_OPTIONS", () => {
  it("offers all three lanes as first-class choices", () => {
    // The whole point of the change: "service call" used to be what you got by leaving the price
    // blank, so it was never a thing you could pick or read off the list.
    expect(LANE_OPTIONS.map((o) => o.value)).toEqual(["repair", "flat", "estimate"]);
  });
});

describe("isBookableLane", () => {
  it("is true for the lanes that book real work, false for an estimate visit", () => {
    // Emergency words gate on this — an estimate visit is never the answer to a burst pipe.
    expect(isBookableLane("repair")).toBe(true);
    expect(isBookableLane("flat")).toBe(true);
    expect(isBookableLane("estimate")).toBe(false);
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

  it("never flags the lanes that have no price field at all", () => {
    expect(flatPriceMissing("repair", "")).toBe(false);
    expect(flatPriceMissing("estimate", "")).toBe(false);
  });
});

describe("laneChipLabel", () => {
  it("names the type on the collapsed row", () => {
    expect(laneChipLabel(svc({ lane: "repair" }))).toBe("Service call");
    expect(laneChipLabel(svc({ lane: "estimate" }))).toBe("Free estimate");
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
  it("states the service call fee against the lane that charges it", () => {
    // This is the sentence the old two-button control had nowhere to put, which is why the $95
    // read as if it came from nowhere.
    expect(laneConsequence("repair", "", 95)).toContain("$95");
    expect(laneConsequence("repair", "", 95)).toContain("prices it on site");
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
