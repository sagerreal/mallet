// Dedupes retryable operations by key so an at-least-once trigger (webhook, queue redelivery,
// client retry) executes the effect at most once. In-memory for now; a durable Postgres-backed
// store (the idempotency_keys table) replaces it when webhooks/payments land.
export interface IdempotencyStore {
  once<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly inflight = new Map<string, Promise<unknown>>();

  once<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = fn();
    this.inflight.set(key, promise);
    // Evict on failure so a later retry can re-run; successes stay cached for the dedupe window.
    promise.catch(() => this.inflight.delete(key));
    return promise;
  }
}
