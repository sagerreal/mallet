import { z } from "zod";
import { lineCents, totalCents, type PurchaseOrder } from "../domain/purchase-order";
import type { PONoteRow } from "../domain/purchase-order-repository";
import { fromDate } from "../infra/purchase-order-mapper";

// The wire contract for purchase orders — kept out of purchase-order-router.ts so the router
// stays thin transport and this file is the one place the shape is stated. Mirrors
// modules/companies/api/company-dto.ts (output DTO + mapper; input schemas live in the router,
// same split company-router.ts uses).

const moneyDTO = z.object({ cents: z.number().int(), currency: z.literal("USD") });
export const money$ = (cents: number) => ({ cents, currency: "USD" as const });

export const purchaseOrderLineDTO = z.object({
  id: z.string().uuid(),
  description: z.string(),
  qty: z.number(),
  uom: z.string(),
  unitCostMillicents: z.number().int(),
  amount: moneyDTO,
});

export const purchaseOrderDTO = z.object({
  id: z.string().uuid(),
  num: z.string().nullable(),
  vendor: z.string(),
  status: z.enum(["draft", "ordered", "cancelled"]),
  jobId: z.string().uuid().nullable(),
  // Resolved server-side from jobId — never a store lookup, and never derived here: the router
  // hands it in, batched across the whole page in one query. See displayExtrasFor.
  jobTitle: z.string().nullable(),
  // Calendar dates (postgres `date` columns), not instants — "YYYY-MM-DD" via the SAME fromDate()
  // the repository uses to write them, so the wire format can never drift from what's stored. A
  // bare .toISOString() here would reintroduce the day-shift bug documented on the mapper's
  // noon-anchor: a LOCAL noon converted to UTC only rolls onto a different calendar day once the
  // server's zone passes UTC+12 (UTC+13/+14 — Kiribati, Tonga) — every zone from UTC−11 through
  // UTC+11 leaves local noon within the same UTC day. So the hazard runs EASTERN, not western;
  // fromDate()/toDate() sidestep it entirely rather than depend on which zone the server runs in.
  orderedAt: z.string().nullable(),
  expectedAt: z.string().nullable(),
  shipTo: z.enum(["counter_pickup", "job_site", "shop"]),
  // Stamped server-side from ctx.principal on create — never a client input (see the router's
  // create). Writable-and-unreadable is not a valid state for a field, so both the raw id and its
  // resolved display name are on the wire; a client that needs to re-target it can't, by design.
  orderedByUserId: z.string().uuid().nullable(),
  // Resolved from orderedByUserId the same way jobTitle is.
  orderedByName: z.string().nullable(),
  freight: moneyDTO,
  tax: moneyDTO,
  total: moneyDTO,
  lines: z.array(purchaseOrderLineDTO),
  createdAt: z.string(),
});
export type PurchaseOrderDTO = z.infer<typeof purchaseOrderDTO>;

/** Display fields resolved OUTSIDE the aggregate — a join the router does, batched. */
export interface PurchaseOrderDisplayExtras {
  readonly jobTitle: string | null;
  readonly orderedByName: string | null;
}

const NO_EXTRAS: PurchaseOrderDisplayExtras = { jobTitle: null, orderedByName: null };

export const toPurchaseOrderDTO = (
  po: PurchaseOrder,
  extras: PurchaseOrderDisplayExtras = NO_EXTRAS,
): PurchaseOrderDTO => {
  const p = po.props;
  return {
    id: p.id,
    num: p.num,
    vendor: p.vendor,
    status: p.status,
    jobId: p.jobId,
    jobTitle: extras.jobTitle,
    orderedAt: fromDate(p.orderedAt),
    expectedAt: fromDate(p.expectedAt),
    shipTo: p.shipTo,
    orderedByUserId: p.orderedByUserId,
    orderedByName: extras.orderedByName,
    freight: money$(p.freightCents),
    tax: money$(p.taxCents),
    total: money$(totalCents(po)),
    lines: [...p.lines]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        id: l.id,
        description: l.description,
        qty: l.qty,
        uom: l.uom,
        unitCostMillicents: l.unitCostMillicents,
        amount: money$(lineCents(l)),
      })),
    createdAt: p.createdAt.toISOString(),
  };
};

/** One entry in a purchase order's note trail. */
export const purchaseOrderNoteDTO = z.object({
  id: z.string().uuid(),
  body: z.string(),
  authorUserId: z.string().uuid().nullable(),
  // Resolved the same way orderedByName is — a raw id is not useful on a feed without a second
  // round trip to name it.
  authorName: z.string().nullable(),
  attachmentPath: z.string().nullable(),
  attachmentName: z.string().nullable(),
  attachmentType: z.string().nullable(),
  createdAt: z.string(),
});
export type PurchaseOrderNoteDTO = z.infer<typeof purchaseOrderNoteDTO>;

export const toPurchaseOrderNoteDTO = (note: PONoteRow, authorName: string | null): PurchaseOrderNoteDTO => ({
  id: note.id,
  body: note.body,
  authorUserId: note.authorUserId,
  authorName,
  attachmentPath: note.attachmentPath,
  attachmentName: note.attachmentName,
  attachmentType: note.attachmentType,
  createdAt: note.createdAt.toISOString(),
});
