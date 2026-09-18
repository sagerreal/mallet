import type { LeadId, UserId } from "@mallet/shared/types";
import type { ConversationRow } from "../domain/message-repository";
import type { MessageRepository } from "../domain/message-repository";

export interface ListConversationsCmd {
  // When set, only the thread for this lead is returned.
  readonly leadId?: LeadId;
  // The tech scope: only threads for customers with a job or visit assigned to this user.
  // The office omits it and sees every thread.
  readonly assignedToUserId?: UserId;
}

// Returns one ConversationRow per lead that has at least one non-deleted message, sorted
// newest-first (by the lead's most-recent message). Delegates the single efficient query
// to the repo; no application-layer logic transforms the result.
export class ListConversationsUseCase {
  constructor(private readonly repo: MessageRepository) {}

  async exec(cmd: ListConversationsCmd): Promise<ConversationRow[]> {
    const filter =
      cmd.leadId != null || cmd.assignedToUserId != null
        ? { leadId: cmd.leadId, assignedToUserId: cmd.assignedToUserId }
        : undefined;
    return this.repo.listConversations(filter);
  }
}
