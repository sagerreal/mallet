import { describe, it, expect } from "vitest";
import { parseFoundWork, stripMdEmphasis } from "./use-field-copilot";

describe("parseFoundWork", () => {
  // --- no marker ---

  it("returns original text and null when there is no marker", () => {
    const text = "Check the pressure valve on the inlet manifold.";
    const result = parseFoundWork(text);
    expect(result.foundWork).toBeNull();
    expect(result.displayText).toBe(text);
  });

  it("returns null foundWork for an empty string", () => {
    const result = parseFoundWork("");
    expect(result.foundWork).toBeNull();
    expect(result.displayText).toBe("");
  });

  it("returns null foundWork for whitespace-only text", () => {
    const result = parseFoundWork("   \n  \n  ");
    expect(result.foundWork).toBeNull();
  });

  // --- valid marker ---

  it("parses a marker at the end of the reply", () => {
    const text = "Good diagnosis.\n\nFOUND WORK: Replace expansion tank";
    const result = parseFoundWork(text);
    expect(result.foundWork).toBe("Replace expansion tank");
    expect(result.displayText).toBe("Good diagnosis.");
  });

  it("strips trailing whitespace after the marker description", () => {
    const text = "Advice text.\nFOUND WORK: Replace pressure relief valve   ";
    const result = parseFoundWork(text);
    expect(result.foundWork).toBe("Replace pressure relief valve");
  });

  it("strips the marker line and trailing blank lines from displayText", () => {
    const text = "First line.\nSecond line.\n\nFOUND WORK: Replace PRV\n\n";
    const result = parseFoundWork(text);
    expect(result.displayText).toBe("First line.\nSecond line.");
    expect(result.foundWork).toBe("Replace PRV");
  });

  it("parses a marker that is the only line", () => {
    const text = "FOUND WORK: Reroute gas line";
    const result = parseFoundWork(text);
    expect(result.foundWork).toBe("Reroute gas line");
    expect(result.displayText).toBe("");
  });

  it("accepts a description at exactly 80 characters", () => {
    const description = "a".repeat(80);
    const text = `Advice.\nFOUND WORK: ${description}`;
    const result = parseFoundWork(text);
    expect(result.foundWork).toBe(description);
  });

  // --- >80 chars ignored ---

  it("ignores a marker with description > 80 characters", () => {
    const description = "b".repeat(81);
    const text = `Advice.\nFOUND WORK: ${description}`;
    const result = parseFoundWork(text);
    expect(result.foundWork).toBeNull();
    // Original text unchanged when marker is ignored.
    expect(result.displayText).toBe(text);
  });

  // --- marker not at end ignored ---

  it("ignores a marker that is not the last non-empty line", () => {
    const text =
      "FOUND WORK: Replace expansion tank\nThis is still part of the answer.";
    const result = parseFoundWork(text);
    expect(result.foundWork).toBeNull();
    expect(result.displayText).toBe(text);
  });

  it("ignores a mid-reply marker when more content follows", () => {
    const text =
      "Line 1.\nFOUND WORK: Replace PRV\nLine 3.";
    const result = parseFoundWork(text);
    expect(result.foundWork).toBeNull();
  });

  // --- multi-turn / realistic outputs ---

  it("handles a realistic multi-paragraph reply with a marker", () => {
    const text = [
      "The PRV may be stuck open — check for discharge at the relief tube.",
      "",
      "Steps:",
      "1. Shut water to the boiler.",
      "2. Check the PRV discharge tube for moisture.",
      "3. If it is weeping, the PRV is faulty.",
      "",
      "FOUND WORK: Replace faulty pressure relief valve",
    ].join("\n");
    const result = parseFoundWork(text);
    expect(result.foundWork).toBe("Replace faulty pressure relief valve");
    expect(result.displayText).toContain("1. Shut water to the boiler.");
    expect(result.displayText).not.toContain("FOUND WORK:");
  });

  it("handles trailing newlines after the marker", () => {
    const text = "Check the anode rod.\nFOUND WORK: Replace anode rod\n\n\n";
    const result = parseFoundWork(text);
    expect(result.foundWork).toBe("Replace anode rod");
    expect(result.displayText).toBe("Check the anode rod.");
  });
});

describe("stripMdEmphasis", () => {
  it("strips **bold** markers, keeps the text", () => {
    expect(stripMdEmphasis("This is **JOB-1007 — swap** (2-hr).")).toBe("This is JOB-1007 — swap (2-hr).");
  });
  it("strips *italic* between spaces but leaves bare asterisks like 3/4* pipe math alone", () => {
    expect(stripMdEmphasis("check *this* now")).toBe("check this now");
    expect(stripMdEmphasis("torque to 25*2 ft-lb")).toBe("torque to 25*2 ft-lb");
  });
  it("no markers → unchanged", () => {
    expect(stripMdEmphasis("plain line")).toBe("plain line");
  });
});
