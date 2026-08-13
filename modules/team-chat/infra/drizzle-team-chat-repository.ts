import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { OrgId, UserId } from "@mallet/shared/types";
import { asUserId } from "@mallet/shared/types";
import type { TenantTx } from "@mallet/shared/db/tx";
import { teamThreads, teamThreadMembers, teamMessages, users } from "@mallet/shared/db/schema";
import type { TeamThread } from "../domain/team-thread";
import type { TeamMessage } from "../domain/team-message";
import type {
  TeamChatRepository,
  CreateThreadCmd,
  ThreadListRow,
  ThreadMember,
} from "../domain/team-chat-repository";
import { threadToDomain, messageToDomain } from "./team-chat-mapper";
import { displayNameOf } from "../domain/display-name";

/**
 * Staff-chat persistence. Constructed with a tenant-scoped transaction (withTenant already set
 * app.current_org_id), so RLS appends `org_id = current_org_id()` to every statement; orgId is
 * supplied to stamp inserted rows and to guard reads explicitly (defense in depth + index use).
 *
 * Thread MEMBERSHIP is not something RLS can express — the tenant session carries an org, not a
 * user — so `isMember` is the primitive the router calls before every read and write. Keep that
 * contract: a query here that skips it is a privacy hole, not just a bug.
 */
