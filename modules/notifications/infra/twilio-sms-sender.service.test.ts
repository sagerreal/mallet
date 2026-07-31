/**
 * Which sender identity goes on the wire.
 *
 * Carriers check the SERVICE, not the number: a 10DLC campaign attaches to a Messaging Service, and
 * a send naming a bare `from` is treated as unregistered traffic even when that number sits in the
 * service's own sender pool. Elas sent bare `from` numbers exclusively, so an approved campaign
 * would still not have delivered anything.
 */
import { describe, it, expect, vi } from "vitest";
import { TwilioSmsSender } from "./twilio-sms-sender";
import { asOrgId } from "@mallet/shared/types";
import type { SendNotificationCmd } from "../domain/notification-sender";

const CLOCK = { now: () => new Date("2026-07-26T12:00:00Z") };
const CMD: SendNotificationCmd = {
  orgId: asOrgId("6d2ceccc-e7bb-4d43-904d-d23c01cf9528"),
  channel: "sms",
  to: "+17813850591",
  body: "hello there",
  kind: "invoice_sent",
  idempotencyKey: "idem-service-1",
};

const build = (serviceSid?: string, publicUrl?: string) => {
  const transport = vi.fn(async () => ({ sid: "SM123" }));
  const sender = new TwilioSmsSender("AC1", "tok", "+16693413343", CLOCK, transport, publicUrl, serviceSid);
  return { sender, transport };
};

const sent = (transport: ReturnType<typeof vi.fn>) => transport.mock.calls[0]![0];

describe("TwilioSmsSender — sender identity", () => {
  it("sends through the Messaging Service when the org has one", async () => {
    const { sender, transport } = build("MG72c3b0c8cbf98d6cce1bf06a010a0843");
    await sender.send(CMD);
    expect(sent(transport).messagingServiceSid).toBe("MG72c3b0c8cbf98d6cce1bf06a010a0843");
  });

  /** Twilio REJECTS a request carrying both. This is not a style preference. */
  it("omits `from` entirely when using a service", async () => {
    const { sender, transport } = build("MG72c3b0c8cbf98d6cce1bf06a010a0843");
    await sender.send(CMD);
    expect(sent(transport).from).toBeUndefined();
  });

  it("falls back to the bare number when there is no service", async () => {
    const { sender, transport } = build(undefined);
    await sender.send(CMD);
    expect(sent(transport).from).toBe("+16693413343");
    expect(sent(transport).messagingServiceSid).toBeUndefined();
  });

  it("asks Twilio to report delivery when the app has a public https origin", async () => {
    const { sender, transport } = build(undefined, "https://mallet-app-snowy.vercel.app");
    await sender.send(CMD);
    expect(sent(transport).statusCallback).toBe(
      "https://mallet-app-snowy.vercel.app/api/webhooks/twilio/message-status",
    );
  });

  // Twilio will not call localhost, so sending a URL it cannot reach buys nothing.
  it("sends no callback for a non-https origin", async () => {
    const { sender, transport } = build(undefined, "http://localhost:3000");
    await sender.send(CMD);
    expect(sent(transport).statusCallback).toBeUndefined();
  });

  it("tolerates a trailing slash on the public URL", async () => {
    const { sender, transport } = build(undefined, "https://mallet-app-snowy.vercel.app/");
    await sender.send(CMD);
    expect(sent(transport).statusCallback).toBe(
      "https://mallet-app-snowy.vercel.app/api/webhooks/twilio/message-status",
    );
  });
});
