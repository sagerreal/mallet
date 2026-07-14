import { ok, err, externalService, systemClock } from "@mallet/shared/types";
import type { Result, ExternalServiceError } from "@mallet/shared/types";
import type {
  NotificationSender,
  SendNotificationCmd,
  NotificationReceipt,
} from "@mallet/notifications";

// Test-only support for the voice tools. A recording NotificationSender fake for unit tests: it
// captures every send and (by default) returns ok, so a tool that fires a transactional SMS can be
// asserted without a real Twilio/logging adapter. `mode` lets a test exercise the graceful-degrade
// paths — an err Result or an outright throw — to prove the SMS step never fails the booking.
export type SendMode = "ok" | "err" | "throw";

export interface RecordingNotificationSender extends NotificationSender {
  readonly sent: SendNotificationCmd[];
}

export const recordingNotificationSender = (mode: SendMode = "ok"): RecordingNotificationSender => {
  const sent: SendNotificationCmd[] = [];
  return {
    sent,
    async send(cmd: SendNotificationCmd): Promise<Result<NotificationReceipt, ExternalServiceError>> {
      sent.push(cmd);
      if (mode === "throw") throw new Error("sms provider offline");
      if (mode === "err") return err(externalService("sms", "provider unavailable"));
      return ok({ externalId: "test:sent", channel: cmd.channel, sentAt: systemClock.now() });
    },
  };
};

// An inert sender for tools that never send (take_message, request_quote, check_availability): it
// satisfies the deps shape and returns ok, recording nothing observable.
export const inertNotificationSender = (): NotificationSender => ({
  async send(cmd: SendNotificationCmd): Promise<Result<NotificationReceipt, ExternalServiceError>> {
    return ok({ externalId: "test:inert", channel: cmd.channel, sentAt: systemClock.now() });
  },
});
