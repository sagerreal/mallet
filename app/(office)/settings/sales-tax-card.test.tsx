/**
 * The percent↔bps conversion is the part worth locking: the shop types a percentage and the
 * column stores basis points, so an off-by-100 here bills every customer a hundredth of the tax
 * they owe (or a hundred times it) and nothing on screen looks wrong.
 */
import { describe, it, expect } from "vitest";
import { bpsToPercentText, percentTextToBps } from "./sales-tax-card";

describe("bpsToPercentText", () => {
  it.each([
    [825, "8.25"],
    [1000, "10"],
    [700, "7"],
    [1050, "10.5"],
  ])("renders %i bps as %s", (bps, text) => {
    expect(bpsToPercentText(bps)).toBe(text);
  });

  it("shows nothing for an unset rate, so the field reads empty rather than '0'", () => {
    expect(bpsToPercentText(0)).toBe("");
  });

  it("trims trailing zeros — a whole percent reads '8', not '8.00'", () => {
    expect(bpsToPercentText(800)).toBe("8");
  });
});

describe("percentTextToBps", () => {
  it.each([
    ["8.25", 825],
    ["8", 800],
    ["0", 0],
    ["", 0],
    ["10.5", 1050],
    ["8.25%", 825],
    ["  8.25  ", 825],
  ])("parses %s to %i bps", (text, bps) => {
    expect(percentTextToBps(text)).toBe(bps);
  });

  it("rejects a rate above 25%, which is a decimal point that went missing", () => {
    expect(percentTextToBps("825")).toBeNull();
    expect(percentTextToBps("25.01")).toBeNull();
    expect(percentTextToBps("25")).toBe(2500);
  });

  it("rejects text that is not a number rather than silently storing 0", () => {
    expect(percentTextToBps("eight")).toBeNull();
    expect(percentTextToBps("8.2.5")).toBeNull();
    expect(percentTextToBps("-1")).toBeNull();
  });

  it("round-trips every rate the UI can produce", () => {
    for (let bps = 0; bps <= 2500; bps += 25) {
      expect(percentTextToBps(bpsToPercentText(bps))).toBe(bps);
    }
  });
});
