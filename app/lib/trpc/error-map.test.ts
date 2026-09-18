import { describe, it, expect } from "vitest";
import { userMessage, appErrorField, APP_ERROR_FIELD } from "./error-map";

const trpcError: (code: string) => { data: { code: string }; message: string } = (code) => ({ data: { code }, message: "raw server text" });

describe("userMessage", () => {
  it("maps known TRPC codes to friendly copy and never echoes raw text for unknowns", () => {
    expect(userMessage(trpcError("UNAUTHORIZED"))).toBe("Your session expired. Sign in again.");
    expect(userMessage(trpcError("FORBIDDEN"))).toBe("Your role can't do that.");
    expect(userMessage(trpcError("TOO_MANY_REQUESTS"))).toBe("The assistant is busy. Try again in a moment.");
    expect(userMessage(trpcError("INTERNAL_SERVER_ERROR"))).toBe("Something went wrong. Try again.");
    expect(userMessage(new Error("connection refused"))).toBe("Something went wrong. Try again.");
  });

  it("passes through BAD_REQUEST / NOT_FOUND / CONFLICT server messages (they are written for users)", () => {
    expect(userMessage(trpcError("BAD_REQUEST"))).toBe("raw server text");
    expect(userMessage(trpcError("NOT_FOUND"))).toBe("raw server text");
    expect(userMessage(trpcError("CONFLICT"))).toBe("raw server text");
  });

  /**
   * PRECONDITION_FAILED joined that list deliberately. It used to map to fixed copy — "That feature
   * isn't set up yet for this account" — which outranked the server's own sentence and reported a
   * missing business number for an org that had one configured, while the server had actually said
   * the org's 10DLC registration was not approved. Its messages are hand-authored for users and
   * audited free of internals; the fixed copy hid the one fact worth knowing.
   */
  it("passes through PRECONDITION_FAILED, which names the actual blocker", () => {
    expect(userMessage(trpcError("PRECONDITION_FAILED"))).toBe("raw server text");
  });
});

describe("appErrorField", () => {
  it("reads the tag a domain refusal put on the error", () => {
    expect(appErrorField({ data: { code: "BAD_REQUEST", [APP_ERROR_FIELD]: "unfinishedDays" } })).toBe("unfinishedDays");
  });

  it("returns null for anything that carries no tag", () => {
    expect(appErrorField({ data: { code: "BAD_REQUEST" } })).toBeNull();
    expect(appErrorField({ data: null })).toBeNull();
    expect(appErrorField(new Error("connection refused"))).toBeNull();
    expect(appErrorField(null)).toBeNull();
    expect(appErrorField("BAD_REQUEST")).toBeNull();
  });

  it("refuses a non-string tag rather than handing back junk to branch on", () => {
    expect(appErrorField({ data: { [APP_ERROR_FIELD]: 42 } })).toBeNull();
    expect(appErrorField({ data: { [APP_ERROR_FIELD]: "" } })).toBeNull();
  });
});
