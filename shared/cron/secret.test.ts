import { describe, it, expect, vi } from "vitest";
import { secretMatches, readCronSecret } from "./secret";

// Wraps node:crypto's createHash to record calls while still delegating to the real
// implementation, so a test can assert a guard short-circuits BEFORE hashing rather than only
// re-checking a return value that a hash step would have produced anyway (see the "genuinely
// exercises" test below for why that distinction matters here). vi.mock is hoisted above the
// import above by vitest's transform, so secret.ts's own `import { createHash } from
// "node:crypto"` resolves to this wrapped version too.
const createHashSpy = vi.fn<(typeof import("node:crypto"))["createHash"]>();
vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    createHash: (...args: Parameters<typeof actual.createHash>) => {
      createHashSpy(...args);
      return actual.createHash(...args);
    },
  };
});

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

  it("rejects a non-empty presented value against an unset (empty) expectation", () => {
    // Documents the required behaviour: an unset CRON_SECRET must never be satisfiable by ANY
    // presented credential -- this is exactly the fail-closed guarantee a future caller without
    // the outbox route's separate 503-when-unset check would rely on. NOTE: on its own this
    // assertion does NOT prove the `expected.length === 0` half of the guard is load-bearing --
    // see the next test, which does.
    expect(secretMatches("a-very-long-cron-secret", "")).toBe(false);
  });

  it("genuinely exercises the expected.length===0 guard: short-circuits before ever hashing", () => {
    // Mutation testing this file surfaced something the assertion above cannot detect on its
    // own: SHA-256 is collision-resistant, so digest(presented) can only equal digest("") when
    // presented === "" -- a case the `presented.length === 0` half of the guard already covers.
    // That means deleting `|| expected.length === 0` from the guard and falling through to
    // `timingSafeEqual(digest(presented), digest(expected))` still returns `false` for a
    // non-empty presented value against an empty expected: the hash step alone reaches the same
    // *answer*, just via a different path that skips the fail-fast intent of the guard. A
    // return-value-only assertion (the test above) is silent to that mutant.
    //
    // This test instead asserts the guard's mechanism, not just its output: with the guard
    // intact, `createHash` is never called when `expected` is empty, because the function
    // returns before reaching `digest()`. Deleting the `expected.length === 0` clause makes this
    // FAIL (createHash gets called twice, to hash both sides) even though the assertion above
    // still passes -- which is exactly the mutant this closes.
    createHashSpy.mockClear();
    const result = secretMatches("a-very-long-cron-secret", "");
    expect(result).toBe(false);
    expect(createHashSpy).not.toHaveBeenCalled();
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
