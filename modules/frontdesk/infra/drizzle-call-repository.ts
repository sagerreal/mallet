import { and, desc, eq, isNull } from "drizzle-orm";
import { frontdeskCalls } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId, LeadId, CursorPage } from "@mallet/shared/types";
import type {
  FrontdeskCallRepository,
  RecordCallInput,
  StartCallInput,
  CallSummary,
} from "../domain/call-record";
import { toCallSummary } from "./call-mapper";

// Real persistence for front-desk calls. Constructed with a tenant-scoped transaction
// (withTenant already set app.current_org_id), so RLS appends `org_id = current_org_id()` to
// every statement. The explicit eq(this.orgId) filter on reads is defense-in-depth on top of
// RLS (and keeps the tenant boundary visible in the SQL + drives index use); orgId is stamped
// on writes. All tenant-scoped — ownerDb is not used here.
export class DrizzleFrontdeskCallRepository implements FrontdeskCallRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  // Skeleton row on assistant-request. ON CONFLICT (org_id, vapi_call_id) DO NOTHING: a Vapi
  // retry of assistant-request (or a race with the end-of-call write) leaves the row untouched.
  async upsertInboundStart(input: StartCallInput): Promise<void> {
    await this.tx
      .insert(frontdeskCalls)
      .values({
        orgId: this.orgId,
        leadId: input.leadId,
        vapiCallId: input.vapiCallId,
        fromNumber: input.fromNumber,
        toNumber: input.toNumber,
        startedAt: input.startedAt,
      })
      .onConflictDoNothing({ target: [frontdeskCalls.orgId, frontdeskCalls.vapiCallId] });
  }

  // End-of-call-report. Upsert on the (org_id, vapi_call_id) unique index: updates the skeleton
  // row seeded by upsertInboundStart if present, else inserts (a call that ended before any
  // skeleton write still persists). Only end-of-call fields are set on conflict — the skeleton's
  // from/to/started stay put.
  async recordEndOfCall(input: RecordCallInput): Promise<void> {
    await this.tx
      .insert(frontdeskCalls)
      .values({
        orgId: this.orgId,
        leadId: input.leadId,
        vapiCallId: input.vapiCallId,
        fromNumber: input.fromNumber,
        toNumber: input.toNumber,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        endedReason: input.endedReason,
        transcript: input.transcript,
        messages: input.messages ?? null,
        recordingUrl: input.recordingUrl,
        summary: input.summary,
        disposition: input.disposition,
        priceAudit: input.priceAudit ?? null,
      })
      .onConflictDoUpdate({
        target: [frontdeskCalls.orgId, frontdeskCalls.vapiCallId],
        set: {
          // Fill the lead match if it was resolved by end-of-call (skeleton may have had null).
          leadId: input.leadId,
          endedAt: input.endedAt,
          endedReason: input.endedReason,
          transcript: input.transcript,
          messages: input.messages ?? null,
          recordingUrl: input.recordingUrl,
          summary: input.summary,
          disposition: input.disposition,
          priceAudit: input.priceAudit ?? null,
        },
      });
  }

  // Whether the stored row for this call was ALREADY price-flagged (non-empty priceAudit.flagged).
  // Read BEFORE the end-of-call upsert overwrites priceAudit, so the use-case can file the price-
  // review task ONCE (a Vapi end-of-call retry finds the row already flagged and skips the duplicate
  // CreateTask). No row yet, or an empty/absent audit → false.
  async wasPriceFlagged(vapiCallId: string): Promise<boolean> {
    const rows = await this.tx
      .select({ priceAudit: frontdeskCalls.priceAudit })
      .from(frontdeskCalls)
      .where(and(eq(frontdeskCalls.orgId, this.orgId), eq(frontdeskCalls.vapiCallId, vapiCallId)))
      .limit(1);
    const audit = rows[0]?.priceAudit;
    if (!audit || typeof audit !== "object") return false;
    const flagged = (audit as { flagged?: unknown }).flagged;
    return Array.isArray(flagged) && flagged.length > 0;
  }

  // Office surface (PR C). Newest-first non-deleted calls for one lead within the current org.
  async listByLead(leadId: LeadId): Promise<CallSummary[]> {
    const rows = await this.tx
      .select()
      .from(frontdeskCalls)
      .where(
        and(
          eq(frontdeskCalls.orgId, this.orgId),
          eq(frontdeskCalls.leadId, leadId),
          isNull(frontdeskCalls.deletedAt),
        ),
      )
      .orderBy(desc(frontdeskCalls.createdAt));
    return rows.map(toCallSummary);
  }

  // Office surface (PR C). Newest-first non-deleted calls for the org, capped by page.limit.
  // Cursor keyset paging lands with the router in PR C; the limit clamp already applies here.
  async listRecent(page: CursorPage): Promise<CallSummary[]> {
    const rows = await this.tx
      .select()
      .from(frontdeskCalls)
      .where(and(eq(frontdeskCalls.orgId, this.orgId), isNull(frontdeskCalls.deletedAt)))
      .orderBy(desc(frontdeskCalls.createdAt))
      .limit(page.limit);
    return rows.map(toCallSummary);
  }
}
