import { describe, it, expect } from "vitest";
import { secretMatches, readCronSecret } from "./secret";

describe("secretMatches", () => {
  it("accepts an exact match", () => {
    expect(secretMatches("a-very-long-cron-secret", "a-very-long-cron-secret")).toBe(true);
  });

  it("rejects a mismatch", () => {
    expect(secretMatches("a-very-long-cron-secret", "a-very-long-cron-secreT")).toBe(false);
  });

  it("rejects without throwing when the lengths differ", () => {
    // timingSafeEqual throws on unequal buffer lengths; hashing both sides first is what
    // makes an attacker unable to learn the length from a 500 vs a 401.
    expect(secretMatches("short", "a-very-long-cron-secret")).toBe(false);
  });

  it("rejects the empty string even against an empty expectation", () => {
    expect(secretMatches("", "")).toBe(false);
  });
});

describe("readCronSecret", () => {
  const req = (headers: Record<string, string>) => new Request("https://x.test/", { headers });

  it("reads a Bearer credential", () => {
    expect(readCronSecret(req({ authorization: "Bearer abc123" }))).toBe("abc123");
  });

  it("reads a Bearer credential case-insensitively", () => {
    expect(readCronSecret(req({ authorization: "bearer abc123" }))).toBe("abc123");
  });

  it("reads the x-cron-secret header when no authorization header is present", () => {
    expect(readCronSecret(req({ "x-cron-secret": "abc123" }))).toBe("abc123");
  });

  it("returns null when no credential is presented at all", () => {
    expect(readCronSecret(req({}))).toBeNull();
  });

  // NOTE: the task-2 brief's draft test asserted `toBeNull()` here. That is not what the live
  // outbox route actually does today (see app/api/cron/outbox/route.ts before this refactor):
  // `bearer ?? xHeader ?? ""` only falls through to x-cron-secret when the authorization header
  // is entirely ABSENT (`bearer` is `undefined`), not merely non-Bearer. When authorization is
  // present with any other scheme, `.replace()` finds no match and returns the header's original
  // string unchanged, which is a defined, non-empty value — so it wins outright and
  // x-cron-secret is never consulted. Preserving the live route's exact behaviour (per the
  // task-2 brief's own instruction to do so over the draft test) means asserting the real
  // precedence here instead.
  it("treats a non-Bearer authorization header as the literal presented value (matches the live route's existing precedence)", () => {
    expect(readCronSecret(req({ authorization: "Basic abc123" }))).toBe("Basic abc123");
  });

  it("ignores x-cron-secret whenever an authorization header is present, even a non-Bearer one", () => {
    expect(readCronSecret(req({ authorization: "Basic wrong-scheme", "x-cron-secret": "abc123" }))).toBe(
      "Basic wrong-scheme",
    );
  });
});
