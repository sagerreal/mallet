import { and, eq, inArray, isNull } from "drizzle-orm";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import { pricebookItems } from "@mallet/shared/db/schema";
import type { PricebookPriceReader } from "../domain/pricebook-price-reader";

/**
 * PricebookPriceReader over the live pricebook table. One IN-list query for the
 * handful of linked services on a playbook — safe inside the Vapi time budget.
 * Cents on disk → DOLLARS out (the Front Desk speaks dollars; no arithmetic
 * beyond the one conversion). Archived entries are excluded, so a dangling link
 * falls back to the service's stored price upstream.
 */
export class DrizzlePricebookPriceReader implements PricebookPriceReader {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async unitPricesByIds(ids: readonly string[]): Promise<ReadonlyMap<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.tx
      .select({ id: pricebookItems.id, unitPriceCents: pricebookItems.unitPriceCents })
      .from(pricebookItems)
      .where(
        and(
          eq(pricebookItems.orgId, this.orgId),
          inArray(pricebookItems.id, [...ids]),
          isNull(pricebookItems.deletedAt),
        ),
      );
    return new Map(rows.map((r) => [r.id, r.unitPriceCents / 100]));
  }
}
