import type { MessageId, OrgId, LeadId, Result, ValidationError } from "@mallet/shared/types";
import { validation, ok, err } from "@mallet/shared/types";

export type MessageDirection = "inbound" | "outbound";
export type MessageStatus = "queued" | "sent" | "delivered" | "failed" | "received";
export type MessageChannel = "sms";

export const MESSAGE_DIRECTIONS: readonly MessageDirection[] = ["inbound", "outbound"] as const;
export const MESSAGE_STATUSES: readonly MessageStatus[] = [
  "queued",
  "sent",
  "delivered",
  "failed",
  "received",
] as const;

export interface MessageProps {
  readonly id: MessageId;
  readonly orgId: OrgId;
  readonly leadId: LeadId | null;
  readonly direction: MessageDirection;
  readonly channel: MessageChannel;
  readonly body: string;
  readonly fromNumber: string;
  readonly toNumber: string;
  readonly providerSid: string | null;
  readonly status: MessageStatus;
  /**
   * The CARRIER's reason a message failed (Twilio's numeric code as text), or null. Present only
   * on outbound failures — it is what turns "failed" into something a shop can act on.
   */
  readonly errorCode: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// A two-way message (SMS or future channel) scoped to an org. All construction goes through
// Message.create so invariants are enforced in one place. Immutable value object — no mutation.
export class Message {
  private constructor(private readonly p: MessageProps) {}

  static create(props: MessageProps): Result<Message, ValidationError> {
    if (props.body.trim().length === 0) {
      return err(validation("message body is required", "body"));
    }
    if (props.body.length > 1600) {
      return err(validation("message body exceeds 1600 character limit", "body"));
    }
    if (!MESSAGE_DIRECTIONS.includes(props.direction)) {
      return err(validation(`invalid direction: ${props.direction}`, "direction"));
    }
    if (!MESSAGE_STATUSES.includes(props.status)) {
      return err(validation(`invalid status: ${props.status}`, "status"));
    }
    return ok(new Message(props));
  }

  get props(): MessageProps {
    return this.p;
  }
}
