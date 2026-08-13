import { describe, expect, it, vi } from "vitest";
import { ok, isOk } from "@mallet/shared/types";
import { OrgSmsNotificationSender } from "./org-sms-notification-sender";
import type { NotificationSender, SendNotificationCmd } from "../domain/notification-sender";

/**
 * modules/notifications/infra/org-sms-notification-sender.test.ts
 *
 * THE BUG THIS CLOSES. Every automated text — invoice sent, payment reminders, receipts, the
 * technician's send-at-the-door, front-desk booking confirmations, the agent's reminders — was
 * sent by ONE sender built at server boot from a single `TWILIO_FROM_NUMBER`, and STAYED there
 * even after the shop registered a number of its own. At boot the process cannot know which shop
 * a message belongs to, so it could only ever use the one configured line.
 *
 * The shared line is not the bug — it is what lets a shop bill on its first day, while A2P
 * vetting runs for a week or more. Jobber and Housecall Pro both do exactly this. The bug is
 * never LEAVING it: once a shop has its own number, its automated messages belong on it.
 */

const receipt = (id: string, channel: SendNotificationCmd["channel"]) =>
  ok({ externalId: id, channel, sentAt: new Date("2026-08-13T00:00:00Z") });

const recorder = (id: string) => {
  const sent: SendNotificationCmd[] = [];
  const sender: NotificationSender = {
    send: vi.fn(async (cmd: SendNotificationCmd) => {
      sent.push(cmd);
      return receipt(id, cmd.channel);
    }),
  };
  return { sender, sent };
};

const cmd = (over: Partial<SendNotificationCmd> = {}): SendNotificationCmd =>
  ({
    orgId: "org-1",
    channel: "sms",
    to: "+15551234567",
    body: "Your invoice is ready.",
    kind: "invoice_sent",
    idempotencyKey: "k-1",
    ...over,
  }) as SendNotificationCmd;

describe("OrgSmsNotificationSender", () => {
  it("sends a text through the SHOP'S sender, not the boot-time one", () => {
    const base = recorder("base");
    const org = recorder("org");
    const s = new OrgSmsNotificationSender(base.sender, org.sender);
    return s.send(cmd()).then(() => {
      expect(org.sent).toHaveLength(1);
      expect(base.sent).toHaveLength(0);
    });
  });

  it("leaves email alone — 10DLC governs texts and nothing else", async () => {
    const base = recorder("base");
    const org = recorder("org");
    const s = new OrgSmsNotificationSender(base.sender, org.sender);
    await s.send(cmd({ channel: "email", to: "a@b.com" }));
    expect(base.sent).toHaveLength(1);
    expect(org.sent).toHaveLength(0);
  });

  /**
   * DAY ONE. A2P vetting runs 5-7 business days and can run weeks. A shop that signed up this
   * morning still has to be able to invoice, remind and receipt — so its automated texts ride the
   * platform's shared line until its own number exists, exactly as Jobber's pool does.
   */
  it("falls back to the shared platform line when the shop has no number yet", async () => {
    const base = recorder("base");
    const s = new OrgSmsNotificationSender(base.sender, null);
    const result = await s.send(cmd());
    expect(isOk(result)).toBe(true);
    expect(base.sent).toHaveLength(1);
  });

  /**
   * AND IT LEAVES. This is the half that was missing: six paths were pinned to the configured
   * number regardless of what the shop owned, so a fully registered shop's receipts still went out
   * from a line its customer could not place — and could not reply to.
   */
  it("stops using the shared line the moment the shop has its own", async () => {
    const base = recorder("base");
    const org = recorder("org");
    const s = new OrgSmsNotificationSender(base.sender, org.sender);
    await s.send(cmd({ kind: "payment_receipt" }));
    expect(org.sent).toHaveLength(1);
    expect(base.sent).toHaveLength(0);
  });

  it("still delivers EMAIL when the shop has no texting number", async () => {
    // A shop without a number is not a shop without notifications.
    const base = recorder("base");
    const s = new OrgSmsNotificationSender(base.sender, null);
    const result = await s.send(cmd({ channel: "email", to: "a@b.com" }));
    expect(isOk(result)).toBe(true);
    expect(base.sent).toHaveLength(1);
  });

  it("passes the command through untouched — it routes, it does not rewrite", async () => {
    const org = recorder("org");
    const s = new OrgSmsNotificationSender(recorder("base").sender, org.sender);
    const c = cmd({ idempotencyKey: "reminder:inv-9:stage-2" });
    await s.send(c);
    expect(org.sent[0]).toEqual(c);
  });
});
