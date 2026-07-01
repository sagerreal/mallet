import { describe, it, expect } from "vitest";
import { userMessage } from "./error-map";

const trpcError = (code: string) => ({ data: { code }, message: "raw server text" });

describe("userMessage", () => {
  it("maps known TRPC codes to friendly copy and never echoes raw text for unknowns", () => {
    expect(userMessage(trpcError("UNAUTHORIZED"))).toBe("Your session expired. Sign in again.");
    expect(userMessage(trpcError("FORBIDDEN"))).toBe("Your role can't do that.");
    expect(userMessage(trpcError("PRECONDITION_FAILED"))).toBe("That feature isn't set up yet for this account.");
    expect(userMessage(trpcError("TOO_MANY_REQUESTS"))).toBe("The assistant is busy. Try again in a moment.");
    expect(userMessage(trpcError("INTERNAL_SERVER_ERROR"))).toBe("Something went wrong. Try again.");
    expect(userMessage(new Error("connection refused"))).toBe("Something went wrong. Try again.");
  });

  it("passes through BAD_REQUEST / NOT_FOUND / CONFLICT server messages (they are written for users)", () => {
    expect(userMessage(trpcError("BAD_REQUEST"))).toBe("raw server text");
    expect(userMessage(trpcError("NOT_FOUND"))).toBe("raw server text");
    expect(userMessage(trpcError("CONFLICT"))).toBe("raw server text");
  });
});
