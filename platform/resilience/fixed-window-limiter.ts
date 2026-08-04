// Per-key fixed-window throttle for the public, unauthenticated routes (pay page, checkout,
// reconcile, quote). In-process by design: on serverless each warm instance enforces its own
// window, so this is DAMPING for abuse (Stripe-quota spam, log flooding, token probing) rather
// than a hard global cap — the hard guarantees stay where they already are (unguessable 256-bit
// tokens, the idempotent payments ledger, the shared Stripe circuit breaker). The one DB-backed
// throttle in the repo (inbound leads) piggybacks on a row-recency check this traffic doesn't
// have, and a throttle table would be heavier than the risk it buys down.
//
// The throttle must not itself become the attack surface. These endpoints are unauthenticated
// and reject an unknown token BEFORE any DB or Stripe work, so flooding never-seen keys is free
// for the attacker — both costs they could impose are capped below: memory by a real maxKeys
// ceiling (makeRoom), CPU by sweeping at most once per window.

export interface FixedWindowLimiterOptions {
  /** Allowed calls per key per window. Keep generous — a real customer refreshes a few times. */
  readonly limit: number;
  readonly windowMs: number;
  /** HARD ceiling on tracked keys (default 10 000) — enforced by eviction, not advisory. */
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
  private lastSweepAt = Number.NEGATIVE_INFINITY;
  private sweeps = 0;

  constructor(options: FixedWindowLimiterOptions) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    // A ceiling below 1 would mean "track nothing", silently disabling the throttle.
    this.maxKeys = Math.max(1, options.maxKeys ?? DEFAULT_MAX_KEYS);
    this.now = options.now ?? Date.now;
  }

  /** True when the call may proceed; false when this key exhausted the current window (→ 429). */
  allow(key: string): boolean {
    const t = this.now();
    const current = this.windows.get(key);

    // Live window — count against it. Re-`set`ting an EXISTING key does not move it in a JS
    // Map's insertion order, so the entry keeps its age rank (which makeRoom relies on).
    if (current && t - current.windowStart < this.windowMs) {
      if (current.count >= this.limit) return false;
      this.windows.set(key, { count: current.count + 1, windowStart: current.windowStart });
      return true;
    }

    // Opening a fresh window (new key, or the previous one expired). Delete first so the
    // re-insert moves this key to the BACK: insertion order then tracks window-START order
    // exactly, which is what makes oldest-eviction both O(1) and actually correct.
    if (current) this.windows.delete(key);
    this.makeRoom(t);
    this.windows.set(key, { count: 1, windowStart: t });
    return true;
  }

  /** Tracked keys. Observability/test seam — never exceeds maxKeys. */
  get size(): number {
    return this.windows.size;
  }

  /** Sweeps performed. Test seam proving the scan is rate-limited, not per-call. */
  get sweepCount(): number {
    return this.sweeps;
  }

  /**
   * Guarantee room for one more key, in O(1) amortised.
   *
   * MEMORY: maxKeys is a real ceiling. It was previously only a sweep TRIGGER — at capacity with
   * every window live, the sweep freed nothing and the insert proceeded anyway, so the map grew
   * without limit. Now if the sweep frees nothing the OLDEST entry is evicted, so an insert can
   * never push past maxKeys.
   *
   * CPU: the sweep is a full linear scan, so running it on every call past capacity was
   * quadratic (a 50k-key flood cost ~1.2B comparisons and freed nothing). It now runs at most
   * once per windowMs; the ceiling, not the sweep, is what bounds the map moment to moment.
   *
   * Why oldest-eviction is not an un-throttle primitive: eviction order is window-start order,
   * which an attacker can neither observe nor address. To reset a CHOSEN victim's counter they
   * must evict everything ahead of it — the entire map — and by the time maxKeys fresh windows
   * have been pushed through, the victim's own window has almost certainly expired anyway,
   * making the reset worthless. That is materially different from evicting an arbitrary or
   * random live window, which would hand over exactly that reset. Wholesale sweeping of live
   * windows stays forbidden for the same reason: it would reset every victim at once.
   */
  private makeRoom(t: number): void {
    if (this.windows.size < this.maxKeys) return;

    if (t - this.lastSweepAt >= this.windowMs) this.sweep(t);

    // Each pass deletes one entry so this terminates; in practice it runs at most once.
    while (this.windows.size >= this.maxKeys) {
      const oldest = this.windows.keys().next().value;
      if (oldest === undefined) return;
      this.windows.delete(oldest);
    }
  }

  // Drop EXPIRED windows only — a live window is never swept (see makeRoom).
  private sweep(t: number): void {
    this.lastSweepAt = t;
    this.sweeps += 1;
    for (const [key, w] of this.windows) {
      if (t - w.windowStart >= this.windowMs) this.windows.delete(key);
    }
  }
}
