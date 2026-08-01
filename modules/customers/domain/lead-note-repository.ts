import type { LeadId } from "@mallet/shared/types";
import type { LeadNote } from "./lead-note";

/**
 * The customer activity trail's persistence port.
 *
 * The org is NEVER a parameter — it is implicit in the org-scoped transaction the repository is
 * constructed with, so a caller can physically not address another tenant's data.
 */
export interface LeadNoteRepository {
  /** Insert one note. The id is client-authored so the caller already holds it (see add-lead-note). */
  add(note: LeadNote): Promise<LeadNote>;
  /** One customer's trail, oldest first — the order the feed renders. Excludes soft-deleted. */
  listByLead(leadId: LeadId): Promise<LeadNote[]>;
  /** Soft-delete. Returns false when the id matches nothing in this org. */
  remove(id: string): Promise<boolean>;
}
