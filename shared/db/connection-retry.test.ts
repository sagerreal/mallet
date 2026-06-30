import { describe, it, expect } from "vitest";
import { isTransientConnectionError, withConnectionRetry } from "./connection-retry";

const noSleep = async (): Promise<void> => undefined;

const pgError = (message: string, code?: string): Error => {
  const e = new Error(message) as Error & { code?: string };
  if (code) e.code = code;
  return e;
};

describe("isTransientConnectionError", () => {
  it("flags the Supavisor cold-connect auth failure", () => {
    expect(isTransientConnectionError(pgError("password authentication failed for user x"))).toBe(
      true,
    );
    expect(isTransientConnectionError(pgError("nope", "28P01"))).toBe(true);
  });

  it("does not flag ordinary errors", () => {
    expect(isTransientConnectionError(pgError("duplicate key value", "23505"))).toBe(false);
    expect(isTransientConnectionError("not an error")).toBe(false);
  });
});

describe("withConnectionRetry", () => {
  it("retries a transient connection error and then succeeds", async () => {
    let calls = 0;
    const result = await withConnectionRetry(
      async () => {
        calls += 1;
        if (calls < 2) throw pgError("password authentication failed");
        return "ok";
      },
      { sleep: noSleep },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("does not retry a non-transient error", async () => {
    let calls = 0;
    await expect(
      withConnectionRetry(
        async () => {
          calls += 1;
          throw pgError("duplicate key value", "23505");
        },
        { sleep: noSleep },
      ),
    ).rejects.toThrow("duplicate key");
    expect(calls).toBe(1);
  });
});
