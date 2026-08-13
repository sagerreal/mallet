import { and, eq, inArray } from "drizzle-orm";
import { paymentProfiles } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";

/**
 * The presentational card-on-file facts for a page of customers, in ONE read — what lets the
 * field surface render "Charge Visa ···· 4242" without ever holding a Stripe pointer.
 *
 * A module-LOCAL reader over the shared table, not an import of the invoicing module: invoicing
 * already imports @mallet/customers, so reaching for its barrel from the surfaces that list
 * customers would close a cycle. Same seam style as invoicing's own DrizzleJobReader (a focused
 * cross-domain read owns its columns; the writing module owns the canonical store). The columns
 * selected are the WHOLE point: brand, last4, via — never the cus_/pm_ pointers.
 */
export interface CardOnFileFacts {
  readonly brand: string;
  readonly last4: string;
  readonly via: "payment" | "deposit";
}

export class DrizzleCardOnFileReader {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async byLeadIds(leadIds: readonly string[]): Promise<Map<string, CardOnFileFacts>> {
    if (leadIds.length === 0) return new Map();
    const rows = await this.tx
      .select({
        leadId: paymentProfiles.leadId,
        brand: paymentProfiles.brand,
        last4: paymentProfiles.last4,
        via: paymentProfiles.via,
      })
      .from(paymentProfiles)
      .where(and(eq(paymentProfiles.orgId, this.orgId), inArray(paymentProfiles.leadId, [...leadIds])));
    return new Map(
      rows.map((r) => [
        r.leadId,
        { brand: r.brand, last4: r.last4, via: r.via as CardOnFileFacts["via"] },
      ]),
    );
  }
}
