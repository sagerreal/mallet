import { z } from "zod";
import type { TeamMessage } from "../domain/team-message";
import type { ThreadListRow } from "../domain/team-chat-repository";

/** One inbox row. `members` is what lets the client name a DM after the other person. */
export const teamThreadDTO = z.object({
  id: z.string().uuid(),
  kind: z.enum(["dm", "group"]),
  /** Group name; null for a DM. */
  title: z.string().nullable(),
  lastMessageAt: z.string(), // ISO 8601
  lastBody: z.string(),
  lastAuthorUserId: z.string().uuid().nullable(),
  /** So the inbox can say "Photo" instead of an empty preview line. */
  lastHadAttachment: z.boolean(),
  unreadCount: z.number().int().nonnegative(),
  members: z.array(z.object({ userId: z.string().uuid(), name: z.string() })),
});
export type TeamThreadDTO = z.infer<typeof teamThreadDTO>;

export const toTeamThreadDTO = (row: ThreadListRow): TeamThreadDTO => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  lastMessageAt: row.lastMessageAt.toISOString(),
  lastBody: row.lastBody,
  lastAuthorUserId: row.lastAuthorUserId,
  lastHadAttachment: row.lastHadAttachment,
  unreadCount: row.unreadCount,
  members: row.members.map((m) => ({ userId: m.userId, name: m.name })),
});

/**
 * One message. `senderName` is resolved at the boundary so a bubble never has to look a person
 * up, and `attachment` carries the storage path — NOT a URL: the client asks for a signed view
 * URL separately, so the link is minted per view and expires.
 */
export const teamMessageDTO = z.object({
  id: z.string().uuid(),
  threadId: z.string().uuid(),
  authorUserId: z.string().uuid(),
  senderName: z.string().nullable(),
  body: z.string(),
  attachment: z
    .object({
      path: z.string(),
      mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
      bytes: z.number().int().positive(),
    })
    .nullable(),
  createdAt: z.string(), // ISO 8601
});
export type TeamMessageDTO = z.infer<typeof teamMessageDTO>;

export const toTeamMessageDTO = (
  m: TeamMessage,
  senderNames?: ReadonlyMap<string, string>,
): TeamMessageDTO => ({
  id: m.props.id,
  threadId: m.props.threadId,
  authorUserId: m.props.authorUserId,
  senderName: senderNames?.get(m.props.authorUserId) ?? null,
  body: m.props.body,
  attachment: m.props.attachment
    ? {
        path: m.props.attachment.path,
        mediaType: m.props.attachment.mediaType,
        bytes: m.props.attachment.bytes,
      }
    : null,
  createdAt: m.props.createdAt.toISOString(),
});
