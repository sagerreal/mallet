import { asOrgId, asServiceId } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { pricebookItems } from "@mallet/shared/db/schema";
import { Service, isMeasuredByKind, type ServicePricedBy } from "../domain/service";

// The persistence row shape, inferred from the schema. The `Service` domain aggregate maps to
// the `pricebook_items` table (kept under its original name for additive-migration safety);
// `name` <- `label`.
export type ServiceRow = typeof pricebookItems.$inferSelect;

// `labor_hours` is `numeric(5,2)` — Drizzle (no `mode: "number"`) returns/accepts it as a
// string. The domain works in numbers throughout; convert at the read/write boundary only.
const toLaborHours = (v: string | null): number | null => (v == null ? null : Number(v));

export const laborHoursToColumn = (v: number | null): string | null =>
  v == null ? null : String(v);

/**
 * `measured_by` as THIS build understands it.
 *
 * The database is shared by every branch, and a branch that widens the `measured_by` CHECK applies
 * that migration to it before its code is deployed. So a perfectly legal row can carry a value this
 * build has never heard of — that is drift, not corruption, and it is confined to one optional
 * pricing hint on one row.
 *
 * It cost a whole pricebook once. A `soffit_sqft` row landed in the painting demo shop's book while
 * production still ran a build with no soffit in its set; the throw below took `service.list` down
 * with it and all seventeen services became "Couldn't load your pricebook." — quotes, invoices and
 * Front Desk pricing along with them.
 *
 * So: strict on write (the DB CHECK and the router's zod input both still refuse an unknown value,
 * and the output DTO enum still refuses to emit one), tolerant on read. The service loads and sells
 * at its unit price; it simply cannot be priced off a scan by a build that has no idea what the
 * unit means. Logged, because quietly dropping a pricing unit is the kind of thing that turns up
 * later as an underquote.
 */
const readMeasuredBy = (raw: string | null, rowId: string): ServicePricedBy | null => {
  if (raw === null || isMeasuredByKind(raw)) return raw;
  logger.warn(
    { pricebookItemId: rowId, measuredBy: raw },
    "pricebook.service.measured_by.unrecognized",
  );
  return null;
};

// Reconstruct a domain Service from a DB row. Corrupt data throws rather than silently
// coercing (mirrors job-mapper's toDomain/toVisit precedent). Cents stay integers — dollar
// conversion is store-side only (lib/store/dto-mapper.ts convention).
export const rowToService = (row: ServiceRow): Service => {
  const result = Service.create({
    id: asServiceId(row.id),
    orgId: asOrgId(row.orgId),
    categoryId: row.categoryId,
    code: row.code,
    name: row.label,
    description: row.description,
    unitPriceCents: row.unitPriceCents,
    costCents: row.costCents,
    laborHours: toLaborHours(row.laborHours),
    taxable: row.taxable,
    warrantyText: row.warrantyText,
    imageUrl: row.imageUrl,
    isAddon: row.isAddon,
    active: row.active,
    position: row.position,
    measuredBy: readMeasuredBy(row.measuredBy, row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) {
    throw new Error(`corrupt pricebook_item ${row.id}: ${result.error.message}`);
  }
  return result.value;
};
