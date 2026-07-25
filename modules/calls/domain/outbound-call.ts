import type {
  OutboundCallId,
  OrgId,
  LeadId,
  UserId,
  Phone,
  Result,
  ValidationError,
} from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

// How the call reaches the person who placed it.
//   phone   — the two-leg bridge: Twilio rings their own handset, then dials the customer.
//   browser — the softphone: their microphone IS the leg, so nothing rings and there is no
//             agent number. Twilio dials only the customer.
export type CallTransport = "phone" | "browser";

export const CALL_TRANSPORTS: readonly CallTransport[] = ["phone", "browser"];

export const isCallTransport = (v: string): v is CallTransport =>
  (CALL_TRANSPORTS as readonly string[]).includes(v);

// The lifecycle of a click-to-call. On the phone transport there are two legs: Twilio rings the
// AGENT first ("dialing"), and only once they answer does it bridge the customer ("in_progress").
// On the browser transport "dialing" is the customer's phone ringing.
export type OutboundCallStatus =
  | "queued"
  | "dialing"
  | "in_progress"
  | "completed"
  | "failed"
  | "no_answer"
  | "busy"
  | "canceled";

// Once a call ends it stays ended — a late or replayed status webhook must not resurrect it
// or overwrite the first recorded ending.
const TERMINAL: ReadonlySet<OutboundCallStatus> = new Set([
  "completed",
  "failed",
  "no_answer",
  "busy",
  "canceled",
]);

// Twilio's call-status vocabulary → ours. Unknown values are rejected rather than ignored,
// so a provider change surfaces as an error instead of a silently stuck call.
const PROVIDER_STATUS: Readonly<Record<string, OutboundCallStatus>> = {
  queued: "dialing",
  initiated: "dialing",
  ringing: "dialing",
  "in-progress": "in_progress",
  completed: "completed",
  busy: "busy",
  "no-answer": "no_answer",
  failed: "failed",
  canceled: "canceled",
};

export interface OutboundCallProps {
  readonly id: OutboundCallId;
  readonly orgId: OrgId;
  readonly leadId: LeadId;
  readonly placedByUserId: UserId;
  readonly toNumber: Phone;
  readonly fromNumber: Phone;
  // Null on a browser call — there is no handset to ring.
  readonly agentNumber: Phone | null;
  readonly transport: CallTransport;
  readonly status: OutboundCallStatus;
  readonly providerCallSid: string | null;
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
  readonly durationSec: number | null;
  readonly outcome: string | null;
  readonly notes: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// An outbound call placed by the office. All transitions return a NEW OutboundCall
// (immutability); the factory enforces invariants so an invalid call cannot exist.
export class OutboundCall {
  private constructor(private readonly p: OutboundCallProps) {}

  static create(props: OutboundCallProps): Result<OutboundCall, ValidationError> {
    // A phone call rings a handset, so it needs one; a browser call must NOT carry a number,
    // because storing one would imply a leg that is never dialled.
    if (props.transport === "phone" && props.agentNumber === null) {
      return err(validation("a phone call needs the number to ring", "agentNumber"));
    }
    if (props.transport === "browser" && props.agentNumber !== null) {
      return err(validation("a browser call has no number to ring", "agentNumber"));
    }
    // Bridging a number to itself would dial the agent into their own leg.
    if (props.agentNumber !== null && props.agentNumber === props.toNumber) {
      return err(validation("the agent and customer numbers must differ", "agentNumber"));
    }
    return ok(new OutboundCall({ ...props, notes: props.notes.trim() }));
  }

  // The provider accepted the request: ringing the agent leg on a phone call, or — on a browser
  // call — the client has connected and Twilio has told us the SID of its leg.
  markDialing(providerCallSid: string, now: Date): Result<OutboundCall, ValidationError> {
    if (TERMINAL.has(this.p.status)) {
      return err(validation(`cannot dial a call that already ended (${this.p.status})`, "status"));
    }
    const sid = providerCallSid.trim();
    if (sid.length === 0) {
      // A blank SID would leave a row the status webhook can never match back.
      return err(validation("provider call sid is required", "providerCallSid"));
    }
    return OutboundCall.create({ ...this.p, status: "dialing", providerCallSid: sid, updatedAt: now });
  }

  // Applied from the Twilio status callback.
  applyProviderStatus(
    providerStatus: string,
    durationSec: number | null,
    now: Date,
  ): Result<OutboundCall, ValidationError> {
    const next = PROVIDER_STATUS[providerStatus];
    if (!next) {
      return err(validation(`unknown provider call status: "${providerStatus}"`, "status"));
    }
    if (durationSec !== null && durationSec < 0) {
      return err(validation("call duration cannot be negative", "durationSec"));
    }
    // Already ended: accept the webhook (so Twilio stops retrying) but keep the first ending.
    if (TERMINAL.has(this.p.status)) return ok(this);

    const ended = TERMINAL.has(next);
    return OutboundCall.create({
      ...this.p,
      status: next,
      // First connect wins — a repeated in-progress must not move the start time.
      startedAt: next === "in_progress" && this.p.startedAt === null ? now : this.p.startedAt,
      endedAt: ended ? now : this.p.endedAt,
      durationSec: durationSec ?? this.p.durationSec,
      updatedAt: now,
    });
  }

  // The office picked a disposition after hanging up. This is what makes the row a call LOG.
  logOutcome(outcome: string, notes: string, now: Date): Result<OutboundCall, ValidationError> {
    const chosen = outcome.trim();
    if (chosen.length === 0) return err(validation("call outcome is required", "outcome"));
    return OutboundCall.create({ ...this.p, outcome: chosen, notes, updatedAt: now });
  }

  get props(): OutboundCallProps {
    return this.p;
  }
}
