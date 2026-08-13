import type { OrgId, UserId, Result, AppError, Clock } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { ok, err, validation } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { TeamThread, MAX_GROUP_MEMBERS } from "../domain/team-thread";
import type { TeamChatRepository } from "../domain/team-chat-repository";

export interface CreateGroupCmd {
  readonly orgId: OrgId;
  readonly meUserId: UserId;
  readonly title: string;
  /** Everyone else to add. The creator is always in, whether or not they list themselves. */
  readonly memberUserIds: readonly UserId[];
}

/**
 * Start a named group.
 *
 * Membership stays editable afterwards (see AddGroupMembersUseCase) — deliberately unlike
 * Housecall Pro, which freezes a thread's members at creation. Crews reshuffle weekly; a group
 * you cannot add the new guy to is a group the shop stops using.
 */
export class CreateGroupUseCase {
  constructor(
    private readonly repo: TeamChatRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: CreateGroupCmd): Promise<Result<TeamThread, AppError>> {
    // Dedupe, and always include the creator: a group its author cannot read would be
    // unreachable the moment it existed.
    const requested = [...new Set(cmd.memberUserIds.filter((id) => id !== cmd.meUserId))];
    if (requested.length === 0) {
      return err(validation("add at least one teammate to the group", "memberUserIds"));
    }
    if (requested.length + 1 > MAX_GROUP_MEMBERS) {
      return err(validation(`a group holds up to ${MAX_GROUP_MEMBERS} people`, "memberUserIds"));
    }

    // Silently dropping unknown ids would create a group quietly missing someone the office
    // believed they added, so an id that is not in this org is an error, not a filter.
    const real = await this.repo.filterExistingUserIds(requested);
    if (real.length !== requested.length) {
      return err(validation("one of those teammates is not in this shop", "memberUserIds"));
    }

    const now = this.clock.now();
    const thread = TeamThread.create({
      id: this.ids.newId(),
      orgId: cmd.orgId,
      kind: "group",
      title: cmd.title,
      dmKey: null,
      jobId: null,
      createdByUserId: cmd.meUserId,
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });
    if (!thread.ok) return thread;

    const created = await this.repo.createThread({
      thread: thread.value,
      memberUserIds: [cmd.meUserId, ...real],
    });
    logger.info(
      { orgId: cmd.orgId, threadId: created.props.id, members: real.length + 1 },
      "teamChat.group_created",
    );
    return ok(created);
  }
}
