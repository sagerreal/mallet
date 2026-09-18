/**
 * PRECONDITION_FAILED carries the only sentence that names WHY a domain refused. Swallowing it is
 * how Mallet told Owen "no business number" for an org whose business number was configured all
 * along — while the server had actually said "texting isn't approved for this org yet".
 */
import { describe, it, expect } from "vitest";
import { userMessage } from "./error-map";

const trpcError = (code: string, message: string) => ({
  name: "TRPCClientError",
  message,
  data: { code },
});

describe("userMessage — PRECONDITION_FAILED passes the server's reason through", () => {
  // The three the messaging send can raise. They MUST read differently.
  const causes = [
    "no business number provisioned for texting yet",
    "texting isn't approved for this org yet — finish 10DLC registration",
    "texting is not set up on this server yet",
  ];

  it.each(causes)("keeps the specific reason: %s", (message) => {
    expect(userMessage(trpcError("PRECONDITION_FAILED", message))).toBe(message);
  });

  it("gives three DIFFERENT sentences for the three causes", () => {
    const shown = new Set(causes.map((m) => userMessage(trpcError("PRECONDITION_FAILED", m))));
    expect(shown.size).toBe(3);
  });

  // The scrub that matters: an operator reads the server log, a customer must not read our env.
  it("no longer leaks environment variable names", () => {
    for (const m of causes) {
      expect(m).not.toMatch(/TWILIO_|ANTHROPIC_|_KEY|_TOKEN|_SID/);
    }
  });

  it("still hides an internal error behind the fallback", () => {
    const shown = userMessage(trpcError("INTERNAL_SERVER_ERROR", 'Failed query: select "x" from "y"'));
    expect(shown).not.toMatch(/select/);
  });

  it("falls back when the error carries no message", () => {
    expect(userMessage(trpcError("PRECONDITION_FAILED", ""), "Texting isn't set up yet.")).toBe(
      "Texting isn't set up yet.",
    );
  });
});
