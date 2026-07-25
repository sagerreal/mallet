import {
  asOutboundCallId,
  asOrgId,
  asLeadId,
  asUserId,
  asPhone,
  isOk,
} from "@mallet/shared/types";
import { OutboundCall, type OutboundCallStatus } from "../domain/outbound-call";

// The row shape as Drizzle returns it. Kept structural so the mapper does not depend on the
// schema module's inferred type (DTO ≠ domain, and neither is the row).
export interface OutboundCallRow {
  id: string;
  orgId: string;
  leadId: string;
  placedByUserId: string;
  toNumber: string;
  fromNumber: string;
  agentNumber: string;
  status: string;
  providerCallSid: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSec: number | null;
  outcome: string | null;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

// Row → domain. Numbers are cast (not parsed): they were validated on the way in and are
// already E.164 in the database. A row that somehow violates a domain invariant throws —
// silently returning a half-valid entity would be worse than a loud read failure.
export const toDomain = (row: OutboundCallRow): OutboundCall => {
  const result = OutboundCall.create({
    id: asOutboundCallId(row.id),
    orgId: asOrgId(row.orgId),
    leadId: asLeadId(row.leadId),
    placedByUserId: asUserId(row.placedByUserId),
    toNumber: asPhone(row.toNumber),
    fromNumber: asPhone(row.fromNumber),
    agentNumber: asPhone(row.agentNumber),
    status: row.status as OutboundCallStatus,
    providerCallSid: row.providerCallSid,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    durationSec: row.durationSec,
    outcome: row.outcome,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!isOk(result)) {
    throw new Error(`outbound_calls row ${row.id} violates a domain invariant: ${result.error.message}`);
  }
  return result.value;
};
