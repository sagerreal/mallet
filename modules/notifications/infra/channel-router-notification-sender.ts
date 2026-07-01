import type { Result, ExternalServiceError } from "@mallet/shared/types";
import type {
  NotificationSender,
  SendNotificationCmd,
  NotificationReceipt,
} from "../domain/notification-sender";
import type { NotificationChannel } from "../domain/notification";

// Dispatches a send to the per-channel adapter (email → Resend, sms → Twilio). Any channel without
// a configured provider uses the injected fallback (the logging stub) — so an unconfigured channel
// degrades to a logged no-op instead of erroring, matching the notifications slice's design (a
// sender failure is status=failed, never a hard stop). Composes senders; owns no transport itself.
export class ChannelRouterNotificationSender implements NotificationSender {
  constructor(
    private readonly fallback: NotificationSender,
    private readonly byChannel: Partial<Record<NotificationChannel, NotificationSender>>,
  ) {}

  send(cmd: SendNotificationCmd): Promise<Result<NotificationReceipt, ExternalServiceError>> {
    return (this.byChannel[cmd.channel] ?? this.fallback).send(cmd);
  }
}
