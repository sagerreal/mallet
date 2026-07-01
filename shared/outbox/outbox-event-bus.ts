import { outbox } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import type { DomainEvent, EventBus } from "@mallet/shared/ports";

// The transactional-outbox binding of the EventBus port. Writes each emitted event to the `outbox`
// table INSIDE the caller's tenant transaction, so the event commits atomically with the state
// change that produced it — never lost on a crash, never emitted for a rolled-back operation. RLS
// scopes the insert to the tenant (WITH CHECK org_id = current_org_id()), so an event stamped with a
// foreign org id is rejected and rolls the whole tx back (fail-closed). A background relay drains
// unpublished rows and dispatches each under withTenant(org_id).
export class OutboxEventBus implements EventBus {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async emit(event: DomainEvent): Promise<void> {
    await this.tx.insert(outbox).values({
      orgId: event.orgId,
      eventName: event.name,
      payload: event.payload,
      occurredAt: event.occurredAt,
    });
  }
}
