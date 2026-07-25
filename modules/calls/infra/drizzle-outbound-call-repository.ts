import { and, eq, isNull } from "drizzle-orm";
import { outboundCalls } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId, OutboundCallId } from "@mallet/shared/types";
import type { OutboundCall } from "../domain/outbound-call";
import type { OutboundCallRepository } from "../domain/outbound-call-repository";
import { toDomain } from "./outbound-call-mapper";

// Real persistence. Constructed with a tenant-scoped transaction (withTenant already set
// app.current_org_id), so RLS appends `org_id = current_org_id()` to every statement; the
// explicit eq(orgId) filters are defense-in-depth and keep the org-leading indexes in use.
export class DrizzleOutboundCallRepository implements OutboundCallRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async create(call: OutboundCall): Promise<OutboundCall> {
    const p = call.props;
    const rows = await this.tx
      .insert(outboundCalls)
      .values({
        id: p.id,
        orgId: this.orgId,
        leadId: p.leadId,
        placedByUserId: p.placedByUserId,
        toNumber: p.toNumber,
        fromNumber: p.fromNumber,
        agentNumber: p.agentNumber,
        transport: p.transport,
        status: p.status,
        providerCallSid: p.providerCallSid,
        startedAt: p.startedAt,
        endedAt: p.endedAt,
        durationSec: p.durationSec,
        outcome: p.outcome,
        notes: p.notes,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })
      .returning();
    return toDomain(rows[0]!);
  }

  async findById(id: OutboundCallId): Promise<OutboundCall | null> {
    const rows = await this.tx
      .select()
      .from(outboundCalls)
      .where(
        and(
          eq(outboundCalls.orgId, this.orgId),
          eq(outboundCalls.id, id),
          isNull(outboundCalls.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async findByProviderSid(providerCallSid: string): Promise<OutboundCall | null> {
    const rows = await this.tx
      .select()
      .from(outboundCalls)
      .where(
        and(
          eq(outboundCalls.orgId, this.orgId),
          eq(outboundCalls.providerCallSid, providerCallSid),
          isNull(outboundCalls.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ? toDomain(rows[0]) : null;
  }

  async save(call: OutboundCall): Promise<OutboundCall | null> {
    const p = call.props;
    const rows = await this.tx
      .update(outboundCalls)
      .set({
        status: p.status,
        providerCallSid: p.providerCallSid,
        startedAt: p.startedAt,
        endedAt: p.endedAt,
        durationSec: p.durationSec,
        outcome: p.outcome,
        notes: p.notes,
        updatedAt: p.updatedAt,
      })
      .where(
        and(
          eq(outboundCalls.orgId, this.orgId),
          eq(outboundCalls.id, p.id),
          isNull(outboundCalls.deletedAt),
        ),
      )
      .returning();
    return rows[0] ? toDomain(rows[0]) : null;
  }
}
