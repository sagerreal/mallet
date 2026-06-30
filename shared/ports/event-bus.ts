import type { OrgId } from "@mallet/shared/types";

// A domain event — something that happened, named in past tense. Use-cases emit these
// after a successful state change so other parts of the system can react without being
// called directly (decoupling). Delivery guarantees (outbox, Inngest) come in a later phase;
// the port is defined now so use-cases never depend on the transport.
export interface DomainEvent {
  readonly name: string;
  readonly orgId: OrgId;
  readonly payload: Readonly<Record<string, unknown>>;
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
