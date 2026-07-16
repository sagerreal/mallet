// Public surface for the notifications module — the only sanctioned import seam (architecture rule).
export { createNotificationRouter } from "./api/notification-router";
export type {
  Notification,
  NotificationChannel,
  NotificationStatus,
  NotificationProps,
} from "./domain/notification";
export { NOTIFICATION_CHANNELS, NOTIFICATION_STATUSES } from "./domain/notification";
export type { NotificationRepository } from "./domain/notification-repository";
export type {
  NotificationSender,
  SendNotificationCmd,
  NotificationReceipt,
} from "./domain/notification-sender";
export { LoggingNotificationSender } from "./infra/logging-notification-sender";
export { ResendEmailSender } from "./infra/resend-email-sender";
export { TwilioSmsSender } from "./infra/twilio-sms-sender";
export type { SmsTransport } from "./infra/twilio-sms-sender";
export { ChannelRouterNotificationSender } from "./infra/channel-router-notification-sender";
export type { ReminderTargetReader } from "./domain/reminder-target-reader";
export { FollowUpPolicy } from "./domain/follow-up-policy";
export { SendNotificationUseCase } from "./app/send-notification";
export type { SendNotificationCommand } from "./app/send-notification";
export { DrizzleNotificationRepository } from "./infra/drizzle-notification-repository";
export { SendInvoiceNotificationUseCase } from "./app/send-invoice-notification";
export { AdvanceReminderUseCase } from "./app/advance-reminder";
export { NextRemindersDueUseCase } from "./app/next-reminders-due";
export { ListNotificationsUseCase } from "./app/list-notifications";
export { DrizzleReminderTargetReader } from "./infra/drizzle-reminder-target-reader";
export { STUB_EXTERNAL_ID } from "./infra/logging-notification-sender";
