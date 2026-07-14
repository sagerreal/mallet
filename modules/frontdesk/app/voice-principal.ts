import { asUserId, type OrgId } from "@mallet/shared/types";
import type { Principal } from "@mallet/identity";

// The voice agent acts as office staff, but a phone call has no logged-in user. Tenancy comes
// ONLY from the To-number → orgId lookup (set on the tenant tx), and the two write use-cases the
// voice tools use (EnsureCustomerUseCase, CreateTaskUseCase) take orgId explicitly and do NOT
// consume principal.userId for tenancy or persistence (verified: neither leads nor tasks has a
// created_by/user FK). So a documented sentinel userId is correct and side-effect-free here — it
// exists only to satisfy the Principal shape the tool context requires. Role is "office" because
// the front desk performs office-level actions (create customer, file task).
export const VOICE_PRINCIPAL_USER_ID = "00000000-0000-0000-0000-0000000f0de5"; // "f0de5k" ≈ "front desk"

export const voicePrincipal = (orgId: OrgId): Principal => ({
  userId: asUserId(VOICE_PRINCIPAL_USER_ID),
  orgId,
  role: "office",
});
