import { describe, it, expect } from "vitest";
import { InMemoryIdempotencyStore } from "./idempotency";

describe("InMemoryIdempotencyStore", () => {
  it("runs the fn once for a given key (concurrent callers share the result)", async () => {
    const store = new InMemoryIdempotencyStore();
    let calls = 0;
    const fn = async (): Promise<string> => {
      calls += 1;
      return "v";
    };
    const [a, b] = await Promise.all([store.once("k", fn), store.once("k", fn)]);
    expect(a).toBe("v");
    expect(b).toBe("v");
    expect(calls).toBe(1);
  });

  it("evicts on failure so a later call re-runs", async () => {
    const store = new InMemoryIdempotencyStore();
    let calls = 0;
    await store
      .once("k", async () => {
        calls += 1;
        throw new Error("x");
      })
      .catch(() => undefined);
    await store.once("k", async () => {
      calls += 1;
      return "ok";
    });
    expect(calls).toBe(2);
  });
});
