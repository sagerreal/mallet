import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { pricebookItems } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import { asServiceId, type OrgId } from "@mallet/shared/types";
import type { RateService, RateServicesReader, PaintingQuantityKind } from "../domain/rate-services-reader";

// Per-org catalogs are small (hundreds, not thousands) — a flat cap beats cursor plumbing for a
// rate lookup. Mirrors modules/quoting/infra/drizzle-service-name-reader.ts's NAME_CAP precedent.
const RATE_CAP = 500;

// Real persistence over pricebook's own table, reached only from quoting's infra (the same
// cross-module pattern modules/jobs/infra/drizzle-estimate-reader.ts uses against quoting's
// repository) — quoting's app layer never imports pricebook directly, only this port.
export class DrizzleRateServicesReader implements RateServicesReader {
  constructor(
    private readonly tx: TenantTx,
    private readonly orgId: OrgId,
  ) {}

  async listMeasuredByActive(): Promise<RateService[]> {
    const rows = await this.tx
      .select({
        id: pricebookItems.id,
        label: pricebookItems.label,
        unitPriceCents: pricebookItems.unitPriceCents,
        costCents: pricebookItems.costCents,
        measuredBy: pricebookItems.measuredBy,
        position: pricebookItems.position,
      })
      .from(pricebookItems)
      .where(
        and(
          eq(pricebookItems.orgId, this.orgId),
          eq(pricebookItems.active, true),
          isNull(pricebookItems.deletedAt),
          isNotNull(pricebookItems.measuredBy),
        ),
      )
      .limit(RATE_CAP);

    return rows.map((r) => ({
      id: asServiceId(r.id),
      name: r.label,
      unitPriceCents: r.unitPriceCents,
      costCents: r.costCents,
      // Safe: the isNotNull filter above guarantees a non-null column value.
      measuredBy: r.measuredBy as PaintingQuantityKind,
      position: r.position,
    }));
  }
}
