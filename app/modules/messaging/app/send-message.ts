import type { OrgId, LeadId, Result, AppError, Clock, UserId } from "@mallet/shared/types";
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
  /**
   * The staffer sending as the business — every interactive send has one (this use case is
   * only reached through an authenticated principal). Recorded on the row so the thread can
   * show "sent by Dana" next to the shared business number.
   */
  readonly senderUserId: UserId;
  /**
   * The caller's dedupe token. Two sends carrying the same key produce ONE text — the second gets
   * the first one's row back. Absent (an ad-hoc text typed in the inbox), a unique key is
   * generated per call, which is exactly the pre-existing behaviour: every send goes out.
   */
  readonly idempotencyKey?: string;
}

// Send an outbound SMS to a lead. Uses the org's own provisioned Twilio number as the `from`
// (per-org texting identity). Constructs a TwilioSmsSender per call so the `from` number is
// the org's number — the constructor-arg seam in TwilioSmsSender is the designed extension
// point for dynamic from-numbers.
//
// CLAIM-FIRST (same shape as SendNotificationUseCase): the ledger row is written before Twilio is
// called, so the unique index on (org_id, idempotency_key) is what decides whether a send happens.
//
// WHAT THE KEY GUARANTEES, EXACTLY:
//   • A duplicate of a SUCCESSFUL send can never send again. The row committed with the key, and
//     any later claim on it returns that row untouched — the customer never gets the second text.
//     This is the double-click case the key exists for.
//   • A duplicate of an IN-FLIGHT send (a concurrent request) is deduped the same way: the second
//     claim sees a queued row and returns it without calling Twilio.
//   • A FAILED send deliberately leaves the key reusable. Nothing reached the customer, and the
//     board's keys are deterministic ("<okItemKey>-d<YYYYMMDD>" — the record plus the shop's own
//     day, see features/home/send.ts okSendKey), so a burnt key would strand that reminder for the
//     REST OF THE DAY: the salt turns over at midnight, so the office could not retry until
//     tomorrow. The claim reclaims the same row and sends again.
//   • An UNKNOWN outcome is the accepted gap. Twilio can accept a message and still fail us — a
//     10s timeout, a 5xx, an open breaker — and that request rolls back (the orgTx middleware
//     re-throws inside the tx), releasing the key. A user who then retries manually can produce a
//     second text. Accepted at pilot scale: it needs a timeout AND a manual retry, and the
//     alternative (claiming on a connection outside the request tx) buys little at this volume.
//
// Every precondition is checked BEFORE the claim, so an org that has no number yet, or no approved
// campaign, never burns its key. A rejected submission returns err() and settles the claim as
// failed — the explicit error is the visibility signal; nothing is silently swallowed.
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
    // No caller key → a fresh key per call, so keyless sends stay independent (today's behaviour).
    const idempotencyKey = cmd.idempotencyKey ?? `msg-${id}`;

    // Claim BEFORE sending. `created: false` means this exact send already happened, or is in
    // flight in a concurrent request — return that row instead of texting the customer twice.
    // Never an error: a duplicate is a no-op that reports the message the caller asked about.
    const claim = await this.repo.claimOutbound({
      id,
      leadId: cmd.leadId,
      sentByUserId: cmd.senderUserId,
      from: cmd.orgTwilioNumber,
      to: cmd.leadPhone,
      body: cmd.body,
      idempotencyKey,
    });

    if (!claim.created) return ok(claim.message);

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
      idempotencyKey,
    });

    if (!receipt.ok) {
      // Identifiers and flags only — never the body or the destination number. The provider's
      // own numeric code/status is logged by TwilioSmsSender at the point it is known; it is not
      // carried on the AppError, so it cannot be restated here.
      logger.warn(
        {
          kind: "two_way_sms",
          orgId: cmd.orgId,
          messageId: claim.message.props.id,
          service: receipt.error.service,
          retryable: receipt.error.retryable,
        },
        "outbound sms send rejected",
      );
      // errorCode holds the CARRIER's numeric code, and a submission Twilio refused has none yet
      // — those arrive on the status callback. null keeps the column honest rather than stamping
      // an app-side label into a carrier field.
      await this.repo.markFailed(claim.message.props.id, null);
      return err(receipt.error);
    }

    const providerSid = receipt.value.externalId ?? null;
    await this.repo.markSent(claim.message.props.id, providerSid);
    return ok(claim.message.markSent(providerSid, this.smsDeps.clock.now()));
  }
}
