import type { A2pRegistration } from "./registration";

export interface RegistrationRepository {
  get(orgId: string): Promise<A2pRegistration | null>;
  save(reg: A2pRegistration): Promise<void>; // upsert by orgId (a2p_registrations_org_uidx)
}
