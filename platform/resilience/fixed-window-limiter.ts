// Per-key fixed-window throttle for the public, unauthenticated routes (pay page, checkout,
// reconcile, quote). In-process by design: on serverless each warm instance enforces its own
// window, so this is DAMPING for abuse (Stripe-quota spam, log flooding, token probing) rather
// than a hard global cap — the hard guarantees stay where they already are (unguessable 256-bit
// tokens, the idempotent payments ledger, the shared Stripe circuit breaker). The one DB-backed
// throttle in the repo (inbound leads) piggybacks on a row-recency check this traffic doesn't
// have, and a throttle table would be heavier than the risk it buys down.

export interface FixedWindowLimiterOptions {
  /** Allowed calls per key per window. Keep generous — a real customer refreshes a few times. */
  readonly limit: number;
  readonly windowMs: number;
  /** Sweep threshold bounding the key map (default 10 000). Only EXPIRED windows are dropped. */
  readonly maxKeys?: number;
  /** Injectable clock for tests. */
  readonly now?: () => number;
}

interface Window {
  readonly count: number;
  readonly windowStart: number;
}

const DEFAULT_MAX_KEYS = 10_000;

export class FixedWindowLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(options: FixedWindowLimiterOptions) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
    this.now = options.now ?? Date.now;
  }

  /** True when the call may proceed; false when this key exhausted the current window (→ 429). */
  allow(key: string): boolean {
    const t = this.now();
    const current = this.windows.get(key);

    if (!current || t - current.windowStart >= this.windowMs) {
      if (this.windows.size >= this.maxKeys) this.sweep(t);
      this.windows.set(key, { count: 1, windowStart: t });
      return true;
    }

    if (current.count >= this.limit) return false;
    // New object, not an in-place bump — live windows are never mutated.
    this.windows.set(key, { count: current.count + 1, windowStart: current.windowStart });
    return true;
  }

  /** Number of tracked keys — exposed for the memory-bound test only. */
  get size(): number {
    return this.windows.size;
  }

  // Drop EXPIRED windows only. Live windows always survive: an attacker flooding the map with
  // fresh keys must never evict (and thereby reset) someone else's active count — that would be
  // an un-throttle primitive. Worst case the map holds maxKeys live entries for one windowMs.
  private sweep(t: number): void {
    for (const [key, w] of this.windows) {
      if (t - w.windowStart >= this.windowMs) this.windows.delete(key);
    }
  }
}
