import { asMessageId, asOrgId, asLeadId, asUserId } from "@mallet/shared/types";
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
  sentByUserId: string | null;
  status: string;
  errorCode: string | null;
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
    sentByUserId: row.sentByUserId ? asUserId(row.sentByUserId) : null,
    status: row.status as MessageStatus,
    errorCode: row.errorCode ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) throw new Error(`invalid message row: ${result.error.message}`);
  return result.value;
};
