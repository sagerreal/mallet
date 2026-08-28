import { asOrgId, isOk } from "@mallet/shared/types";
import { purchaseOrders, purchaseOrderLines } from "@mallet/shared/db/schema";
import { PurchaseOrder, type POLineProps, type PurchaseOrderProps } from "../domain/purchase-order";

export type PORow = typeof purchaseOrders.$inferSelect;
export type POLineRow = typeof purchaseOrderLines.$inferSelect;

/** `date` columns read back as "YYYY-MM-DD"; noon-anchored so no timezone rolls the day. */
export const toDate = (s: string | null): Date | null => (s ? new Date(`${s}T12:00:00`) : null);

/**
 * Inverse of `toDate`: the local calendar date of `d`, as "YYYY-MM-DD". Symmetric with the
 * noon-local anchoring on read, so a date written here and read back via `toDate` lands on the
 * same day regardless of the process timezone.
 */
export const fromDate = (d: Date | null): string | null => {
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/** numeric(12,3) reads back as a STRING — coerce or every quantity multiplies as NaN. */
export const toLine = (r: POLineRow): POLineProps => ({
  id: r.id,
  description: r.description,
  qty: Number(r.qty),
  uom: r.uom,
  unitCostMillicents: r.unitCostMillicents,
  position: r.position,
});

export const toProps = (r: PORow, lines: readonly POLineRow[]): PurchaseOrderProps => ({
  id: r.id,
  orgId: asOrgId(r.orgId),
  num: r.num,
  vendor: r.vendor,
  status: r.status as PurchaseOrderProps["status"],
  jobId: r.jobId,
  orderedAt: toDate(r.orderedAt),
  expectedAt: toDate(r.expectedAt),
  shipTo: r.shipTo as PurchaseOrderProps["shipTo"],
  orderedByUserId: r.orderedByUserId,
  freightCents: r.freightCents,
  taxCents: r.taxCents,
  lines: [...lines].sort((a, b) => a.position - b.position).map(toLine),
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

// Reconstruct the aggregate. Corrupt data fails loud rather than silently coercing (mirrors
// invoice-mapper / job-mapper) — a row that no longer satisfies the domain invariants means the
// invariants changed underneath already-persisted data, not that the read should paper over it.
export const toDomain = (r: PORow, lines: readonly POLineRow[]): PurchaseOrder => {
  const result = PurchaseOrder.create(toProps(r, lines));
  if (!isOk(result)) throw new Error(`corrupt purchase_order ${r.id}: ${result.error.message}`);
  return result.value;
};
