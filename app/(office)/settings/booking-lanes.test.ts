import { describe, it, expect } from "vitest";
import { routeOf, laneFor, parseBallpark, formatBallpark } from "./booking-lanes";

describe("routeOf", () => {
  it("maps repair and flat to 'book', estimate to 'quote'", () => {
    expect(routeOf("repair")).toBe("book");
    expect(routeOf("flat")).toBe("book");
    expect(routeOf("estimate")).toBe("quote");
  });
});

describe("laneFor", () => {
  it("quote route is always the estimate lane (price ignored)", () => {
    expect(laneFor("quote", "")).toBe("estimate");
    expect(laneFor("quote", "150")).toBe("estimate");
  });

  it("book route with a positive price is flat", () => {
    expect(laneFor("book", "99")).toBe("flat");
    expect(laneFor("book", "285.50")).toBe("flat");
  });

  it("book route with no/zero/garbage price is repair (priced on site)", () => {
    expect(laneFor("book", "")).toBe("repair");
    expect(laneFor("book", "   ")).toBe("repair");
    expect(laneFor("book", "0")).toBe("repair");
    expect(laneFor("book", "abc")).toBe("repair");
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