export class DrizzleTeamChatRepository implements TeamChatRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async findThreadById(threadId: string): Promise<TeamThread | null> {
    const rows = await this.tx
      .select()
      .from(teamThreads)
      .where(
        and(
          eq(teamThreads.id, threadId),
          eq(teamThreads.orgId, this.orgId),
          isNull(teamThreads.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? threadToDomain(row) : null;
  }

  async findThreadByDmKey(dmKey: string): Promise<TeamThread | null> {
    const rows = await this.tx
      .select()
      .from(teamThreads)
      .where(
        and(
          eq(teamThreads.dmKey, dmKey),
          eq(teamThreads.orgId, this.orgId),
          isNull(teamThreads.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? threadToDomain(row) : null;
  }

  async createThread(cmd: CreateThreadCmd): Promise<TeamThread> {
    const p = cmd.thread.props;
    const inserted = await this.tx
      .insert(teamThreads)
      .values({
        id: p.id,
        orgId: this.orgId,
        kind: p.kind,
        title: p.title,
        dmKey: p.dmKey,
        jobId: p.jobId,
        createdByUserId: p.createdByUserId,
        lastMessageAt: p.lastMessageAt,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error("team thread insert returned no row");

    // Members land in the same transaction as the thread — a thread nobody is in would be
    // unreachable by every read below, which all start from membership.
    await this.tx.insert(teamThreadMembers).values(
      cmd.memberUserIds.map((userId) => ({
        orgId: this.orgId,
        threadId: p.id,
        userId,
        lastReadAt: p.createdAt,
      })),
    );

    return threadToDomain(row);
  }

  async isMember(threadId: string, userId: UserId): Promise<boolean> {
    const rows = await this.tx
      .select({ userId: teamThreadMembers.userId })
      .from(teamThreadMembers)
      .where(
        and(
          eq(teamThreadMembers.orgId, this.orgId),
          eq(teamThreadMembers.threadId, threadId),
          eq(teamThreadMembers.userId, userId),
          // Someone who left keeps their row for history but loses access.
          isNull(teamThreadMembers.leftAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /**
   * The inbox: every thread I am in, newest activity first, with its last line, its people, and
   * my unread count. Three queries, not N+1 — one for the threads, one for all their members,
   * one for all their last messages — then assembled in memory.
   */
  async listThreadsForUser(userId: UserId): Promise<ThreadListRow[]> {
    const mine = await this.tx
      .select({
        id: teamThreads.id,
        kind: teamThreads.kind,
        title: teamThreads.title,
        lastMessageAt: teamThreads.lastMessageAt,
        lastReadAt: teamThreadMembers.lastReadAt,
      })
      .from(teamThreadMembers)
      .innerJoin(
        teamThreads,
        and(
          eq(teamThreads.orgId, teamThreadMembers.orgId),
          eq(teamThreads.id, teamThreadMembers.threadId),
        ),
      )
      .where(
        and(
          eq(teamThreadMembers.orgId, this.orgId),
          eq(teamThreadMembers.userId, userId),
          isNull(teamThreadMembers.leftAt),
          isNull(teamThreads.deletedAt),
        ),
      )
      .orderBy(sql`${teamThreads.lastMessageAt} desc`);

    if (mine.length === 0) return [];
    const threadIds = mine.map((t) => t.id);

    // Everyone currently in those threads, named for display. A DM's title is rendered from
    // this list (the other person), which is why members ride the inbox row.
    const memberRows = await this.tx
      .select({
        threadId: teamThreadMembers.threadId,
        userId: teamThreadMembers.userId,
        name: users.name,
        email: users.email,
      })
      .from(teamThreadMembers)
      .innerJoin(
        users,
        and(eq(users.orgId, teamThreadMembers.orgId), eq(users.id, teamThreadMembers.userId)),
      )
      .where(
        and(
          eq(teamThreadMembers.orgId, this.orgId),
          inArray(teamThreadMembers.threadId, threadIds),
          isNull(teamThreadMembers.leftAt),
        ),
      );

    const membersByThread = new Map<string, ThreadMember[]>();
    for (const m of memberRows) {
      const list = membersByThread.get(m.threadId) ?? [];
      list.push({ userId: asUserId(m.userId), name: displayNameOf(m.name, m.email) });
      membersByThread.set(m.threadId, list);
    }

    // Last line + unread count per thread, in ONE pass over the messages of these threads.
    // DISTINCT ON picks the newest row per thread; the count is a correlated aggregate keyed on
    // this member's own cursor, excluding their own messages (you have read what you wrote).
    const summaries = await this.tx.execute<{
      threadId: string;
      lastBody: string;
      lastAuthorUserId: string | null;
      lastHadAttachment: boolean;
      unreadCount: number;
    }>(sql`
      SELECT
        t.id                                        AS "threadId",
        coalesce(latest.body, '')                   AS "lastBody",
        latest.author_user_id                       AS "lastAuthorUserId",
        (latest.attachment_path IS NOT NULL)        AS "lastHadAttachment",
        coalesce(unread.n, 0)::int                  AS "unreadCount"
      FROM team_threads t
      JOIN team_thread_members me
        ON me.org_id = t.org_id AND me.thread_id = t.id AND me.user_id = ${userId}
      LEFT JOIN LATERAL (
        SELECT m.body, m.author_user_id, m.attachment_path
        FROM team_messages m
        WHERE m.org_id = t.org_id AND m.thread_id = t.id AND m.deleted_at IS NULL
        ORDER BY m.created_at DESC
        LIMIT 1
      ) latest ON true
      LEFT JOIN LATERAL (
        SELECT count(*) AS n
        FROM team_messages m
        WHERE m.org_id = t.org_id
          AND m.thread_id = t.id
          AND m.deleted_at IS NULL
          AND m.created_at > me.last_read_at
          AND m.author_user_id <> ${userId}
      ) unread ON true
      WHERE t.org_id = ${this.orgId}
        AND t.id IN (${sql.join(
          threadIds.map((id) => sql`${id}`),
          sql`, `,
        )})
    `);

    const summaryById = new Map(summaries.map((s) => [s.threadId, s]));

    return mine.map((t) => {
      const s = summaryById.get(t.id);
      return {
        id: t.id,
        kind: t.kind as ThreadListRow["kind"],
        title: t.title,
        lastMessageAt: t.lastMessageAt,
        lastBody: s?.lastBody ?? "",
        lastAuthorUserId: s?.lastAuthorUserId ? asUserId(s.lastAuthorUserId) : null,
        lastHadAttachment: s?.lastHadAttachment ?? false,
        unreadCount: Number(s?.unreadCount ?? 0),
        members: membersByThread.get(t.id) ?? [],
      };
    });
  }

  async listMessages(
    threadId: string,
    page: { limit: number; before?: Date },
  ): Promise<TeamMessage[]> {
    const conds = [
      eq(teamMessages.orgId, this.orgId),
      eq(teamMessages.threadId, threadId),
      isNull(teamMessages.deletedAt),
    ];
    if (page.before) conds.push(lt(teamMessages.createdAt, page.before));

    // Newest-first with the limit so a keyset page walks BACKWARDS through history, then
    // reversed for display — a chat reads oldest-first inside the window it is showing.
    const rows = await this.tx
      .select()
      .from(teamMessages)
      .where(and(...conds))
      .orderBy(sql`${teamMessages.createdAt} desc`)
      .limit(page.limit);

    return rows.reverse().map(messageToDomain);
  }

  async appendMessage(message: TeamMessage): Promise<TeamMessage> {
    const p = message.props;
    const inserted = await this.tx
      .insert(teamMessages)
      .values({
        id: p.id,
        orgId: this.orgId,
        threadId: p.threadId,
        authorUserId: p.authorUserId,
        body: p.body,
        attachmentPath: p.attachment?.path ?? null,
        attachmentType: p.attachment?.mediaType ?? null,
        attachmentBytes: p.attachment?.bytes ?? null,
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error("team message insert returned no row");

    // The inbox sorts on this; without the bump a new message would not move its thread.
    await this.tx
      .update(teamThreads)
      .set({ lastMessageAt: p.createdAt, updatedAt: sql`now()` })
      .where(and(eq(teamThreads.orgId, this.orgId), eq(teamThreads.id, p.threadId)));

    // The author has read what they just wrote — otherwise every send lights up the sender's
      // own unread badge.
    await this.tx
      .update(teamThreadMembers)
      .set({ lastReadAt: p.createdAt })
      .where(
        and(
          eq(teamThreadMembers.orgId, this.orgId),
          eq(teamThreadMembers.threadId, p.threadId),
          eq(teamThreadMembers.userId, p.authorUserId),
        ),
      );

    return messageToDomain(row);
  }

  async markRead(threadId: string, userId: UserId, now: Date): Promise<boolean> {
    const rows = await this.tx
      .update(teamThreadMembers)
      .set({ lastReadAt: now })
      .where(
        and(
          eq(teamThreadMembers.orgId, this.orgId),
          eq(teamThreadMembers.threadId, threadId),
          eq(teamThreadMembers.userId, userId),
          isNull(teamThreadMembers.leftAt),
        ),
      )
      .returning({ userId: teamThreadMembers.userId });
    return rows.length > 0;
  }

  async addMembers(threadId: string, userIds: readonly UserId[], now: Date): Promise<void> {
    if (userIds.length === 0) return;
    await this.tx
      .insert(teamThreadMembers)
      .values(
        userIds.map((userId) => ({
          orgId: this.orgId,
          threadId,
          userId,
          // A new member's cursor starts NOW, so they arrive with a clean badge rather than
          // every message from before they were added.
          lastReadAt: now,
        })),
      )
      // Re-adding someone who left clears their left_at and re-bases their cursor; already-
      // present members are untouched by a re-add.
      .onConflictDoUpdate({
        target: [teamThreadMembers.orgId, teamThreadMembers.threadId, teamThreadMembers.userId],
        set: { leftAt: null, lastReadAt: now },
        setWhere: sql`${teamThreadMembers.leftAt} is not null`,
      });
  }

  async leaveThread(threadId: string, userId: UserId, now: Date): Promise<boolean> {
    const rows = await this.tx
      .update(teamThreadMembers)
      .set({ leftAt: now })
      .where(
        and(
          eq(teamThreadMembers.orgId, this.orgId),
          eq(teamThreadMembers.threadId, threadId),
          eq(teamThreadMembers.userId, userId),
          isNull(teamThreadMembers.leftAt),
        ),
      )
      .returning({ userId: teamThreadMembers.userId });
    return rows.length > 0;
  }

  async filterExistingUserIds(userIds: readonly UserId[]): Promise<UserId[]> {
    if (userIds.length === 0) return [];
    const rows = await this.tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.orgId, this.orgId), inArray(users.id, [...userIds])));
    return rows.map((r) => asUserId(r.id));
  }
}
