import type {
  OrgId,
  LeadId,
  UserId,
  Phone,
  Result,
  AppError,
  Clock,
} from "@mallet/shared/types";
import { Phone as PhoneParser, asOutboundCallId, ok, err, isOk, validation, conflict } from "@mallet/shared/types";
import type { IdGenerator } from "@mallet/shared/ports";
import { OutboundCall } from "../domain/outbound-call";
import type { OutboundCallRepository } from "../domain/outbound-call-repository";
import type { CallOriginator } from "../domain/call-originator";
import type { LeadPhoneReader, OrgLineReader, AgentNumberStore } from "../domain/call-directory";

export interface PlaceOutboundCallCmd {
  readonly orgId: OrgId;
  readonly leadId: LeadId;
  readonly placedByUserId: UserId;
  // Optional: when present it is used AND remembered, so the office types their mobile once
  // rather than on every call. When absent the stored number is used.
  readonly agentNumber?: string;
}

// Places a two-leg click-to-call: the provider rings the agent's own mobile first, and only
// once they answer is the customer bridged in with the org's business line as caller ID.
//
// Ordering is deliberate: the row is written BEFORE the provider is asked to dial, so a call
// that actually happens can never lack a record. The origination is the LAST action in the
// use-case for the same reason — everything that can fail cheaply fails first.
export class PlaceOutboundCallUseCase {
  constructor(
    private readonly calls: OutboundCallRepository,
    private readonly originator: CallOriginator,
    private readonly leads: LeadPhoneReader,
    private readonly orgLine: OrgLineReader,
    private readonly agents: AgentNumberStore,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async exec(cmd: PlaceOutboundCallCmd): Promise<Result<OutboundCall, AppError>> {
    const agent = await this.resolveAgentNumber(cmd);
    if (!isOk(agent)) return agent;

    const toNumber = await this.leads.findPhone(cmd.leadId);
    if (!toNumber) {
      return err(validation("this customer has no phone number on file", "leadId"));
    }

    const fromNumber = await this.orgLine.businessNumber();
    if (!fromNumber) {
      return err(conflict("your business line is not provisioned yet — no number to call from"));
    }

    const now = this.clock.now();
    const created = OutboundCall.create({
      id: asOutboundCallId(this.ids.newId()),
      orgId: cmd.orgId,
      leadId: cmd.leadId,
      placedByUserId: cmd.placedByUserId,
      toNumber,
      fromNumber,
      agentNumber: agent.value,
      status: "queued",
      providerCallSid: null,
      startedAt: null,
      endedAt: null,
      durationSec: null,
      outcome: null,
      notes: "",
      createdAt: now,
      updatedAt: now,
    });
    if (!isOk(created)) return created;

    const row = await this.calls.create(created.value);

    // LAST: the external side effect. Anything above this point failing means no call happened.
    const receipt = await this.originator.originate({
      callId: row.props.id,
      agentNumber: row.props.agentNumber,
      fromNumber: row.props.fromNumber,
    });

    if (!isOk(receipt)) {
      // Record the failure rather than leaving the row stuck at "queued" forever.
      const failed = row.applyProviderStatus("failed", null, this.clock.now());
      if (isOk(failed)) await this.calls.save(failed.value);
      return receipt;
    }

    const dialing = row.markDialing(receipt.value.providerCallSid, this.clock.now());
    if (!isOk(dialing)) return dialing;

    const saved = await this.calls.save(dialing.value);
    if (!saved) return err(conflict("the call record disappeared while dialing"));
    return ok(saved);
  }

  // Supplied number wins and is remembered; otherwise fall back to the stored one.
  private async resolveAgentNumber(cmd: PlaceOutboundCallCmd): Promise<Result<Phone, AppError>> {
    const stored = await this.agents.find(cmd.placedByUserId);

    if (cmd.agentNumber === undefined || cmd.agentNumber.trim().length === 0) {
      if (!stored) {
        // Tagged so the client can point at the exact setting to fix rather than matching on the
        // sentence. Conflict, not validation: nothing the caller SENT is wrong — a prerequisite
        // is missing.
        return err(
          conflict(
            "add the mobile number Mallet should ring you on before placing a call",
            "agentNumber",
          ),
        );
      }
      return ok(stored);
    }

    const parsed = PhoneParser.parse(cmd.agentNumber);
    if (!isOk(parsed)) return parsed;
    if (parsed.value !== stored) await this.agents.save(cmd.placedByUserId, parsed.value);
    return ok(parsed.value);
  }
}
