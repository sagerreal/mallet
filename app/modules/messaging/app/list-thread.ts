import type { LeadId } from "@mallet/shared/types";
import type { Message } from "../domain/message";
import type { MessageRepository } from "../domain/message-repository";

export interface ListThreadCmd {
  readonly leadId: LeadId;
  readonly limit?: number;
  readonly offset?: number;
}

// Return the full SMS thread for a lead, oldest-first (chronological), with a simple
// limit/offset page. The default limit keeps payloads small; callers set a higher limit
// to load history.
export class ListThreadUseCase {
  constructor(private readonly repo: MessageRepository) {}

  async exec(cmd: ListThreadCmd): Promise<Message[]> {
    return this.repo.listByLead(cmd.leadId, {
      limit: cmd.limit ?? 50,
      offset: cmd.offset ?? 0,
    });
  }
}
