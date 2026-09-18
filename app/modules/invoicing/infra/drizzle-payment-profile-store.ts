import { and, eq } from "drizzle-orm";
import { paymentProfiles } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import { asLeadId, isOk, type LeadId, type OrgId } from "@mallet/shared/types";
import { PaymentProfile, isCardOnFileVia } from "../domain/payment-profile";
import type { PaymentProfileStore } from "../domain/payment-profile-store";

/**
 * Real persistence for the card on file. Tenant-scoped tx (RLS) + explicit org filter on every
 * statement, the same belt-and-braces every repository here wears.
 *
 * `save` is the upsert the domain promises: ONE row per (org, lead), and the newest successful
 * payment replaces the pointers in place — `payment_profiles_org_lead_uidx` is the conflict
 * target. The row id deliberately keeps its original value on replace (the id names the SLOT,
 * not the capture event; nothing references it today, and a stable id is the less surprising
 * behaviour for anything that ever does).
 */
export class DrizzlePaymentProfileStore implements PaymentProfileStore {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async save(profile: PaymentProfile): Promise<void> {
    const p = profile.props;
    await this.tx
      .insert(paymentProfiles)
      .values({
        id: p.id,
        orgId: this.orgId,
        leadId: p.leadId,
        stripeCustomerId: p.stripeCustomerId,
        stripePaymentMethodId: p.stripePaymentMethodId,
        brand: p.brand,
        last4: p.last4,
        via: p.via,
        createdAt: p.savedAt,
        updatedAt: p.savedAt,
      })
      .onConflictDoUpdate({
        target: [paymentProfiles.orgId, paymentProfiles.leadId],
        set: {
          stripeCustomerId: p.stripeCustomerId,
          stripePaymentMethodId: p.stripePaymentMethodId,
          brand: p.brand,
          last4: p.last4,
          via: p.via,
          updatedAt: p.savedAt,
        },
      });
  }

  async findByLead(leadId: LeadId): Promise<PaymentProfile | null> {
    const rows = await this.tx
      .select()
      .from(paymentProfiles)
      .where(and(eq(paymentProfiles.orgId, this.orgId), eq(paymentProfiles.leadId, leadId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    // A row that fails domain validation is corrupt storage, not a card — treat as absent rather
    // than hand the charge path pointers the domain refused. The CHECK constraints make this
    // unreachable in practice.
    if (!isCardOnFileVia(row.via)) return null;
    const r = PaymentProfile.create({
      id: row.id,
      leadId: asLeadId(row.leadId),
      stripeCustomerId: row.stripeCustomerId,
      stripePaymentMethodId: row.stripePaymentMethodId,
      brand: row.brand,
      last4: row.last4,
      via: row.via,
      savedAt: row.updatedAt,
    });
    return isOk(r) ? r.value : null;
  }
}
