import { describe, it, expect } from "vitest";
import type { AgentMessage } from "@mallet/ai";
import { awaitsToolResults, dateLine, DEFAULT_TIMEZONE } from "./wake-context";

// 2026-08-21T02:30:00Z is 7:30pm on the 20th in Los Angeles: the exact rollover the ai-router
// comment records paying for once already. Any UTC rendering says "the 21st".
const EVENING = new Date("2026-08-21T02:30:00Z");

const textOf = (message: AgentMessage): string =>
  message.role === "user" && message.kind === "text" ? message.text : "";

describe("dateLine", () => {
  it("renders the instant in the shop's timezone, not UTC", () => {
    const text = textOf(dateLine(EVENING, { name: "Ace Plumbing", timezone: "America/Los_Angeles" }));
    expect(text).toContain("2026-08-20");
    expect(text).toContain("19:30");
    expect(text).not.toContain("2026-08-21");
    expect(text).not.toContain("02:30");
  });

  it("names the shop, the timezone, and the two ways to stop", () => {
    const text = textOf(dateLine(EVENING, { name: "Ace Plumbing", timezone: "America/New_York" }));
    expect(text).toContain("Ace Plumbing");
    expect(text).toContain("America/New_York");
    expect(text).toContain("Thursday");
    expect(text).toContain("schedule_next_step");
    expect(text).toContain("finish_task");
  });

  it("says the same instant differently for two shops in different zones", () => {
    const west = textOf(dateLine(EVENING, { name: "W", timezone: "America/Los_Angeles" }));
    const east = textOf(dateLine(EVENING, { name: "E", timezone: "America/New_York" }));
    expect(west).toContain("2026-08-20");
    expect(east).toContain("2026-08-20 at 22:30");
  });

  it("falls back to a stated default rather than throwing on an unusable timezone", () => {
    // Intl throws RangeError on an unknown zone. One bad settings row must not break every wake
    // that org ever takes.
    const text = textOf(dateLine(EVENING, { name: "Ace", timezone: "Mars/Olympus_Mons" }));
    expect(text).toContain(DEFAULT_TIMEZONE);
    expect(text).toContain("2026-08-20");
  });

  it("still addresses a shop with no name", () => {
    expect(textOf(dateLine(EVENING, { name: null, timezone: "UTC" }))).toContain("your organization");
  });
});

describe("awaitsToolResults", () => {
  const pending: AgentMessage = {
    role: "assistant",
    kind: "assistant",
    blocks: [{ type: "tool_use", id: "u1", name: "customer_list", input: {} }],
  };

  it("is false for an empty transcript", () => {
    expect(awaitsToolResults([])).toBe(false);
  });

  it("is true when the last message is an assistant turn with an unanswered tool_use", () => {
    expect(awaitsToolResults([{ role: "user", kind: "text", text: "chase them" }, pending])).toBe(true);
  });

  it("is false once the tool results have landed", () => {
    expect(
      awaitsToolResults([pending, { role: "user", kind: "tool_results", results: [{ toolUseId: "u1", content: "ok" }] }]),
    ).toBe(false);
  });

  it("is false for an assistant turn that only spoke", () => {
    expect(awaitsToolResults([{ role: "assistant", kind: "assistant", blocks: [{ type: "text", text: "hi" }] }])).toBe(false);
  });
});
