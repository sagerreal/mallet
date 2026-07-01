import type { OrgId } from "@mallet/shared/types";

// A JSON-safe value. The payload is persisted to the outbox as jsonb (bare JSON.stringify), so it
// must exclude `undefined` (dropped silently), `Date`/`BigInt` (lossy or throws), and class
// instances. Branded ids and Money are runtime strings/numbers, so they satisfy this. Pre-serialize
// a Date to an ISO string (e.g. `dueAt?.toISOString() ?? null`) before putting it in a payload.
export type JsonValue = string | number | boolean | null | JsonValue[] | { readonly [key: string]: JsonValue };

// A domain event — something that happened, named in past tense. Use-cases emit these
// after a successful state change so other parts of the system can react without being
// called directly (decoupling). The payload is a durable, versionless contract (it is persisted to
// the outbox), so it is constrained to JSON-safe values — a compile error catches an accidental
// Date/undefined at the emit site rather than a lossy row at read time.
export interface DomainEvent {
  readonly name: string;
  readonly orgId: OrgId;
  readonly payload: Readonly<Record<string, JsonValue>>;
  readonly occurredAt: Date;
}

export interface EventBus {
  emit(event: DomainEvent): Promise<void>;
}

// Default binding for unit tests and early phases: records emitted events in memory.
// Swapped for a durable transactional-outbox implementation later.
export class InMemoryEventBus implements EventBus {
  private readonly events: DomainEvent[] = [];

  async emit(event: DomainEvent): Promise<void> {
    this.events.push(event);
  }

  get recorded(): readonly DomainEvent[] {
    return this.events;
  }
}
