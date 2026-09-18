import type { OutboundCallId } from "@mallet/shared/types";
import type { OutboundCall } from "./outbound-call";

// Persistence port for outbound calls. The org is deliberately absent from every signature:
// the repository is constructed with (tx, orgId) inside a withTenant transaction, so tenancy
// is structural rather than a parameter a caller could get wrong.
export interface OutboundCallRepository {
  create(call: OutboundCall): Promise<OutboundCall>;
  findById(id: OutboundCallId): Promise<OutboundCall | null>;
  // Used by the status webhook to bind a provider callback back to our row.
  findByProviderSid(providerCallSid: string): Promise<OutboundCall | null>;
  // Returns null when the row no longer exists (deleted or wrong tenant) — callers must
  // surface that as not_found rather than assuming the write landed.
  save(call: OutboundCall): Promise<OutboundCall | null>;
}
