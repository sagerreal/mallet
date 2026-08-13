import type { UserId } from "@mallet/shared/types";
import type { TeamThread, ThreadKind } from "./team-thread";
import type { TeamMessage } from "./team-message";

/** A person in a thread, named for display. */
export interface ThreadMember {
  readonly userId: UserId;
  readonly name: string;
}

/** One row of the staff inbox: the thread, its last line, and how much of it I have not read. */
export interface ThreadListRow {
  readonly id: string;
  readonly kind: ThreadKind;
  /** Group name; null for a DM (the UI names a DM after the other person). */
  readonly title: string | null;
  readonly lastMessageAt: Date;
  readonly lastBody: string;
  readonly lastAuthorUserId: UserId | null;
  readonly lastHadAttachment: boolean;
  /** Messages after my read cursor that I did not write. */
  readonly unreadCount: number;
  readonly members: readonly ThreadMember[];
}

export interface CreateThreadCmd {
  readonly thread: TeamThread;
  /** Everyone who starts in the thread, creator included. Deduped by the caller. */
  readonly memberUserIds: readonly UserId[];
}

/**
 * Staff-chat persistence.
 *
 * The org is NEVER a parameter — it is implicit in the org-scoped transaction the repository
 * is constructed with, so a caller physically cannot address another tenant's threads.
 */
export interface TeamChatRepository {
  /** The thread, or null when it does not exist / is soft-deleted / belongs to another org. */
  findThreadById(threadId: string): Promise<TeamThread | null>;
  /** The existing DM for a pair, or null. Backs find-or-create. */
  findThreadByDmKey(dmKey: string): Promise<TeamThread | null>;
  /** Insert the thread AND its member rows in one transaction. */
  createThread(cmd: CreateThreadCmd): Promise<TeamThread>;
  /**
   * Is this user currently in this thread? THE authorization primitive — every read and write
   * on a thread passes through it, and a person who has left answers false.
   */
  isMember(threadId: string, userId: UserId): Promise<boolean>;
  /** The user's inbox, newest activity first. */
  listThreadsForUser(userId: UserId): Promise<ThreadListRow[]>;
  /** A page of the thread, oldest-first (the order a chat reads). */
  listMessages(threadId: string, page: { limit: number; before?: Date }): Promise<TeamMessage[]>;
  /**
   * Append a message, bump the thread's last_message_at, and advance the AUTHOR's own read
   * cursor — you have by definition read what you just wrote, and without that every send
   * would light up the sender's own unread badge.
   */
  appendMessage(message: TeamMessage): Promise<TeamMessage>;
  /** Move a member's read cursor to `now`. False when they are not in the thread. */
  markRead(threadId: string, userId: UserId, now: Date): Promise<boolean>;
  /** Add members to a group (upsert — re-adding someone who left clears their left_at). */
  addMembers(threadId: string, userIds: readonly UserId[], now: Date): Promise<void>;
  /** Leave a thread. The membership row stays, stamped, so history keeps its cast. */
  leaveThread(threadId: string, userId: UserId, now: Date): Promise<boolean>;
  /** The user ids that exist in this org — validates a requested member list. */
  filterExistingUserIds(userIds: readonly UserId[]): Promise<UserId[]>;
}
