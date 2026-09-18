import { describe, it, expect } from "vitest";
import { call } from "./resilient-call";
import { TimeoutError } from "./errors";

const noSleep = async (): Promise<void> => undefined;
const noJitter = (): number => 0;

describe("call", () => {
  it("does not retry a non-idempotent call", async () => {
    let calls = 0;
    await expect(
      call(
        async () => {
          calls += 1;
          throw new Error("fail");
        },
        { retries: 3, idempotent: false, sleep: noSleep, random: noJitter },
      ),
    ).rejects.toThrow("fail");
    expect(calls).toBe(1);
  });

  it("retries an idempotent call", async () => {
    let calls = 0;
    const result = await call(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error("flaky");
        return "ok";
      },
      { retries: 5, idempotent: true, sleep: noSleep, random: noJitter },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("enforces the timeout", async () => {
    await expect(
      call(() => new Promise((resolve) => setTimeout(() => resolve("late"), 100)), {
        timeoutMs: 20,
      }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});
