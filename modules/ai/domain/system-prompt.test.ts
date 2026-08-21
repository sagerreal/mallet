import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT } from "./system-prompt";

// Locks the untrusted-content boundary into the prompt text itself: a future rewrite of
// SYSTEM_PROMPT that drops this paragraph should fail the build, not surface as a live
// prompt-injection incident.
describe("SYSTEM_PROMPT", () => {
  it("names the untrusted-record-data markers so a future rewrite can't silently drop the rule", () => {
    expect(SYSTEM_PROMPT).toContain("UNTRUSTED_RECORD_DATA");
  });
});
