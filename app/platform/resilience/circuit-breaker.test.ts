import { describe, it, expect } from "vitest";
import { CircuitBreaker } from "./circuit-breaker";
import { CircuitOpenError } from "./errors";

const fail = async (): Promise<never> => {
  throw new Error("boom");
};
const ok = async (): Promise<string> => "ok";

describe("CircuitBreaker", () => {
  it("opens after the failure threshold and then fails fast without calling fn", async () => {
    const cb = new CircuitBreaker("svc", { failureThreshold: 2, resetMs: 500, now: () => 1000 });
    await expect(cb.exec(fail)).rejects.toThrow("boom");
    await expect(cb.exec(fail)).rejects.toThrow("boom"); // 2nd failure opens

    let called = false;
    await expect(
      cb.exec(async () => {
        called = true;
        return "x";
      }),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(called).toBe(false);
  });

  it("half-opens after resetMs and closes on a successful trial", async () => {
    let clock = 0;
    const cb = new CircuitBreaker("svc", { failureThreshold: 1, resetMs: 100, now: () => clock });
    await expect(cb.exec(fail)).rejects.toThrow(); // opens
    clock = 50;
    await expect(cb.exec(ok)).rejects.toBeInstanceOf(CircuitOpenError); // still cooling down
    clock = 150;
    await expect(cb.exec(ok)).resolves.toBe("ok"); // half-open trial succeeds
    expect(cb.state_).toBe("closed");
  });

  it("re-opens if the half-open trial fails", async () => {
    let clock = 0;
    const cb = new CircuitBreaker("svc", { failureThreshold: 1, resetMs: 100, now: () => clock });
    await expect(cb.exec(fail)).rejects.toThrow(); // opens
    clock = 150;
    await expect(cb.exec(fail)).rejects.toThrow("boom"); // half-open trial fails -> re-open
    let called = false;
    await expect(
      cb.exec(async () => {
        called = true;
        return "x";
      }),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(called).toBe(false);
  });
});
