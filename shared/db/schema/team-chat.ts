import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
  unique,
  primaryKey,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { orgs } from "./orgs";
import { users } from "./users";

/**
 * STAFF messaging — the shop's own people talking to each other. Deliberately a separate
 * island from `messages`, which is the customer SMS ledger: that table's rows are Twilio
 * traffic (NOT NULL E.164 from/to, carrier delivery status, A2P campaign plumbing), and a
 * staff DM has none of those facts. Mixing them would mean loosening two NOT NULLs and two
 * CHECK constraints on the one table whose correctness decides whether a customer's text
 * actually sends.
 *
 * Nothing here touches Twilio: an internal message is a database row, so it costs nothing to
 * send, needs no A2P registration, and cannot fail delivery.
 *
 * RLS: hand-written in the migration that follows this table's DDL (ENABLE + FORCE,
 * org_id = current_org_id()), mirroring 0151_payment_profiles_rls.sql.
 */

/**
 * One conversation: a DM between two people, or a named group.
 *
 * `dm_key` is the find-or-create guard — the two user ids sorted and joined, so "Dana messages
 * Mike" and "Mike messages Dana" resolve to the SAME thread instead of quietly forking into two
 * half-conversations. It is unique per org (partial, since groups carry none).
 *
 * `last_message_at` is denormalised on purpose: the inbox sorts by it, and reading it off the
 * thread row avoids a DISTINCT ON over every message the shop has ever sent.
 */
export const teamThreads = pgTable(
  "team_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    /** 'dm' | 'group' — see the shape check below, which keeps title/dm_key honest per kind. */
    kind: text("kind").notNull(),
    /** The group's name. Null for a DM, whose name is rendered from the other person. */
    title: text("title"),
    /** Sorted "&lt;userIdA&gt;:&lt;userIdB&gt;" for a DM; null for a group. One DM per pair per org. */
    dmKey: text("dm_key"),
    createdByUserId: uuid("created_by_user_id").notNull(),
    /** Bumped on every send — the inbox's sort key. */
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    // Composite-unique target so the child tables' (org_id, thread_id) FKs can never point at
    // another org's thread (same move assemblies_org_id_uq made).
    unique("team_threads_org_id_uq").on(t.orgId, t.id),
    foreignKey({
      name: "team_threads_creator_fk",
      columns: [t.orgId, t.createdByUserId],
      foreignColumns: [users.orgId, users.id],
    }),
    // The find-or-create guard. Partial, because groups have no dm_key and Postgres treats
    // NULLs as distinct anyway — this states the intent rather than relying on that.
    uniqueIndex("team_threads_org_dmkey_uidx")
      .on(t.orgId, t.dmKey)
      .where(sql`${t.dmKey} is not null`),
    index("team_threads_org_recent_idx").on(t.orgId, t.lastMessageAt.desc()),
    check("team_threads_kind_check", sql`${t.kind} in ('dm', 'group')`),
    // A DM is (dm_key, no title); a group is (title, no dm_key). Enforced at the storage layer
    // so a bug in one code path cannot mint a nameless group or a DM that forks.
    check(
      "team_threads_shape_check",
      sql`(${t.kind} = 'dm' and ${t.dmKey} is not null and ${t.title} is null)
          or (${t.kind} = 'group' and ${t.dmKey} is null and ${t.title} is not null)`,
    ),
  ],
);

/**
 * Who is in a thread, and how far they have read.
 *
 * `last_read_at` IS the entire unread system — unread count is "messages after my cursor that
 * I did not write". Per-user, unlike the customer inbox's org-wide `leads.unread` flag: one
 * person reading a DM must not mark it read for everyone.
 *
 * Leaving sets `left_at` rather than deleting the row, so the thread can still say who was in
 * it when something was said, and re-adding someone is an upsert rather than a duplicate.
 * Shape mirrors crew_schedules: composite PK on (org, user, scope) + composite FK to users.
 */
export const teamThreadMembers = pgTable(
  "team_thread_members",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").notNull(),
    userId: uuid("user_id").notNull(),
    /** Everything at or before this instant is read. Starts at join time, not epoch — a new
     *  group member arrives with a clean badge rather than 400 unread messages from before
     *  they were added. */
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set when they leave; the row stays for history. Null = currently a member. */
    leftAt: timestamp("left_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.threadId, t.userId] }),
    foreignKey({
      name: "team_thread_members_thread_fk",
      columns: [t.orgId, t.threadId],
      foreignColumns: [teamThreads.orgId, teamThreads.id],
    }).onDelete("cascade"),
    // Tenant-safe member: the referenced user must share this row's org (mirrors
    // crew_schedules_user_fk). Cascade so removing a user clears their memberships.
    foreignKey({
      name: "team_thread_members_user_fk",
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete("cascade"),
    // "My threads" — the inbox's driving read.
    index("team_thread_members_org_user_idx").on(t.orgId, t.userId),
  ],
);

/**
 * One message in a thread: text, a photo, or a photo with a caption.
 *
 * ONE attachment per message, as columns rather than a child table — sending three photos
 * writes three messages, which is what a chat renders anyway (three image bubbles). If a
 * message ever needs to carry several files at once, that is the moment to extract a
 * team_message_files table; until then this is one table fewer to secure and test.
 *
 * The bytes are NOT here — they live in the private `team-files` Storage bucket under
 * &lt;org_id&gt;/&lt;thread_id&gt;/&lt;uuid&gt;.&lt;ext&gt;. This row holds only the key.
 */
export const teamMessages = pgTable(
  "team_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").notNull(),
    authorUserId: uuid("author_user_id").notNull(),
    /** May be empty when the message is purely a photo — see the content check below. */
    body: text("body").notNull().default(""),
    /** &lt;org_id&gt;/&lt;thread_id&gt;/&lt;uuid&gt;.&lt;ext&gt; in the team-files bucket. Null for a text message. */
    attachmentPath: text("attachment_path"),
    attachmentType: text("attachment_type"),
    attachmentBytes: integer("attachment_bytes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    foreignKey({
      name: "team_messages_thread_fk",
      columns: [t.orgId, t.threadId],
      foreignColumns: [teamThreads.orgId, teamThreads.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "team_messages_author_fk",
      columns: [t.orgId, t.authorUserId],
      foreignColumns: [users.orgId, users.id],
    }),
    // The thread read, oldest-first with a keyset.
    index("team_messages_org_thread_idx").on(t.orgId, t.threadId, t.createdAt),
    // One object, one message: a replayed send cannot attach the same upload twice.
    unique("team_messages_org_attachment_uq").on(t.orgId, t.attachmentPath),
    // Attachment columns move together — all three set, or all three null.
    check(
      "team_messages_attachment_shape_check",
      sql`(${t.attachmentPath} is null) = (${t.attachmentType} is null)
          and (${t.attachmentPath} is null) = (${t.attachmentBytes} is null)`,
    ),
    // The same image set the photo pipeline accepts (EXT_TO_MEDIA_TYPE) — nothing renderable
    // as script reaches a viewer.
    check(
      "team_messages_attachment_type_check",
      sql`${t.attachmentType} is null
          or ${t.attachmentType} in ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check(
      "team_messages_attachment_bytes_check",
      sql`${t.attachmentBytes} is null or ${t.attachmentBytes} > 0`,
    ),
    // No empty messages: a row must carry words, a photo, or both.
    check(
      "team_messages_content_check",
      sql`length(btrim(${t.body})) > 0 or ${t.attachmentPath} is not null`,
    ),
  ],
);
