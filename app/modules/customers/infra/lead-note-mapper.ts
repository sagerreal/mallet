import { asLeadId, asOrgId } from "@mallet/shared/types";
import { leadNotes } from "@mallet/shared/db/schema";
import { LeadNote, isLeadNoteKind } from "../domain/lead-note";

// The persistence row shape, inferred from the schema. Kept distinct from the domain type:
// the mapper is the only place that knows both.
export type LeadNoteRow = typeof leadNotes.$inferSelect;

// Reconstruct a domain LeadNote from a DB row. A row that fails domain invariants is corrupt
// data, not an expected condition — fail loud rather than silently coerce.
export const toDomain = (row: LeadNoteRow): LeadNote => {
  if (!isLeadNoteKind(row.kind)) {
    throw new Error(`corrupt lead note ${row.id}: unknown kind "${row.kind}"`);
  }
  const result = LeadNote.create({
    id: row.id,
    orgId: asOrgId(row.orgId),
    leadId: asLeadId(row.leadId),
    kind: row.kind,
    body: row.body,
    author: row.author,
    direction: row.direction,
    outcome: row.outcome,
    durationLabel: row.durationLabel,
    via: row.via,
    overnight: row.overnight,
    attachmentPath: row.attachmentPath,
    attachmentType: row.attachmentType,
    attachmentName: row.attachmentName,
    createdAt: row.createdAt,
  });
  if (!result.ok) {
    throw new Error(`corrupt lead note ${row.id}: ${result.error.message}`);
  }
  return result.value;
};
