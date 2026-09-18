import type { A2pRegistration } from "./registration";
import type { OrgId } from "@mallet/shared/types";

export interface RegistrationRepository {
  get(orgId: string): Promise<A2pRegistration | null>;
  save(reg: A2pRegistration): Promise<void>; // upsert by orgId (a2p_registrations_org_uidx)
}

// Privileged reader used ONLY by the unauthenticated Twilio status-callback webhook (Task 11) —
// the callback arrives with no principal/org context, carrying just a Twilio resource SID
// (secondary customer profile / brand / campaign), so the org must be discovered BEFORE any
// tenant-scoped (RLS) session can be opened. Mirrors `OrgByNumberReader` in the messaging module.
export interface OrgBySidReader {
  findOrgIdBySid(sid: string): Promise<OrgId | null>;
}
