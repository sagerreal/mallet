import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { Phone, isOk, toPage } from "@mallet/shared/types";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  type Notification,
  type NotificationChannel,
  type NotificationStatus,
} from "../domain/notification";
import { FollowUpPolicy } from "../domain/follow-up-policy";
import { DrizzleNotificationRepository } from "../infra/drizzle-notification-repository";
import { DrizzleReminderTargetReader } from "../infra/drizzle-reminder-target-reader";
import { LoggingNotificationSender } from "../infra/logging-notification-sender";
import { SendNotificationUseCase } from "../app/send-notification";
import { SendInvoiceNotificationUseCase } from "../app/send-invoice-notification";
import { AdvanceReminderUseCase } from "../app/advance-reminder";
import { NextRemindersDueUseCase } from "../app/next-reminders-due";
import { ListNotificationsUseCase } from "../app/list-notifications";

const channelEnum = z.enum(NOTIFICATION_CHANNELS as unknown as [NotificationChannel, ...NotificationChannel[]]);
const statusEnum = z.enum(NOTIFICATION_STATUSES as unknown as [NotificationStatus, ...NotificationStatus[]]);
const relatedTypeEnum = z.enum(["invoice", "estimate"]);

const notificationDTO = z.object({
  id: z.string().uuid(),
  channel: channelEnum,
  to: z.string(),
  kind: z.string(),
  body: z.string(),
  status: statusEnum,
  relatedType: relatedTypeEnum.nullable(),
  relatedId: z.string().uuid().nullable(),
  reminderStage: z.number().int().nullable(),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
});
const summaryDTO = notificationDTO.omit({ body: true });
const dueReminderDTO = z.object({
  relatedType: relatedTypeEnum,
  relatedId: z.string().uuid(),
  num: z.string(),
  stage: z.number().int(),
});

const iso = (d: Date | null) => d?.toISOString() ?? null;
const toNotificationDTO = (n: Notification) => {
  const p = n.props;
  return {
    id: p.id,
    channel: p.channel,
    to: p.to,
    kind: p.kind,
    body: p.body,
    status: p.status,
    relatedType: p.relatedType,
    relatedId: p.relatedId,
    reminderStage: p.reminderStage,
    sentAt: iso(p.sentAt),
    createdAt: p.createdAt.toISOString(),
  };
};
const toSummaryDTO = (n: Notification) => {
  const { body: _body, ...rest } = toNotificationDTO(n);
  return rest;
};

const repoFor = (ctx: { tx: import("@mallet/shared/db/tx").TenantTx; principal: { orgId: import("@mallet/shared/types").OrgId } }) =>
  new DrizzleNotificationRepository(ctx.tx, ctx.principal.orgId);

