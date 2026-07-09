import type { LeadId } from "@mallet/shared/types";
import type { ConversationRow } from "../domain/message-repository";
import type { MessageRepository } from "../domain/message-repository";

export interface ListConversationsCmd {
  // Reserved for a future tech-scoping pass: when set, only the thread for this lead is
  // returned. Omit (or pass undefined) to return all org threads.
  readonly leadId?: LeadId;
}

// Returns one ConversationRow per lead that has at least one non-deleted message, sorted
// newest-first (by the lead's most-recent message). Delegates the single efficient query
// to the repo; no application-layer logic transforms the result.
export class ListConversationsUseCase {
  constructor(private readonly repo: MessageRepository) {}

  async exec(cmd: ListConversationsCmd): Promise<ConversationRow[]> {
    return this.repo.listConversations(
      cmd.leadId != null ? { leadId: cmd.leadId } : undefined,
    );
  }
}
