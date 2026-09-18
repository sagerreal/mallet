/**
 * A failed optimistic write used to report the same sentence whatever went wrong: "Couldn't update
 * customer — your change was undone. Check your connection and try again." When the real cause was
 * a duplicate phone number, that advice was not merely unhelpful, it was wrong — and the typed
 * number vanished with no explanation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reportWriteError, subscribeWriteErrors } from "./write-error";

const trpcError = (code: string, message: string) => ({ name: "TRPCClientError", message, data: { code } });

let seen: string[] = [];
let off: () => void;

beforeEach(() => {
  seen = [];
  off = subscribeWriteErrors((e) => seen.push(e.message));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  off();
  vi.restoreAllMocks();
});

describe("reportWriteError", () => {
  it("shows the server's reason when a domain refused, naming who has the number", () => {
    reportWriteError(
      "updateLead",
      trpcError("CONFLICT", "cscsdcs already has that number. Open them instead, or give this customer a different one."),
    );
    expect(seen[0]).toMatch(/cscsdcs already has that number/);
    expect(seen[0]).not.toMatch(/check your connection/i);
  });

  it("shows a validation refusal in its own words", () => {
    reportWriteError("updateLead", trpcError("BAD_REQUEST", "that number doesn't look right"));
    expect(seen[0]).toBe("that number doesn't look right");
  });

  // The generic line is still right for a genuine transport failure — that IS when checking a
  // connection helps.
  it("falls back to the connection advice for a dropped request", () => {
    reportWriteError("updateLead", new Error("Failed to fetch"));
    expect(seen[0]).toMatch(/check your connection/i);
    expect(seen[0]).toMatch(/undone/);
  });

  it("does not leak raw internals from a server fault", () => {
    reportWriteError("updateLead", trpcError("INTERNAL_SERVER_ERROR", 'Failed query: select "phone_e164" from "leads"'));
    expect(seen[0]).not.toMatch(/select|phone_e164/);
  });
});
