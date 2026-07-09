import type { OrgId, LeadId, Result, AppError, Clock } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { notFound, err, ok } from "@mallet/shared/types";
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
}

export interface SendMessageCmd {
  readonly orgId: OrgId;
  readonly orgTwilioNumber: string | null; // from orgs.twilio_number
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

    const id = this.ids.newId();

    // Construct a sender with the org's from-number. TwilioSmsSender is the ONLY file that
    // imports the Twilio SDK; reusing it means circuit-breaking and logging come for free.
    const sender = new TwilioSmsSender(
      this.smsDeps.accountSid,
      this.smsDeps.authToken,
      cmd.orgTwilioNumber,
      this.smsDeps.clock,
      this.smsDeps.transport,
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
