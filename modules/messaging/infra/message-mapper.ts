import { asMessageId, asOrgId, asLeadId } from "@mallet/shared/types";
import { Message } from "../domain/message";
import type { MessageDirection, MessageStatus, MessageChannel } from "../domain/message";

interface MessageRow {
  id: string;
  orgId: string;
  leadId: string | null;
  direction: string;
  channel: string;
  body: string;
  fromNumber: string;
  toNumber: string;
  providerSid: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export const toDomain = (row: MessageRow): Message => {
  const result = Message.create({
    id: asMessageId(row.id),
    orgId: asOrgId(row.orgId),
    leadId: row.leadId ? asLeadId(row.leadId) : null,
    direction: row.direction as MessageDirection,
    channel: row.channel as MessageChannel,
    body: row.body,
    fromNumber: row.fromNumber,
    toNumber: row.toNumber,
    providerSid: row.providerSid,
    status: row.status as MessageStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) throw new Error(`invalid message row: ${result.error.message}`);
  return result.value;
};
