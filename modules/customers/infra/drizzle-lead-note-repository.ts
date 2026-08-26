import { and, asc, eq, isNull } from "drizzle-orm";
import { leadNotes } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId, LeadId } from "@mallet/shared/types";
import type { LeadNote } from "../domain/lead-note";
import type { LeadNoteRepository } from "../domain/lead-note-repository";
import { toDomain } from "./lead-note-mapper";

// Real persistence. Constructed with a tenant-scoped transaction (withTenant already set
// app.current_org_id), so RLS appends `org_id = current_org_id()` to every statement. The
// explicit eq(orgId) filters below are defence-in-depth AND what lets the composite index serve
// the read — they are not the isolation mechanism.
export class DrizzleLeadNoteRepository implements LeadNoteRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async add(note: LeadNote): Promise<LeadNote> {
    const p = note.props;
    const [row] = await this.tx
      .insert(leadNotes)
      .values({
        id: p.id,
        orgId: this.orgId,
        leadId: p.leadId,
        kind: p.kind,
        body: p.body,
        author: p.author,
        direction: p.direction,
        outcome: p.outcome,
        durationLabel: p.durationLabel,
        via: p.via,
        overnight: p.overnight,
        // The attachment key, its mime and its display name. `?? null` because the props are
        // optional and drizzle would omit an undefined key — leaving the column to its default
        // rather than writing the null the check constraint reads as "no attachment".
        attachmentPath: p.attachmentPath ?? null,
        attachmentType: p.attachmentType ?? null,
        attachmentName: p.attachmentName ?? null,
        createdAt: p.createdAt,
      })
      .returning();
    if (!row) throw new Error("lead note insert returned no row");
    return toDomain(row);
  }

  async listByLead(leadId: LeadId): Promise<LeadNote[]> {
    const rows = await this.tx
      .select()
      .from(leadNotes)
      .where(
        and(
          eq(leadNotes.orgId, this.orgId),
          eq(leadNotes.leadId, leadId),
          isNull(leadNotes.deletedAt),
        ),
      )
      // Oldest first — the order the feed renders, newest at the bottom next to the composer.
      .orderBy(asc(leadNotes.createdAt));
    return rows.map(toDomain);
  }

  async remove(id: string): Promise<boolean> {
    // Soft-delete only (house rule): never hard-delete tenant data. Already-deleted rows are
    // excluded so a repeated Undo reports honestly instead of claiming a second success.
    const removed = await this.tx
      .update(leadNotes)
      .set({ deletedAt: new Date() })
      .where(
        and(eq(leadNotes.orgId, this.orgId), eq(leadNotes.id, id), isNull(leadNotes.deletedAt)),
      )
      .returning({ id: leadNotes.id });
    return removed.length > 0;
  }
}
