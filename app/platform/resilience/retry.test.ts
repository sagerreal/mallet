import { describe, it, expect } from "vitest";
import { withRetry } from "./retry";
import { CircuitOpenError } from "./errors";

const noSleep = async (): Promise<void> => undefined;
const noJitter = (): number => 0;
const base = { sleep: noSleep, random: noJitter } as const;

describe("withRetry", () => {
  it("returns on first success without retrying", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        return "ok";
      },
      { retries: 3, ...base },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  it("retries until it succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("flaky");
        return "ok";
      },
      { retries: 5, ...base },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("gives up after `retries` extra attempts", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error("always");
        },
        { retries: 2, ...base },
      ),
    ).rejects.toThrow("always");
    expect(calls).toBe(3); // first + 2 retries
  });

  it("respects shouldRetry=false", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error("fatal");
        },
        { retries: 5, shouldRetry: () => false, ...base },
      ),
    ).rejects.toThrow("fatal");
    expect(calls).toBe(1);
  });

  it("does not retry a CircuitOpenError by default", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new CircuitOpenError("svc");
        },
        { retries: 5, ...base },
      ),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(calls).toBe(1);
  });
});