export const createNotificationRouter = () =>
  router({
    send: ownerOrOffice
      .input(
        z.object({
          channel: channelEnum,
          to: z.string().min(1),
          kind: z.string().min(1),
          body: z.string().min(1),
          relatedType: relatedTypeEnum.optional(),
          relatedId: z.string().uuid().optional(),
          idempotencyKey: z.string().min(8),
        }),
      )
      .output(notificationDTO)
      .mutation(async ({ ctx, input }) => {
        let to = input.to;
        if (input.channel === "sms") {
          const parsed = Phone.parse(input.to);
          if (!isOk(parsed)) throw new TRPCError({ code: "BAD_REQUEST", message: parsed.error.message });
          to = parsed.value;
        } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.to)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "invalid email address" });
        }
        const useCase = new SendNotificationUseCase(
          repoFor(ctx),
          new LoggingNotificationSender(ctx.deps.clock),
          ctx.deps.bus,
          ctx.deps.clock,
          ctx.deps.ids,
        );
        return toNotificationDTO(
          orThrow(
            await useCase.exec({
              orgId: ctx.principal.orgId,
              channel: input.channel,
              to,
              kind: input.kind,
              body: input.body,
              relatedType: input.relatedType ?? null,
              relatedId: input.relatedId ?? null,
              reminderStage: null,
              idempotencyKey: input.idempotencyKey,
            }),
          ),
        );
      }),

    sendInvoiceReminder: ownerOrOffice
      .input(z.object({ invoiceId: z.string().uuid(), channel: channelEnum }))
      .output(notificationDTO)
      .mutation(async ({ ctx, input }) => {
        const send = new SendNotificationUseCase(
          repoFor(ctx),
          new LoggingNotificationSender(ctx.deps.clock),
          ctx.deps.bus,
          ctx.deps.clock,
          ctx.deps.ids,
        );
        const useCase = new SendInvoiceNotificationUseCase(
          new DrizzleReminderTargetReader(ctx.tx, ctx.principal.orgId),
          send,
          ctx.deps.ids,
        );
        return toNotificationDTO(
          orThrow(
            await useCase.exec({ orgId: ctx.principal.orgId, invoiceId: input.invoiceId, channel: input.channel }),
          ),
        );
      }),

    advanceReminder: ownerOrOffice
      .input(z.object({ relatedType: relatedTypeEnum, relatedId: z.string().uuid() }))
      .output(notificationDTO.nullable())
      .mutation(async ({ ctx, input }) => {
        const send = new SendNotificationUseCase(
          repoFor(ctx),
          new LoggingNotificationSender(ctx.deps.clock),
          ctx.deps.bus,
          ctx.deps.clock,
          ctx.deps.ids,
        );
        const useCase = new AdvanceReminderUseCase(
          new DrizzleReminderTargetReader(ctx.tx, ctx.principal.orgId),
          repoFor(ctx),
          send,
          new FollowUpPolicy(),
          ctx.deps.clock,
        );
        const result = orThrow(
          await useCase.exec({ orgId: ctx.principal.orgId, relatedType: input.relatedType, relatedId: input.relatedId }),
        );
        return result ? toNotificationDTO(result) : null;
      }),

    list: ownerOrOffice
      .input(
        z.object({
          limit: z.number().int().positive().max(100).optional(),
          cursor: z.string().nullish(),
          channel: channelEnum.optional(),
          status: statusEnum.optional(),
          kind: z.string().optional(),
        }),
      )
      .output(z.object({ items: z.array(summaryDTO), nextCursor: z.string().nullable() }))
      .query(async ({ ctx, input }) => {
        const page = await new ListNotificationsUseCase(repoFor(ctx)).exec({
          page: toPage({ limit: input.limit, cursor: input.cursor ?? null }),
          filter: { channel: input.channel, status: input.status, kind: input.kind },
        });
        return { items: page.items.map(toSummaryDTO), nextCursor: page.nextCursor };
      }),

    listDueReminders: ownerOrOffice
      .input(z.object({ limit: z.number().int().positive().max(100).optional(), cursor: z.string().nullish() }))
      .output(z.object({ items: z.array(dueReminderDTO), nextCursor: z.string().nullable() }))
      .query(async ({ ctx, input }) => {
        const useCase = new NextRemindersDueUseCase(
          new DrizzleReminderTargetReader(ctx.tx, ctx.principal.orgId),
          repoFor(ctx),
          new FollowUpPolicy(),
        );
        const page = await useCase.exec(
          ctx.deps.clock.now(),
          toPage({ limit: input.limit, cursor: input.cursor ?? null }),
        );
        return { items: [...page.items], nextCursor: page.nextCursor };
      }),

    get: ownerOrOffice
      .input(z.object({ notificationId: z.string().uuid() }))
      .output(notificationDTO)
      .query(async ({ ctx, input }) => {
        const found = await repoFor(ctx).findById(input.notificationId);
        if (!found) throw new TRPCError({ code: "NOT_FOUND", message: "notification not found" });
        return toNotificationDTO(found);
      }),
  });
