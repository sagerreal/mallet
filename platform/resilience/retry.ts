import { CircuitOpenError } from "./errors";

export interface RetryOptions {
  readonly retries: number; // max attempts AFTER the first
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly shouldRetry?: (error: unknown) => boolean;
  // Injectable for deterministic tests; default to real timers / Math.random.
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Don't retry a circuit that is already open — that just burns attempts.
const defaultShouldRetry = (error: unknown): boolean => !(error instanceof CircuitOpenError);

// Retry with exponential backoff + jitter. Jitter (50–100% of the computed backoff) spreads
// retries so a fleet doesn't synchronize a thundering herd against a recovering dependency.
export const withRetry = async <T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> => {
  const baseDelayMs = opts.baseDelayMs ?? 50;
  const maxDelayMs = opts.maxDelayMs ?? 2_000;
  const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;
  const sleep = opts.sleep ?? realSleep;
  const random = opts.random ?? Math.random;

  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= opts.retries || !shouldRetry(error)) throw error;
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
      await sleep(backoff * (0.5 + random() * 0.5));
      attempt += 1;
    }
  }
};
