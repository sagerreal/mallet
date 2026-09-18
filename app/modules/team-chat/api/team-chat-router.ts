import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { users } from "@mallet/shared/db/schema";
import { asUserId, isOk, type UserId } from "@mallet/shared/types";
import { router, anyRole } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import type { TenantTx } from "@mallet/shared/db/tx";
import { DrizzleTeamChatRepository } from "../infra/drizzle-team-chat-repository";
import { StartDmUseCase } from "../app/start-dm";
import { CreateGroupUseCase } from "../app/create-group";
import { SendTeamMessageUseCase } from "../app/send-team-message";
import {
  ListTeamThreadsUseCase,
  ReadTeamThreadUseCase,
  MarkTeamThreadReadUseCase,
  THREAD_PAGE_LIMIT,
} from "../app/read-thread";
import { AddGroupMembersUseCase, LeaveTeamThreadUseCase } from "../app/manage-members";
import { MAX_GROUP_TITLE, MAX_GROUP_MEMBERS } from "../domain/team-thread";
import { MAX_CHAT_BODY, MAX_CHAT_FILE_BYTES, CHAT_MEDIA_TYPES } from "../domain/team-message";
import { teamThreadDTO, toTeamThreadDTO, teamMessageDTO, toTeamMessageDTO } from "./team-chat-dto";
import { displayNameOf } from "../domain/display-name";

/**
 * Staff chat. EVERY procedure is `anyRole` — a shop's crew talking to each other is not an
 * office feature, and a tech who cannot open a thread has no use for the tab it lives in.
 *
 * Authorization is thread MEMBERSHIP, checked inside the use-cases (RLS scopes the tenant; it
 * has no notion of the current user). Refusals are NOT_FOUND so a caller never learns that a
 * conversation they are outside of exists.
 */

const threadIdInput = z.object({ threadId: z.string().uuid() });

/**
 * Resolve display names for a set of author ids, in one query. Falls back to the account email
 * when a staffer never set a display name (users.name is nullable).
 */
const senderNamesFor = async (
  tx: TenantTx,
  orgId: string,
  authorIds: readonly string[],
): Promise<ReadonlyMap<string, string>> => {
  const ids = [...new Set(authorIds)];
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.orgId, orgId), inArray(users.id, ids)));
  return new Map(rows.map((r) => [r.id, displayNameOf(r.name, r.email)]));
};

