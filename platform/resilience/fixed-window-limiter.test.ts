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

  it("sweeps expired keys so an idle map drains", () => {
    const clock = { ms: 0 };
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 1_000, maxKeys: 5, now: at(clock) });

    for (let i = 0; i < 5; i += 1) expect(limiter.allow(`probe-${i}`)).toBe(true);
    clock.ms = 2_000; // all five windows expired
    expect(limiter.allow("fresh")).toBe(true);
    expect(limiter.size).toBe(1); // the expired probes were dropped; only "fresh" remains
  });

  /**
   * The bound this class actually has to hold. maxKeys used to be only a SWEEP TRIGGER: at
   * capacity with every window live, the sweep freed nothing and the insert happened anyway, so
   * the map grew without limit AND every later call ran a full scan that found nothing —
   * unbounded memory plus quadratic CPU, reachable by looping
   * `GET /api/public/invoice/<random-64-hex>` (rejected before any DB/Stripe work, so it costs
   * the attacker nothing).
   */
  it("never exceeds maxKeys under a flood of fresh keys, every window live", () => {
    const clock = { ms: 0 };
    const limiter = new FixedWindowLimiter({ limit: 5, windowMs: 60_000, maxKeys: 10, now: at(clock) });

    for (let i = 0; i < 5_000; i += 1) {
      limiter.allow(`flood-${i}`); // all live — the sweep can never free anything
      expect(limiter.size).toBeLessThanOrEqual(10);
    }
    expect(limiter.size).toBe(10);
  });

  it("bounds sweep work — a flood past capacity does not scan on every call", () => {
    const clock = { ms: 0 };
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 1_000, maxKeys: 5, now: at(clock) });

    for (let i = 0; i < 500; i += 1) limiter.allow(`flood-${i}`);
    // At most one sweep per window tick — NOT one per call past capacity, which was the
    // quadratic path (500 calls, each a full scan).
    expect(limiter.sweepCount).toBe(1);

    clock.ms = 5_000; // a later window
    for (let i = 0; i < 500; i += 1) limiter.allow(`later-${i}`);
    expect(limiter.sweepCount).toBe(2);
  });

  it("never un-throttles a live victim: a flood smaller than the ceiling cannot reach it", () => {
    const clock = { ms: 0 };
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 60_000, maxKeys: 100, now: at(clock) });

    expect(limiter.allow("victim")).toBe(true);
    expect(limiter.allow("victim")).toBe(false); // victim is throttled

    for (let i = 0; i < 50; i += 1) limiter.allow(`attacker-${i}`); // half the ceiling
    expect(limiter.allow("victim")).toBe(false); // untouched — still throttled
  });

  it("evicts the OLDEST window only, so reaching a chosen victim costs the whole map", () => {
    const clock = { ms: 0 };
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 60_000, maxKeys: 3, now: at(clock) });

    limiter.allow("oldest");
    limiter.allow("middle");
    limiter.allow("newest");
    expect(limiter.allow("oldest")).toBe(false); // all three throttled, map at capacity
    expect(limiter.allow("middle")).toBe(false);
    expect(limiter.allow("newest")).toBe(false);

    limiter.allow("intruder"); // at capacity, nothing expired → evict exactly one: the oldest

    // Probe the SURVIVORS first. At capacity there is no read-only probe: allow() on an absent
    // key inserts, which evicts another entry — so asserting the evicted key first would
    // destroy the very state under test (and did).
    expect(limiter.allow("middle")).toBe(false); // untouched — eviction is not indiscriminate
    expect(limiter.allow("newest")).toBe(false);
    expect(limiter.allow("oldest")).toBe(true); // the oldest, and only it, lost its window
    expect(limiter.size).toBe(3); // ceiling held throughout
  });

  it("orders eviction by WINDOW START, so a refreshed key is not evicted early", () => {
    const clock = { ms: 0 };
    const limiter = new FixedWindowLimiter({ limit: 1, windowMs: 1_000, maxKeys: 2, now: at(clock) });

    limiter.allow("a"); // window starts at t=0
    limiter.allow("b"); // window starts at t=0

    clock.ms = 1_000;
    limiter.allow("a"); // "a" opens a FRESH window — now the newest, not the oldest

    clock.ms = 1_100;
    limiter.allow("c"); // at capacity → the genuinely oldest is "b", not "a"

    expect(limiter.allow("a")).toBe(false); // "a" kept its fresh window (already spent its 1)
    expect(limiter.allow("c")).toBe(false);
  });
});
