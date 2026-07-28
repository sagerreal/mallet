import { describe, it, expect } from "vitest";
import { classifyReply } from "./reply-intent";

describe("classifyReply", () => {
  it("treats a bare affirmation as approval when something is pending", () => {
    for (const body of ["yes", "Yes", "YES!", "yep", "y", "ok", "sure", "go ahead", "do it"]) {
      expect(classifyReply(body, true), body).toEqual({ kind: "approve" });
    }
  });

  it("treats a bare refusal as denial", () => {
    for (const body of ["no", "No.", "nope", "cancel", "don't", "never mind", "abort"]) {
      expect(classifyReply(body, true), body).toEqual({ kind: "deny" });
    }
  });

  it("NEVER reads a yes as approval when nothing is pending", () => {
    // Otherwise a stray "yes" — or an old thread scrolled back to — could fire an action the
    // staffer has no idea is queued.
    expect(classifyReply("yes", false)).toEqual({ kind: "instruction" });
    expect(classifyReply("ok", false)).toEqual({ kind: "instruction" });
  });

  it("treats a QUALIFIED yes as a new instruction, not an approval", () => {
    // The qualification is the entire point. Running the frozen action would do the thing they
    // just asked to change.
    expect(classifyReply("yes but change the date to Friday", true)).toEqual({ kind: "instruction" });
    expect(classifyReply("yeah, and also text the customer", true)).toEqual({ kind: "instruction" });
  });

  it("treats an unrelated message as a new instruction", () => {
    expect(classifyReply("actually invoice the Miller job instead", true)).toEqual({ kind: "instruction" });
    expect(classifyReply("what's on my schedule", true)).toEqual({ kind: "instruction" });
  });

  it("treats an empty or punctuation-only body as an instruction, not an approval", () => {
    // A photo-only MMS arrives with an empty Body. That is not consent to run a queued mutation.
    expect(classifyReply("", true)).toEqual({ kind: "instruction" });
    expect(classifyReply("   ", true)).toEqual({ kind: "instruction" });
    expect(classifyReply("!!!", true)).toEqual({ kind: "instruction" });
  });

  it("is not fooled by a word that merely contains yes or no", () => {
    expect(classifyReply("yesterday I finished job 12", true)).toEqual({ kind: "instruction" });
    expect(classifyReply("nothing else today", true)).toEqual({ kind: "instruction" });
  });
});
