import { TimeoutError } from "./errors";

// Run an async operation under a hard deadline. The operation receives an AbortSignal so a client
// that honors it (e.g. fetch) can cancel in-flight work. Clients that ignore the signal (the Stripe
// SDK takes its own per-request `timeout` instead) still have the caller's promise reject with
// TimeoutError at the deadline — but the underlying request only stops if the client aborts it, so
// adapters wrapping such a client should ALSO set that client's own timeout to avoid orphaned work.
export const withTimeout = async <T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.race([
      fn(controller.signal),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(new TimeoutError(timeoutMs)), {
          once: true,
        });
      }),
    ]);
  } finally {
    // On success the timer is cleared before it fires, so the abort-reject promise never settles
    // (no unhandled rejection).
    clearTimeout(timer);
  }
};
