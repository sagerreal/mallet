import { z } from "zod";
import type { OutboundCall } from "../domain/outbound-call";

export const outboundCallDTO = z.object({
  id: z.string().uuid(),
  leadId: z.string().uuid(),
  status: z.string(),
  // The number the customer sees — safe to show the office so they know which line went out.
  fromNumber: z.string(),
  toNumber: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationSec: z.number().nullable(),
  outcome: z.string().nullable(),
  notes: z.string(),
  createdAt: z.string(),
});

export type OutboundCallDTO = z.infer<typeof outboundCallDTO>;

// DTO ≠ domain: the provider call SID and the agent's personal mobile are deliberately NOT on
// the wire. Neither is useful to the client, and the agent number is staff PII.
export const toOutboundCallDTO = (call: OutboundCall): OutboundCallDTO => {
  const p = call.props;
  return {
    id: p.id,
    leadId: p.leadId,
    status: p.status,
    fromNumber: p.fromNumber,
    toNumber: p.toNumber,
    startedAt: p.startedAt?.toISOString() ?? null,
    endedAt: p.endedAt?.toISOString() ?? null,
    durationSec: p.durationSec,
    outcome: p.outcome,
    notes: p.notes,
    createdAt: p.createdAt.toISOString(),
  };
};
