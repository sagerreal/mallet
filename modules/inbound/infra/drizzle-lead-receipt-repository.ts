import { and, eq } from "drizzle-orm";
import { inboundLeadReceipts } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import type { LeadReceiptRepository } from "../domain/inbound-ports";
import type { Channel } from "../domain/channel";

// Idempotency ledger (runs under withTenant), used as a record-first LOCK. Marketplace webhooks
// retry; reserving (org, channel, external_id) before the create means a repeat delivery is
// rejected up front rather than after a create has already happened.
export class DrizzleLeadReceiptRepository implements LeadReceiptRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  // INSERT the reservation; a returned row means THIS caller reserved it (new). Empty on conflict.
  async reserve(channel: Channel, externalId: string): Promise<boolean> {
    const rows = await this.tx.insert(inboundLeadReceipts)
      .values({ orgId: this.orgId, channel, externalId })
      .onConflictDoNothing({ target: [inboundLeadReceipts.orgId, inboundLeadReceipts.channel, inboundLeadReceipts.externalId] })
      .returning({ id: inboundLeadReceipts.id });
    return rows.length > 0;
  }

  async release(channel: Channel, externalId: string): Promise<void> {
    await this.tx.delete(inboundLeadReceipts).where(
      and(
        eq(inboundLeadReceipts.orgId, this.orgId),
        eq(inboundLeadReceipts.channel, channel),
        eq(inboundLeadReceipts.externalId, externalId),
      ),
    );
  }
}
