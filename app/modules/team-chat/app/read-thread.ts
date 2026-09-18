import type { UserId, Result, AppError, Clock } from "@mallet/shared/types";
import { ok, err, notFound } from "@mallet/shared/types";
import type { TeamMessage } from "../domain/team-message";
import type { TeamChatRepository, ThreadListRow } from "../domain/team-chat-repository";

/** One page of a thread. 50 is a couple of screens — enough to open into, cheap to fetch. */
export const THREAD_PAGE_LIMIT = 50;

export interface ListThreadsQuery {
  readonly meUserId: UserId;
}

/** The staff inbox: my threads, newest activity first, with my own unread counts. */
export class ListTeamThreadsUseCase {
  constructor(private readonly repo: TeamChatRepository) {}

  exec(query: ListThreadsQuery): Promise<ThreadListRow[]> {
    return this.repo.listThreadsForUser(query.meUserId);
  }
}

export interface ReadThreadQuery {
  readonly threadId: string;
  readonly meUserId: UserId;
  readonly limit?: number;
  /** Keyset: fetch the page immediately BEFORE this instant (scrolling up through history). */
  readonly before?: Date;
}

/** A page of a thread I am in. Not-found for a non-member — never confirms the thread exists. */
export class ReadTeamThreadUseCase {
  constructor(private readonly repo: TeamChatRepository) {}

  async exec(query: ReadThreadQuery): Promise<Result<TeamMessage[], AppError>> {
    const member = await this.repo.isMember(query.threadId, query.meUserId);
    if (!member) return err(notFound("that conversation is not one of yours"));
    const messages = await this.repo.listMessages(query.threadId, {
      limit: Math.min(query.limit ?? THREAD_PAGE_LIMIT, THREAD_PAGE_LIMIT),
      before: query.before,
    });
    return ok(messages);
  }
}

export interface MarkReadCmd {
  readonly threadId: string;
  readonly meUserId: UserId;
}

/**
 * Move my read cursor to now. Per-USER, unlike the customer inbox's shared flag — one person
 * opening a group must not clear the badge for everyone else in it (the exact complaint Workiz
 * users have about their shared inbox).
 */
export class MarkTeamThreadReadUseCase {
  constructor(
    private readonly repo: TeamChatRepository,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: MarkReadCmd): Promise<Result<{ cleared: boolean }, AppError>> {
    const cleared = await this.repo.markRead(cmd.threadId, cmd.meUserId, this.clock.now());
    if (!cleared) return err(notFound("that conversation is not one of yours"));
    return ok({ cleared });
  }
}
