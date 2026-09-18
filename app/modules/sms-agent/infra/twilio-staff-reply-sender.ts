import type { Clock, OrgId } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { TwilioSmsSender } from "../../notifications/infra/twilio-sms-sender";
import type { StaffReplySender } from "../domain/ports";

export interface StaffReplySenderConfig {
  readonly accountSid: string;
  readonly authToken: string;
  /** The ONE Mallet-owned assistant number. Never a shop's own number. */
  readonly assistantNumber: string;
  /** Mallet's A2P Messaging Service — what carriers actually check. */
  readonly messagingServiceSid?: string;
  readonly clock: Clock;
}

/**
 * Sends the assistant's answer back to the staffer.
 *
 * DELIBERATELY NOT the app's shared notificationSender: that one sends from the global
 * TWILIO_FROM_NUMBER, so a reply would arrive from a different number than the staffer texted.
 * On their phone that starts a SECOND thread, and "reply YES to confirm" then lands somewhere the
 * pending action does not exist — the approval loop would be broken by the transport alone.
 *
 * Also deliberately NOT the shop's own number: a staffer talking to the assistant is Mallet
 * talking to its own user, and it rides Mallet's registration so no shop has to register anything.
 *
 * NO A2P gate here, and that is correct rather than an oversight. The per-org gate asks "may this
 * SHOP text its customers" — a question about the shop's own campaign. This traffic is Mallet's,
 * on Mallet's number, under Mallet's campaign, to Mallet's own user. Gating it on a shop's
 * registration would mean a brand-new shop's crew could not use the assistant until that shop
 * finished a registration that has nothing to do with this message.
 */
export class TwilioStaffReplySender implements StaffReplySender {
  private readonly sender: TwilioSmsSender;

  constructor(private readonly config: StaffReplySenderConfig) {
    this.sender = new TwilioSmsSender(
      config.accountSid,
      config.authToken,
      config.assistantNumber,
      config.clock,
      undefined,
      undefined,
      config.messagingServiceSid,
    );
  }

  async send(input: { orgId: OrgId; toPhone: string; body: string }): Promise<void> {
    const receipt = await this.sender.send({
      orgId: input.orgId,
      channel: "sms",
      to: input.toPhone,
      body: input.body,
      kind: "staff_assistant_reply",
      // The staffer's own number plus the minute is enough: two identical replies to one person
      // inside the same minute would be a duplicate send, not two answers.
      idempotencyKey: `staff-reply-${input.toPhone}-${Math.floor(this.config.clock.now().getTime() / 60_000)}`,
    });

    if (!receipt.ok) {
      // Loud, not swallowed: the staffer asked a question and got silence, and the only place that
      // is visible is here.
      logger.error({ orgId: input.orgId, kind: "staff_assistant_reply" }, "staff assistant reply failed to send");
      throw new Error("staff assistant reply failed to send");
    }
  }
}
