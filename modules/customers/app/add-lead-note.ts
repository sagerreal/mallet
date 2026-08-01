import type { LeadId, OrgId, Result, AppError } from "@mallet/shared/types";
import { err, ok, notFound } from "@mallet/shared/types";
import { LeadNote, type LeadNoteKind } from "../domain/lead-note";
import type { LeadNoteRepository } from "../domain/lead-note-repository";
import type { LeadRepository } from "../domain/lead-repository";

export interface AddLeadNoteInput {
  /** Client-authored: the store hands the id out synchronously so the home queue's 30s Undo can
      delete exactly the note a Send appended. The row must carry the same id. */
  readonly id: string;
  readonly orgId: OrgId;
  readonly leadId: LeadId;
  readonly kind: LeadNoteKind;
  readonly body: string;
  readonly author: string | null;
  readonly direction: string | null;
  readonly outcome: string | null;
  readonly durationLabel: string | null;
  readonly via: string | null;
  readonly overnight: boolean;
  readonly now: Date;
}

export class AddLeadNoteUseCase {
  constructor(
    private readonly notes: LeadNoteRepository,
    private readonly leads: LeadRepository,
  ) {}

  async exec(input: AddLeadNoteInput): Promise<Result<LeadNote, AppError>> {
    // The composite FK would reject a cross-tenant lead anyway, but as a bare constraint
    // violation that reaches the user as "check your connection". Name it here instead.
    const lead = await this.leads.findById(input.leadId);
    if (!lead) return err(notFound("that customer no longer exists"));

    const note = LeadNote.create({
      id: input.id,
      orgId: input.orgId,
      leadId: input.leadId,
      kind: input.kind,
      body: input.body,
      author: input.author,
      direction: input.direction,
      outcome: input.outcome,
      durationLabel: input.durationLabel,
      via: input.via,
      overnight: input.overnight,
      createdAt: input.now,
    });
    if (!note.ok) return err(note.error);

    return ok(await this.notes.add(note.value));
  }
}
