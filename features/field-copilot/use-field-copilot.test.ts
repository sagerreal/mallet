import { describe, it, expect } from "vitest";
import { stripMdEmphasis } from "./use-field-copilot";

// parseFoundWork and its ~110 lines of contract tests were deleted with the FOUND WORK marker:
// change orders are how a tech proposes extra work now, so the copilot no longer emits one.

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
