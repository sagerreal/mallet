import type { OrgId } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import type { Message } from "../domain/message";
import type { MessageRepository, LeadByPhoneReader, LeadUnreadMarker } from "../domain/message-repository";

export interface RecordInboundCmd {
  readonly orgId: OrgId;
  readonly fromPhone: string; // E.164 — the customer's number
  readonly toPhone: string;   // E.164 — the org's Twilio number
  readonly body: string;
  readonly providerSid: string | null;
}

// Record an inbound SMS that Twilio delivered to the org's number. Attempts to match the
// sender's phone to an active lead within the org; if no match, records with leadId=null so
// no message is ever dropped. Also marks the matched lead unread so the customers list and
// home surface can surface the new reply. The webhook handler calls this INSIDE a withTenant tx.
export class RecordInboundMessageUseCase {
  constructor(
    private readonly repo: MessageRepository,
    private readonly leadReader: LeadByPhoneReader,
    private readonly ids: IdGenerator,
    // Optional: when provided, marks the matched lead unread after recording. Skipped when null
    // (e.g. in tests that don't need unread tracking) and when no lead matched.
    private readonly unreadMarker: LeadUnreadMarker | null = null,
  ) {}

  async exec(cmd: RecordInboundCmd): Promise<Message> {
    // Defense-in-depth: cap body to match the outbound 1600-char limit. Twilio enforces this on
    // outbound but the inbound Body field is pass-through — a malformed or concatenated segment
    // could exceed DB column expectations. Truncate rather than reject so no message is lost.
    const MAX_BODY = 1600;
    const body = cmd.body.length > MAX_BODY ? cmd.body.slice(0, MAX_BODY) : cmd.body;

    const match = await this.leadReader.findLeadByPhone(cmd.fromPhone);

    const message = await this.repo.recordInbound({
      id: this.ids.newId(),
      orgId: cmd.orgId,
      leadId: match?.leadId ?? null,
      body,
      fromNumber: cmd.fromPhone,
      toNumber: cmd.toPhone,
      providerSid: cmd.providerSid,
    });

    // Mark the matched lead unread so the owner sees the reply surfaced in the UI.
    // This runs in the same tenant tx as recordInbound — atomic commit or rollback together.
    // No-op when unreadMarker is not supplied or when no lead matched.
    if (match && this.unreadMarker) {
      await this.unreadMarker.markLeadUnread(match.leadId, new Date());
    }

    return message;
  }
}
