import type { OrgId, UserId, Result, AppError, Clock } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { ok, err, validation, notFound } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { TeamThread, dmKeyFor } from "../domain/team-thread";
import type { TeamChatRepository } from "../domain/team-chat-repository";

export interface StartDmCmd {
  readonly orgId: OrgId;
  readonly meUserId: UserId;
  readonly otherUserId: UserId;
}

/**
 * Open the DM with someone — find-or-create, never fork.
 *
 * The dm_key is the two ids SORTED, so whoever taps first lands on the same conversation. If two
 * people tap simultaneously the unique index decides, and the loser re-reads the winner's thread
 * rather than failing: opening a chat is not an operation a person should be able to lose.
 */
export class StartDmUseCase {
  constructor(
    private readonly repo: TeamChatRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: StartDmCmd): Promise<Result<TeamThread, AppError>> {
    if (cmd.otherUserId === cmd.meUserId) {
      return err(validation("pick a teammate to message", "otherUserId"));
    }

    // The other person must be real and in THIS org. The repo's filter is org-scoped, so a
    // stranger's id simply does not come back.
    const existing = await this.repo.filterExistingUserIds([cmd.otherUserId]);
    if (existing.length === 0) return err(notFound("that teammate is not in this shop"));

    const dmKey = dmKeyFor(cmd.meUserId, cmd.otherUserId);
    const now = this.clock.now();
    const found = await this.repo.findThreadByDmKey(dmKey);
    if (found) {
      // Re-admit anyone who had left. Without this, leaving a DM stranded you: the thread still
      // exists, so find-or-create hands it straight back — and every read on it then refuses,
      // because the membership row says you are gone. A DM between two people is not a room you
      // can be outside of while it is still open to you.
      const missing: UserId[] = [];
      for (const userId of [cmd.meUserId, cmd.otherUserId]) {
        if (!(await this.repo.isMember(found.props.id, userId))) missing.push(userId);
      }
      if (missing.length > 0) await this.repo.addMembers(found.props.id, missing, now);
      return ok(found);
    }

    const thread = TeamThread.create({
      id: this.ids.newId(),
      orgId: cmd.orgId,
      kind: "dm",
      title: null,
      dmKey,
      jobId: null,
      createdByUserId: cmd.meUserId,
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });
    if (!thread.ok) return thread;

    try {
      const created = await this.repo.createThread({
        thread: thread.value,
        memberUserIds: [cmd.meUserId, cmd.otherUserId],
      });
      logger.info({ orgId: cmd.orgId, threadId: created.props.id }, "teamChat.dm_started");
      return ok(created);
    } catch (error: unknown) {
      // Lost the race on team_threads_org_dmkey_uidx: the other person's tap created it first.
      // Their thread is the right answer, so return it rather than surfacing a conflict.
      const raced = await this.repo.findThreadByDmKey(dmKey);
      if (raced) return ok(raced);
      throw error;
    }
  }
}
