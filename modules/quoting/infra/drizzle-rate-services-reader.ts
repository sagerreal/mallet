import { and, asc, eq, isNull, isNotNull } from "drizzle-orm";
import { pricebookItems } from "@mallet/shared/db/schema";
import type { TenantTx } from "@mallet/shared/db/tx";
import { asServiceId, type OrgId } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import type { RateService, RateServicesReader, MeasuredQuantityKind } from "../domain/rate-services-reader";

// Per-org catalogs are small (hundreds, not thousands) — a flat cap beats cursor plumbing for a
// rate lookup. Mirrors modules/quoting/infra/drizzle-service-name-reader.ts's NAME_CAP precedent.
const RATE_CAP = 500;

// The kind sets MEASURED_BY_KIND_SET/SITE_KIND_SET pin in modules/pricebook/domain/service.ts,
// duplicated here (never imported — quoting's app layer must not depend on pricebook internals)
// so a non-null `measured_by` column value can be narrowed WITHOUT a blind cast. The isNotNull
// filter below already guarantees non-null; this guards against a value the CHECK constraint
// doesn't (yet) recognize ever silently mis-typing as a valid kind.
const MEASURED_BY_KINDS: ReadonlySet<MeasuredQuantityKind> = new Set([
  "walls_sqft",
  "ceiling_sqft",
  "baseboard_lnft",
  "crown_lnft",
  "doors_count",
  "windows_count",
  "site_sqft",
  "site_lnft",
] satisfies MeasuredQuantityKind[]);

// 'hour' is a valid priced-by value too (hourly labor services) — the use-case skips those
// rows itself, but this reader must pass them through rather than throwing on them.
const isMeasuredByKind = (v: string): v is MeasuredQuantityKind | "hour" =>
  v === "hour" || MEASURED_BY_KINDS.has(v as MeasuredQuantityKind);

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
          // An add-on priced against a measured kind must never win that kind's rate — a
          // measured-by base service is what "Build the price" is standing in for.
          eq(pricebookItems.isAddon, false),
          isNull(pricebookItems.deletedAt),
          isNotNull(pricebookItems.measuredBy),
        ),
      )
      // Deterministic order matching the pricebook list's own display order (position, then
      // name) — see drizzle-service-repository.ts's list() comment. Every row also carries `id`
      // as a final tie-break so two same-position, same-label rows still resolve identically
      // regardless of heap/scan order. BuildFromMeasurementsUseCase's lowestPositionByKind
      // re-applies this exact ordering itself (never relies on query order alone), but this
      // ORDER BY keeps the two layers agreeing rather than one silently compensating for a bug
      // in the other.
      .orderBy(asc(pricebookItems.position), asc(pricebookItems.label), asc(pricebookItems.id))
      .limit(RATE_CAP + 1);

    const truncated = rows.length > RATE_CAP;
    const page = truncated ? rows.slice(0, RATE_CAP) : rows;
    if (truncated) {
      logger.warn(
        { orgId: this.orgId, cap: RATE_CAP },
        "quoting.rate_services_reader: measured-by service count exceeds the flat cap — results truncated",
      );
    }

    return page.map((r) => {
      // Safe: the isNotNull filter above guarantees a non-null column value; this still narrows
      // it explicitly rather than casting — unreachable today via the CHECK constraint, but a DB
      // read should never trust an untyped column through a blind `as`.
      if (r.measuredBy === null || !isMeasuredByKind(r.measuredBy)) {
        throw new Error(`pricebook_items ${r.id} has an unrecognized measured_by value`);
      }
      return {
        id: asServiceId(r.id),
        name: r.label,
        unitPriceCents: r.unitPriceCents,
        costCents: r.costCents,
        measuredBy: r.measuredBy,
        position: r.position,
      };
    });
  }
}
