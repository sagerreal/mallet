import type { UserId, Result, AppError, Clock } from "@mallet/shared/types";
import { ok, err, notFound, validation } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { MAX_GROUP_MEMBERS } from "../domain/team-thread";
import type { TeamChatRepository } from "../domain/team-chat-repository";

export interface AddMembersCmd {
  readonly threadId: string;
  readonly meUserId: UserId;
  readonly addUserIds: readonly UserId[];
}

/**
 * Add people to a group. Any member can add — a shop is not a permissions hierarchy, and the
 * office is not always the person who knows the second tech is needed.
 *
 * This is the capability Housecall Pro documents itself as NOT having ("once the chat thread is
 * created, you cannot add or remove members"), which is why it exists in v1 rather than later.
 * DMs are exempt: adding a third person to a two-person conversation is a new group, not an edit.
 */
export class AddGroupMembersUseCase {
  constructor(
    private readonly repo: TeamChatRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: AddMembersCmd): Promise<Result<{ added: number }, AppError>> {
    const member = await this.repo.isMember(cmd.threadId, cmd.meUserId);
    if (!member) return err(notFound("that conversation is not one of yours"));

    const thread = await this.repo.findThreadById(cmd.threadId);
    if (!thread) return err(notFound("that conversation is not one of yours"));
    if (thread.props.kind === "dm") {
      return err(validation("start a group to include more people", "threadId"));
    }

    const requested = [...new Set(cmd.addUserIds)];
    if (requested.length === 0) return err(validation("pick a teammate to add", "addUserIds"));
    if (requested.length > MAX_GROUP_MEMBERS) {
      return err(validation(`a group holds up to ${MAX_GROUP_MEMBERS} people`, "addUserIds"));
    }

    const real = await this.repo.filterExistingUserIds(requested);
    if (real.length !== requested.length) {
      return err(validation("one of those teammates is not in this shop", "addUserIds"));
    }

    await this.repo.addMembers(cmd.threadId, real, this.clock.now());
    logger.info({ threadId: cmd.threadId, added: real.length }, "teamChat.members_added");
    return ok({ added: real.length });
  }
}

export interface LeaveThreadCmd {
  readonly threadId: string;
  readonly meUserId: UserId;
}

/**
 * Leave a conversation. The membership row stays, stamped with left_at, so the thread can still
 * say who was in it when something was said — and a re-add is an upsert rather than a duplicate.
 */
export class LeaveTeamThreadUseCase {
  constructor(
    private readonly repo: TeamChatRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: LeaveThreadCmd): Promise<Result<{ left: boolean }, AppError>> {
    const left = await this.repo.leaveThread(cmd.threadId, cmd.meUserId, this.clock.now());
    if (!left) return err(notFound("that conversation is not one of yours"));
    return ok({ left });
  }
}
