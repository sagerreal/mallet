import { CircuitOpenError } from "./errors";

export type BreakerState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  readonly failureThreshold: number; // consecutive failures before opening
  readonly resetMs: number; // cool-down before a half-open trial
  readonly now?: () => number; // injectable clock for tests
}

// Per-dependency circuit breaker. After `failureThreshold` consecutive failures it opens and
// fails fast (no call) for `resetMs`; then it half-opens to let one trial through — success
// closes it, another failure re-opens it. Stops hammering a dependency that is clearly down.
export class CircuitBreaker {
  private failures = 0;
  private state: BreakerState = "closed";
  private openedAt = 0;
  private readonly now: () => number;

  constructor(
    private readonly key: string,
    private readonly opts: CircuitBreakerOptions,
  ) {
    this.now = opts.now ?? Date.now;
  }

  get state_(): BreakerState {
    return this.snapshot();
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.snapshot() === "open") throw new CircuitOpenError(this.key);
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  // Promote open → half_open once the cool-down has elapsed.
  private snapshot(): BreakerState {
    if (this.state === "open" && this.now() - this.openedAt >= this.opts.resetMs) {
      this.state = "half_open";
    }
    return this.state;
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = "closed";
  }

  private onFailure(): void {
    this.failures += 1;
    if (this.state === "half_open" || this.failures >= this.opts.failureThreshold) {
      this.state = "open";
      this.openedAt = this.now();
    }
  }
}
