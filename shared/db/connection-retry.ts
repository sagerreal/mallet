// Supabase's session pooler (Supavisor) occasionally rejects the FIRST connection in a cold
// burst with a transient "password authentication failed" (SQLSTATE 28P01) or connect-timeout,
// which succeeds on a second attempt. These failures occur while ESTABLISHING the connection —
// before any statement runs — so retrying the whole operation cannot double a side effect.
//
// Deliberately narrow: only connection-establishment errors, a couple of attempts. A genuine
// bad-credentials failure therefore still surfaces quickly (after the few retries).

const TRANSIENT_MESSAGES = [
  "password authentication failed",
  "connect_timeout",
  "timeout expired",
  "connection timeout",
];

const TRANSIENT_CODES = new Set(["28P01", "CONNECT_TIMEOUT"]);

export const isTransientConnectionError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && TRANSIENT_CODES.has(code)) return true;
  const message = error.message.toLowerCase();
  return TRANSIENT_MESSAGES.some((m) => message.includes(m));
};

export interface ConnectionRetryOptions {
  readonly attempts?: number;
  readonly delayMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const withConnectionRetry = async <T>(
  fn: () => Promise<T>,
  options: ConnectionRetryOptions = {},
): Promise<T> => {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 150;
  const sleep = options.sleep ?? realSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!isTransientConnectionError(error)) throw error;
      lastError = error;
      if (attempt < attempts - 1) await sleep(delayMs * (attempt + 1));
    }
  }
  throw lastError;
};
