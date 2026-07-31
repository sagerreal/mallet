import { asc, eq } from "drizzle-orm";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId } from "@mallet/shared/types";
import { pricebookMarkupBands } from "@mallet/shared/db/schema";
import type { MarkupBandsRepository } from "../domain/material-repository";

/**
 * The org's cost-banded markup table. Tiny by construction (5–8 rows), so replaceAll is a
 * delete + insert inside the tenant tx — atomic, and the unique (org_id, min_cost_cents)
 * constraint rejects duplicate floors at the DB. Empty list = org uses DEFAULT_MARKUP_BANDS.
 */
export class DrizzleMarkupBandsRepository implements MarkupBandsRepository {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async list(): Promise<{ minCostCents: number; markupBps: number }[]> {
    const rows = await this.tx
      .select({ minCostCents: pricebookMarkupBands.minCostCents, markupBps: pricebookMarkupBands.markupBps })
      .from(pricebookMarkupBands)
      .where(eq(pricebookMarkupBands.orgId, this.orgId))
      .orderBy(asc(pricebookMarkupBands.minCostCents));
    return rows;
  }

  async replaceAll(bands: { minCostCents: number; markupBps: number }[]): Promise<void> {
    await this.tx.delete(pricebookMarkupBands).where(eq(pricebookMarkupBands.orgId, this.orgId));
    if (bands.length === 0) return;
    await this.tx.insert(pricebookMarkupBands).values(
      bands.map((b) => ({
        orgId: this.orgId,
        minCostCents: Math.max(0, Math.round(b.minCostCents)),
        markupBps: Math.max(0, Math.round(b.markupBps)),
      })),
    );
  }
}
