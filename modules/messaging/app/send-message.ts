import type { OrgId, LeadId, Result, AppError, Clock } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { notFound, conflict, err, ok } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { SmsTransport } from "../../notifications/infra/twilio-sms-sender";
import { TwilioSmsSender } from "../../notifications/infra/twilio-sms-sender";
import type { Message } from "../domain/message";
import type { MessageRepository } from "../domain/message-repository";

export interface SendMessageDeps {
  readonly accountSid: string;
  readonly authToken: string;
  readonly clock: Clock;
  // Injected in tests to replace the real Twilio HTTP call.
  readonly transport?: SmsTransport;
  /**
   * The app's public https origin, so Twilio can be told where to report delivery. Absent in dev
   * and in tests — sends still work, they are just status-blind, which is exactly the behaviour
   * that existed before delivery status was wired.
   */
  readonly publicAppUrl?: string;
}

export interface SendMessageCmd {
  readonly orgId: OrgId;
  readonly orgTwilioNumber: string | null; // from orgs.twilio_number
  // From a2p_registrations.status === "active" for this org (read by the caller — the router —
  // exactly like orgTwilioNumber; keeps this use case pure, no DB reader injected here).
  readonly a2pActive: boolean;
  /**
   * The org's A2P Messaging Service SID, read by the caller alongside a2pActive.
   *
   * Carriers check the SERVICE, not the number: a 10DLC campaign attaches to a Messaging Service,
   * and a send that names a bare `from` number is treated as unregistered traffic even when that
   * number sits in the service's sender pool.
   */
  readonly messagingServiceSid: string | null;
  readonly leadId: LeadId;
  readonly leadPhone: string; // E.164 from leads.phone_e164
  readonly body: string;
}

// Send an outbound SMS to a lead. Uses the org's own provisioned Twilio number as the `from`
// (per-org texting identity). Constructs a TwilioSmsSender per call so the `from` number is
// the org's number — the constructor-arg seam in TwilioSmsSender is the designed extension
// point for dynamic from-numbers. A rejected submission (Twilio refused to accept the message)
// returns err() and records NO row — the explicit error is the visibility signal; nothing is
// silently swallowed.
export class SendMessageUseCase {
  constructor(
    private readonly repo: MessageRepository,
    private readonly smsDeps: SendMessageDeps,
    private readonly ids: IdGenerator,
  ) {}

  async exec(cmd: SendMessageCmd): Promise<Result<Message, AppError>> {
    if (!cmd.orgTwilioNumber) {
      return err(notFound("this org has no texting number provisioned yet"));
    }

    // Gate outbound SMS on the org's 10DLC campaign being active — Twilio (and carriers) will
    // filter/reject unregistered A2P traffic, and sending before approval risks the org's
    // standing. Same "current state disallows the action" shape as the invoice/job status
    // gates (create-payment.ts, create-job-from-estimate.ts) — conflict is the established
    // AppError for that, not a new kind.
    if (!cmd.a2pActive) {
      return err(conflict("texting isn't approved for this org yet — finish 10DLC registration"));
    }

    const id = this.ids.newId();

    // Construct a sender with the org's from-number. TwilioSmsSender is the ONLY file that
    // imports the Twilio SDK; reusing it means circuit-breaking and logging come for free.
    const sender = new TwilioSmsSender(
      this.smsDeps.accountSid,
      this.smsDeps.authToken,
      cmd.orgTwilioNumber,
      this.smsDeps.clock,
      this.smsDeps.transport,
      this.smsDeps.publicAppUrl,
      // The 7th argument was omitted, so every two-way text went out naming a bare `from` number.
      // cmd.messagingServiceSid was read by the router and declared here and then silently dropped
      // — the campaign attaches to the SERVICE, so a bare number reads as unregistered traffic to
      // carriers even with an approved campaign and the number sitting in that service's pool.
      cmd.messagingServiceSid ?? undefined,
    );

    const receipt = await sender.send({
      orgId: cmd.orgId,
      channel: "sms",
      to: cmd.leadPhone,
      body: cmd.body,
      kind: "two_way_sms",
      idempotencyKey: `msg-${id}`,
    });

    if (!receipt.ok) {
      logger.warn({ kind: "two_way_sms" }, "outbound sms send rejected");
      return err(receipt.error);
    }

    const message = await this.repo.recordOutbound({
      id,
      orgId: cmd.orgId,
      leadId: cmd.leadId,
      body: cmd.body,
      fromNumber: cmd.orgTwilioNumber,
      toNumber: cmd.leadPhone,
      providerSid: receipt.value.externalId ?? null,
      status: "sent",
    });

    return ok(message);
  }
}
