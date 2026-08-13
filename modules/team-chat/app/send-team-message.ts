import type { OrgId, UserId, Result, AppError, Clock } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { ok, err, notFound, validation } from "@mallet/shared/types";
import { TeamMessage, type ChatAttachment } from "../domain/team-message";
import type { TeamChatRepository } from "../domain/team-chat-repository";

export interface SendTeamMessageCmd {
  readonly orgId: OrgId;
  readonly threadId: string;
  readonly authorUserId: UserId;
  readonly body: string;
  /** Set when the caller uploaded a photo first — the path it landed at, plus its facts. */
  readonly attachment: ChatAttachment | null;
}

/**
 * Post to a thread.
 *
 * The membership check is FIRST and its refusal is not-found, not forbidden: a person who is not
 * in a conversation should not learn that it exists. Every read and write in this module answers
 * the same way for the same reason.
 */
export class SendTeamMessageUseCase {
  constructor(
    private readonly repo: TeamChatRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: SendTeamMessageCmd): Promise<Result<TeamMessage, AppError>> {
    const member = await this.repo.isMember(cmd.threadId, cmd.authorUserId);
    if (!member) return err(notFound("that conversation is not one of yours"));

    // The attachment path is minted server-side as <org>/<thread>/<uuid>.<ext>, so a path that
    // does not start with this thread's prefix is a client trying to graft somebody else's file
    // onto its own message — the same guard AddJobPhotoUseCase applies to job photos.
    if (cmd.attachment && !cmd.attachment.path.startsWith(`${cmd.orgId}/${cmd.threadId}/`)) {
      return err(validation("that attachment does not belong to this conversation", "attachment"));
    }

    const now = this.clock.now();
    const message = TeamMessage.create({
      id: this.ids.newId(),
      orgId: cmd.orgId,
      threadId: cmd.threadId,
      authorUserId: cmd.authorUserId,
      body: cmd.body,
      attachment: cmd.attachment,
      createdAt: now,
      updatedAt: now,
    });
    if (!message.ok) return message;

    return ok(await this.repo.appendMessage(message.value));
  }
}
