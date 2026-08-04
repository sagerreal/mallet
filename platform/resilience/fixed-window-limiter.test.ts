import { describe, it, expect } from "vitest";
import { FixedWindowLimiter } from "./fixed-window-limiter";

const at = (t: { ms: number }) => () => t.ms;

describe("FixedWindowLimiter", () => {
  it("allows normal traffic under the limit and refuses the call over it", () => {
    const clock = { ms: 0 };
    const limiter = new FixedWindowLimiter({ limit: 3, windowMs: 60_000, now: at(clock) });

    expect(limiter.allow("tok-a")).toBe(true);
    expect(limiter.allow("tok-a")).toBe(true);
    expect(limiter.allow("tok-a")).toBe(true);
    expect(limiter.allow("tok-a")).toBe(false); // 4th in the same window — throttled
  });

  it("keys independently — one hot key never throttles another", () => {
    const clock = { ms: 0 };
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 60_000, now: at(clock) });

    expect(limiter.allow("hot")).toBe(true);
    expect(limiter.allow("hot")).toBe(false);
    expect(limiter.allow("cold")).toBe(true); // unaffected
  });

  it("resets when the window elapses", () => {
    const clock = { ms: 0 };
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 60_000, now: at(clock) });

    expect(limiter.allow("k")).toBe(true);
    expect(limiter.allow("k")).toBe(false);
    clock.ms = 60_000; // window boundary — a fresh window opens
    expect(limiter.allow("k")).toBe(true);
    expect(limiter.allow("k")).toBe(false);
  });

  it("bounds its memory: expired keys are swept once maxKeys is exceeded", () => {
    const clock = { ms: 0 };
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 1_000, maxKeys: 5, now: at(clock) });

    for (let i = 0; i < 5; i += 1) expect(limiter.allow(`probe-${i}`)).toBe(true);
    clock.ms = 2_000; // all five windows expired
    expect(limiter.allow("fresh")).toBe(true);
    expect(limiter.size).toBeLessThanOrEqual(5); // the expired probes were dropped
  });

  it("never sweeps LIVE windows — an attacker filling the map cannot un-throttle themselves", () => {
    const clock = { ms: 0 };
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 60_000, maxKeys: 3, now: at(clock) });

    expect(limiter.allow("victim")).toBe(true);
    expect(limiter.allow("a")).toBe(true);
    expect(limiter.allow("b")).toBe(true);
    expect(limiter.allow("c")).toBe(true); // exceeds maxKeys, but every window is still live
    expect(limiter.allow("victim")).toBe(false); // the live count survived the sweep attempt
  });
});
