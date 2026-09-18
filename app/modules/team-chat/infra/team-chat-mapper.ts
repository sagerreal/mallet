import { asOrgId, asUserId } from "@mallet/shared/types";
import { teamThreads, teamMessages } from "@mallet/shared/db/schema";
import { TeamThread, type ThreadKind } from "../domain/team-thread";
import { TeamMessage, type ChatMediaType } from "../domain/team-message";

export type TeamThreadRow = typeof teamThreads.$inferSelect;
export type TeamMessageRow = typeof teamMessages.$inferSelect;

export const threadToDomain = (row: TeamThreadRow): TeamThread => {
  const result = TeamThread.create({
    id: row.id,
    orgId: asOrgId(row.orgId),
    kind: row.kind as ThreadKind,
    title: row.title,
    dmKey: row.dmKey,
    jobId: row.jobId,
    createdByUserId: asUserId(row.createdByUserId),
    lastMessageAt: row.lastMessageAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) throw new Error(`corrupt team thread ${row.id}: ${result.error.message}`);
  return result.value;
};

export const messageToDomain = (row: TeamMessageRow): TeamMessage => {
  const result = TeamMessage.create({
    id: row.id,
    orgId: asOrgId(row.orgId),
    threadId: row.threadId,
    authorUserId: asUserId(row.authorUserId),
    body: row.body,
    // The storage CHECK keeps these three columns moving together, so a path implies the rest.
    attachment: row.attachmentPath
      ? {
          path: row.attachmentPath,
          mediaType: row.attachmentType as ChatMediaType,
          bytes: row.attachmentBytes ?? 0,
        }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) throw new Error(`corrupt team message ${row.id}: ${result.error.message}`);
  return result.value;
};
