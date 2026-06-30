import { TimeoutError } from "./errors";

// Run an async operation under a hard deadline. The operation receives an AbortSignal so a
// well-behaved client (fetch, the AWS/Stripe SDKs) can cancel in-flight work; either way the
// caller's promise rejects with TimeoutError at the deadline.
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
