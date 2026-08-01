import type { Result, AppError } from "@mallet/shared/types";
import { err, ok, notFound } from "@mallet/shared/types";
import type { LeadNoteRepository } from "../domain/lead-note-repository";

/**
 * Soft-delete one note.
 *
 * Exists because the home queue's Send offers a 30-second Undo: the send appends a note
 * immediately, and taking it back has to remove that exact row — otherwise the next refetch
 * resurrects a record of a message the shop retracted.
 */
export class RemoveLeadNoteUseCase {
  constructor(private readonly notes: LeadNoteRepository) {}

  async exec(id: string): Promise<Result<true, AppError>> {
    const removed = await this.notes.remove(id);
    // The repository filters by org, so "no row" also covers another tenant's id — the caller
    // learns nothing either way, which is the point.
    if (!removed) return err(notFound("that note no longer exists"));
    return ok(true);
  }
}
