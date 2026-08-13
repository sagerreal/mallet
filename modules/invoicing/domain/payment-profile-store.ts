import type { LeadId } from "@mallet/shared/types";
import type { PaymentProfile } from "./payment-profile";

/**
 * Persistence port for the card on file. `save` is an UPSERT on the customer: one card per lead,
 * newest successful payment wins (see payment-profile.ts). `findByLead` is what the charge path
 * reads — the full profile, Stripe pointers included, which is why it exists on this port and
 * never on a list DTO.
 */
export interface PaymentProfileStore {
  save(profile: PaymentProfile): Promise<void>;
  findByLead(leadId: LeadId): Promise<PaymentProfile | null>;
}