export const createTeamChatRouter = () =>
  router({
    /**
     * The people you can message: everyone in the shop but you.
     *
     * This exists because `identity.members` is owner/office-only AND carries `costRateCents`
     * (burdened labour cost — somebody's pay). Widening that procedure to techs would leak wages
     * to reach a roster; this one returns only who a person is.
     */
    roster: anyRole
      .output(
        z.array(
          z.object({
            userId: z.string().uuid(),
            name: z.string(),
            role: z.enum(["owner", "office", "tech"]),
          }),
        ),
      )
      .query(async ({ ctx }) => {
        const rows = await ctx.tx
          .select({ id: users.id, name: users.name, email: users.email, role: users.role })
          .from(users)
          .where(eq(users.orgId, ctx.principal.orgId));
        return rows
          .filter((r) => r.id !== ctx.principal.userId)
          .map((r) => ({
            userId: r.id,
            name: displayNameOf(r.name, r.email),
            role: r.role as "owner" | "office" | "tech",
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
      }),

    /** My conversations, newest activity first, each with MY unread count. */
    listThreads: anyRole.output(z.array(teamThreadDTO)).query(async ({ ctx }) => {
      const repo = new DrizzleTeamChatRepository(ctx.tx, ctx.principal.orgId);
      const rows = await new ListTeamThreadsUseCase(repo).exec({
        meUserId: ctx.principal.userId,
      });
      return rows.map(toTeamThreadDTO);
    }),

    /** Open (or reopen) the DM with a teammate. Find-or-create — never forks. */
    startDm: anyRole
      .input(z.object({ userId: z.string().uuid() }))
      .output(z.object({ threadId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleTeamChatRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new StartDmUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec({
          orgId: ctx.principal.orgId,
          meUserId: ctx.principal.userId,
          otherUserId: asUserId(input.userId),
        });
        return { threadId: orThrow(result).props.id };
      }),

    /** Start a named group. The creator is always a member. */
    createGroup: anyRole
      .input(
        z.object({
          title: z.string().min(1).max(MAX_GROUP_TITLE),
          userIds: z.array(z.string().uuid()).min(1).max(MAX_GROUP_MEMBERS),
        }),
      )
      .output(z.object({ threadId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleTeamChatRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CreateGroupUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec({
          orgId: ctx.principal.orgId,
          meUserId: ctx.principal.userId,
          title: input.title,
          memberUserIds: input.userIds.map(asUserId),
        });
        return { threadId: orThrow(result).props.id };
      }),

    /** A page of a thread I am in, oldest-first. `before` walks back through history. */
    listMessages: anyRole
      .input(
        threadIdInput.extend({
          limit: z.number().int().min(1).max(THREAD_PAGE_LIMIT).optional(),
          before: z.string().datetime().optional(),
        }),
      )
      .output(z.array(teamMessageDTO))
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleTeamChatRepository(ctx.tx, ctx.principal.orgId);
        const result = await new ReadTeamThreadUseCase(repo).exec({
          threadId: input.threadId,
          meUserId: ctx.principal.userId,
          limit: input.limit,
          before: input.before ? new Date(input.before) : undefined,
        });
        const messages = orThrow(result);
        const names = await senderNamesFor(
          ctx.tx,
          ctx.principal.orgId,
          messages.map((m) => m.props.authorUserId),
        );
        return messages.map((m) => toTeamMessageDTO(m, ctx.principal.userId, names));
      }),

    /** Post to a thread — words, a photo, or both. */
    send: anyRole
      .input(
        threadIdInput.extend({
          body: z.string().max(MAX_CHAT_BODY).default(""),
          attachment: z
            .object({
              path: z.string().min(1).max(1024),
              mediaType: z.enum(CHAT_MEDIA_TYPES as unknown as [string, ...string[]]),
              bytes: z.number().int().positive().max(MAX_CHAT_FILE_BYTES),
            })
            .optional(),
        }),
      )
      .output(teamMessageDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleTeamChatRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SendTeamMessageUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec({
          orgId: ctx.principal.orgId,
          threadId: input.threadId,
          authorUserId: ctx.principal.userId,
          body: input.body,
          attachment: input.attachment
            ? {
                path: input.attachment.path,
                mediaType: input.attachment.mediaType as (typeof CHAT_MEDIA_TYPES)[number],
                bytes: input.attachment.bytes,
              }
            : null,
        });
        const message = orThrow(result);
        const names = await senderNamesFor(ctx.tx, ctx.principal.orgId, [
          message.props.authorUserId,
        ]);
        return toTeamMessageDTO(message, ctx.principal.userId, names);
      }),

    /** Move my read cursor. Per-user: opening a group clears only MY badge. */
    markRead: anyRole
      .input(threadIdInput)
      .output(z.object({ cleared: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleTeamChatRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new MarkTeamThreadReadUseCase(repo, ctx.deps.clock);
        return orThrow(
          await useCase.exec({ threadId: input.threadId, meUserId: ctx.principal.userId }),
        );
      }),

    /** Add people to a group — the capability Housecall Pro documents it lacks. */
    addMembers: anyRole
      .input(threadIdInput.extend({ userIds: z.array(z.string().uuid()).min(1).max(MAX_GROUP_MEMBERS) }))
      .output(z.object({ added: z.number().int().nonnegative() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleTeamChatRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new AddGroupMembersUseCase(repo, ctx.deps.clock);
        return orThrow(
          await useCase.exec({
            threadId: input.threadId,
            meUserId: ctx.principal.userId,
            addUserIds: input.userIds.map(asUserId),
          }),
        );
      }),

    /** Leave a conversation. History keeps who was in it. */
    leave: anyRole
      .input(threadIdInput)
      .output(z.object({ left: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleTeamChatRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new LeaveTeamThreadUseCase(repo, ctx.deps.clock);
        return orThrow(
          await useCase.exec({ threadId: input.threadId, meUserId: ctx.principal.userId }),
        );
      }),

    /**
     * Mint a signed upload URL for a photo, scoped to a thread I am in.
     *
     * Membership is checked BEFORE the gateway is touched: without that, anyone could mint an
     * upload token into any thread's folder and then graft the path onto a message.
     */
    attachmentUploadUrl: anyRole
      .input(
        threadIdInput.extend({
          objectId: z.string().uuid(),
          ext: z.enum(["jpg", "jpeg", "png", "webp"]),
        }),
      )
      .output(z.object({ signedUrl: z.string(), token: z.string(), storagePath: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const gateway = ctx.deps.chatFileGateway;
        if (!gateway) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "photo attachments aren't set up on this server yet",
          });
        }
        const repo = new DrizzleTeamChatRepository(ctx.tx, ctx.principal.orgId);
        if (!(await repo.isMember(input.threadId, ctx.principal.userId))) {
          throw new TRPCError({ code: "NOT_FOUND", message: "that conversation is not one of yours" });
        }
        const result = await gateway.createUploadUrl({
          orgId: ctx.principal.orgId,
          threadId: input.threadId,
          objectId: input.objectId,
          ext: input.ext,
        });
        if (!isOk(result)) {
          throw new TRPCError({ code: "BAD_GATEWAY", message: result.error.message });
        }
        return result.value;
      }),

    /**
     * A short-lived URL for viewing an attachment. The first read-back path in this app: job
     * photos have only ever been uploaded, never displayed.
     */
    attachmentViewUrl: anyRole
      .input(threadIdInput.extend({ path: z.string().min(1).max(1024) }))
      .output(z.object({ url: z.string(), expiresInSeconds: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const gateway = ctx.deps.chatFileGateway;
        if (!gateway) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "photo attachments aren't set up on this server yet",
          });
        }
        const repo = new DrizzleTeamChatRepository(ctx.tx, ctx.principal.orgId);
        if (!(await repo.isMember(input.threadId, ctx.principal.userId))) {
          throw new TRPCError({ code: "NOT_FOUND", message: "that conversation is not one of yours" });
        }
        const result = await gateway.createViewUrl(input.path, {
          orgId: ctx.principal.orgId,
          threadId: input.threadId,
        });
        if (!isOk(result)) {
          throw new TRPCError({ code: "BAD_GATEWAY", message: result.error.message });
        }
        return result.value;
      }),
  });

/** Re-exported for the client's upload helper, which needs the bucket name. */
export type { UserId };
