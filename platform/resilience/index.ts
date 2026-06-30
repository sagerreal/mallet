// Public surface of the resilience toolkit — wrap every outbound call to an external service.
export { TimeoutError, CircuitOpenError } from "./errors";
export { withTimeout } from "./timeout";
export { withRetry, type RetryOptions } from "./retry";
export { CircuitBreaker, type BreakerState, type CircuitBreakerOptions } from "./circuit-breaker";
export {
  InMemoryIdempotencyStore,
  type IdempotencyStore,
} from "./idempotency";
export { call, type CallOptions } from "./resilient-call";
