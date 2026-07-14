import { describe, it, expect } from "vitest";
import { deriveDisposition, type LedgerRow } from "./disposition";
import type { CallDisposition } from "../domain/call-record";

// The disposition is derived deterministically from the call's tool-invocation rows. Precedence
// (highest → lowest): emergency (any result data.emergency === true) > booked_estimate >
// booked_job > quote_request > message > no_action. In PR A only take_message exists (→ "message"),
// but the full precedence ladder is implemented + table-tested so PR B's booking tools slot in
// without touching this logic.

const row = (tool: string, data?: Record<string, unknown>): LedgerRow => ({
  tool,
  result: data ? { speak: "ok", data } : { speak: "ok" },
});

describe("deriveDisposition", () => {
  const cases: ReadonlyArray<{ name: string; rows: LedgerRow[]; expected: CallDisposition }> = [
    { name: "no tools ran → no_action", rows: [], expected: "no_action" },
    { name: "take_message → message", rows: [row("take_message")], expected: "message" },
    { name: "request_quote → quote_request", rows: [row("request_quote")], expected: "quote_request" },
    { name: "book_visit (work) → booked_job", rows: [row("book_visit", { kind: "work" })], expected: "booked_job" },
    {
      name: "book_visit (estimate) → booked_estimate",
      rows: [row("book_visit", { kind: "estimate" })],
      expected: "booked_estimate",
    },
    {
      name: "any emergency flag beats a booking",
      rows: [row("book_visit", { kind: "work", emergency: true })],
      expected: "emergency",
    },
    {
      name: "an emergency on any row wins even alongside a plain message",
      rows: [row("take_message"), row("book_visit", { emergency: true })],
      expected: "emergency",
    },
    {
      name: "booked_estimate outranks a message in the same call",
      rows: [row("take_message"), row("book_visit", { kind: "estimate" })],
      expected: "booked_estimate",
    },
    {
      name: "booked_job outranks quote_request",
      rows: [row("request_quote"), row("book_visit", { kind: "work" })],
      expected: "booked_job",
    },
    {
      name: "quote_request outranks message",
      rows: [row("take_message"), row("request_quote")],
      expected: "quote_request",
    },
    {
      name: "book_visit with no kind data defaults to booked_job",
      rows: [row("book_visit")],
      expected: "booked_job",
    },
    {
      name: "an unknown tool alone → no_action",
      rows: [row("some_future_tool")],
      expected: "no_action",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(deriveDisposition(c.rows)).toBe(c.expected);
    });
  }

  it("tolerates a malformed result payload (non-object) without throwing", () => {
    expect(deriveDisposition([{ tool: "take_message", result: "junk" }])).toBe("message");
    expect(deriveDisposition([{ tool: "book_visit", result: null }])).toBe("booked_job");
  });
});
