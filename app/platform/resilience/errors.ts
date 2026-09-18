// Failure types the resilience primitives raise. Distinct classes so callers (and the retry
// policy) can branch on them.
export class TimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`operation timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
}

export class CircuitOpenError extends Error {
  constructor(public readonly breakerKey: string) {
    super(`circuit breaker "${breakerKey}" is open`);
    this.name = "CircuitOpenError";
  }
}
