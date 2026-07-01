import { describe, it, expect } from "vitest";
import { asOrgId, ok, type Result, type ExternalServiceError } from "@mallet/shared/types";
import type {
  NotificationSender,
  SendNotificationCmd,
  NotificationReceipt,
} from "../domain/notification-sender";
import type { NotificationChannel } from "../domain/notification";
import { ChannelRouterNotificationSender } from "./channel-router-notification-sender";

const ORG = asOrgId("22222222-2222-4222-8222-222222222222");

// Records which sender handled a call, tagging the receipt so we can assert routing.
const tagging = (label: string): NotificationSender & { calls: number } => ({
  calls: 0,
  async send(cmd: SendNotificationCmd): Promise<Result<NotificationReceipt, ExternalServiceError>> {
    this.calls += 1;
    return ok({ externalId: label, channel: cmd.channel, sentAt: new Date("2026-07-01T00:00:00Z") });
  },
});

const cmd = (channel: NotificationChannel): SendNotificationCmd => ({
  orgId: ORG,
  channel,
  to: channel === "sms" ? "+15555550123" : "cust@example.com",
  body: "hi",
  kind: "invoice_sent",
  idempotencyKey: "idem-router-1",
});

describe("ChannelRouterNotificationSender", () => {
  it("routes each channel to its configured sender", async () => {
    const email = tagging("email");
    const sms = tagging("sms");
    const fallback = tagging("fallback");
    const router = new ChannelRouterNotificationSender(fallback, { email, sms });

    const e = await router.send(cmd("email"));
    const s = await router.send(cmd("sms"));

    expect(e.ok && e.value.externalId).toBe("email");
    expect(s.ok && s.value.externalId).toBe("sms");
    expect(fallback.calls).toBe(0);
  });

  it("falls back to the logging stub for a channel with no configured provider", async () => {
    const fallback = tagging("fallback");
    // Only sms configured — email must fall back.
    const router = new ChannelRouterNotificationSender(fallback, { sms: tagging("sms") });

    const e = await router.send(cmd("email"));
    expect(e.ok && e.value.externalId).toBe("fallback");
    expect(fallback.calls).toBe(1);
  });
});
