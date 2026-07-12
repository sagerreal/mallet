import { inboundLeadReceipts } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import type { LeadReceiptRepository } from "../domain/inbound-ports";
import type { Channel } from "../domain/channel";

// Idempotency ledger (runs under withTenant). Marketplace webhooks retry; a repeated
// (org, channel, external_id) must be a no-op rather than creating a duplicate lead.
export class DrizzleLeadReceiptRepository implements LeadReceiptRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  // INSERT .. ON CONFLICT DO NOTHING; a returned row means this (channel, externalId) was new.
  async recordIfNew(channel: Channel, externalId: string, leadId: string): Promise<boolean> {
    const rows = await this.tx
      .insert(inboundLeadReceipts)
      .values({ orgId: this.orgId, channel, externalId, leadId })
      .onConflictDoNothing({
        target: [inboundLeadReceipts.orgId, inboundLeadReceipts.channel, inboundLeadReceipts.externalId],
      })
      .returning({ id: inboundLeadReceipts.id });
    return rows.length > 0;
  }
}
