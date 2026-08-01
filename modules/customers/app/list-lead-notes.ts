import type { LeadId } from "@mallet/shared/types";
import type { LeadNote } from "../domain/lead-note";
import type { LeadNoteRepository } from "../domain/lead-note-repository";

// Thin read use-case: one customer's activity trail, oldest first. Tenant scoping is enforced by
// the org-scoped transaction the repository runs in, not by a parameter here.
export class ListLeadNotesUseCase {
  constructor(private readonly notes: LeadNoteRepository) {}

  exec(leadId: LeadId): Promise<LeadNote[]> {
    return this.notes.listByLead(leadId);
  }
}
