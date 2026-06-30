import { withTimeout } from "./timeout";
import { withRetry } from "./retry";
import type { CircuitBreaker } from "./circuit-breaker";

export interface CallOptions {
  readonly timeoutMs?: number;
  readonly retries?: number;
  // Only idempotent operations are retried — re-running a non-idempotent call (e.g. a charge)
  // could double-execute its side effect.
  readonly idempotent?: boolean;
  readonly breaker?: CircuitBreaker;
  readonly shouldRetry?: (error: unknown) => boolean;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

// The one entry point for outbound calls to external services (Stripe, Twilio, Claude, QBO).
// Composes timeout → circuit breaker → retry so every adapter gets the same resilience policy
// instead of hand-rolling it. The operation receives an AbortSignal for cooperative cancellation.
export const call = <T>(
  fn: (signal: AbortSignal) => Promise<T>,
  opts: CallOptions = {},
): Promise<T> => {
  const runOnce = (): Promise<T> => {
    const timed = opts.timeoutMs
      ? () => withTimeout(fn, opts.timeoutMs as number)
      : () => fn(new AbortController().signal);
    return opts.breaker ? opts.breaker.exec(timed) : timed();
  };

  // Retries only when the caller declares the operation idempotent.
  const retries = opts.idempotent ? (opts.retries ?? 0) : 0;
  return withRetry(runOnce, {
    retries,
    shouldRetry: opts.shouldRetry,
    sleep: opts.sleep,
    random: opts.random,
  });
};
