import { describe, it, expect } from "vitest";
import { TOOL_RESULT_CLOSE, TOOL_RESULT_OPEN } from "../app/build-execute-tool";
import { SYSTEM_PROMPT } from "./system-prompt";

// Locks the untrusted-content boundary into the prompt text itself: a future rewrite of
// SYSTEM_PROMPT that drops this paragraph should fail the build, not surface as a live
// prompt-injection incident.
//
// Asserted against the EXPORTED CONSTANTS, never a hand-typed substring. The guard only works if
// the markers the prompt names are byte-identical to the ones `buildExecuteTool` actually wraps
// results in — so renaming a constant must fail HERE. A bare "UNTRUSTED_RECORD_DATA" literal passed
// happily while the two sides drifted apart, which is the one failure mode this test exists to
// catch.
describe("SYSTEM_PROMPT", () => {
  it("names the exact markers buildExecuteTool wraps tool results in", () => {
    expect(SYSTEM_PROMPT).toContain(TOOL_RESULT_OPEN);
    expect(SYSTEM_PROMPT).toContain(TOOL_RESULT_CLOSE);
  });
});
