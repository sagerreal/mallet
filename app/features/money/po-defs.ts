/**
 * features/money/po-defs.ts
 *
 * THE ONE SOURCE BOTH PO MODALS READ. The create modal and the record sheet must feel like one
 * record, and the only way that survives a year of edits is a shared definition rather than a
 * shared intention: labels, field order, the status vocabulary and the collapsed-line summaries
 * all live here, and both surfaces map them. Same mechanism room-card-modal.tsx uses to hold a
 * create form and a record viewer in one file without drift.
 *
 * Ported from the approved design on mock/money-purchase-orders — labels, field order, the
 * status vocabulary and the summaries carry over unchanged. The one real change is the types:
 * the mock's local PO/POLine/PONote interfaces are gone in favor of the store's own
 * PurchaseOrder/PurchaseOrderLine/PurchaseOrderNote (lib/store/types.ts), built in Task 6 against
 * the real server. Money on those types is DOLLARS (`freight`, `tax`); the numeric helpers below
 * convert to cents at the point they need to, exactly as the mock's cents-domain math did.
 */

import type { POStatus, PurchaseOrder, PurchaseOrderLine } from "@/lib/store/types";

export type { POStatus };

/** One vocabulary, one token pair each. Neither modal may invent a label. */
export const PO_STATUS_META: Record<POStatus, { label: string; c: string; bg: string }> = {
  draft: { label: "Draft", c: "var(--ink-3)", bg: "var(--paper)" },
  ordered: { label: "Ordered", c: "var(--amber)", bg: "var(--amber-bg)" },
  cancelled: { label: "Cancelled", c: "var(--ink-3)", bg: "var(--paper)" },
};

/** Field labels — identical strings in both modals. "For job" is never "Job" in one of them. */
export const PO_LABEL = {
  vendor: "Vendor",
  job: "For job",
  num: "PO number",
  orderedAt: "Ordered",
  expectedAt: "Expected",
  // A free-text address, not a 3-option picker — see PurchaseOrder.shipToAddress.
  shipTo: "Ship to",
  orderedBy: "Ordered by",
  freight: "Freight",
  tax: "Tax charged",
} as const;

/**
 * The word for "no job" — a job picker's own empty option and the sentence both summaries and
 * the Orders list fall back to. One constant so a stock order is never "Stock order" in a picker
 * and "stock order" in a sentence by accident.
 */
export const STOCK_ORDER_LABEL = "Stock order";

/** Line columns, in order, shared by the one line table both modals import. */
export const PO_LINE_COLS = [
  { key: "description", label: "Item", num: false },
  { key: "qty", label: "Qty", num: true },
  { key: "uom", label: "Unit", num: false },
  { key: "unitCost", label: "Unit cost", num: true },
  { key: "amount", label: "Amount", num: true },
] as const;

/**
 * Cents, derived fresh from qty × unitCostMillicents — never read off a record's own `amount`.
 * A create-modal draft has no server-computed amount yet, and recomputing here is guaranteed to
 * agree with the server's own formula (modules/purchasing/domain/purchase-order.ts's lineCents).
 */
export const lineCents = (l: PurchaseOrderLine): number =>
  Math.round((l.qty * l.unitCostMillicents) / 1000);

export const subtotalCents = (po: PurchaseOrder): number =>
  po.lines.reduce((s, l) => s + lineCents(l), 0);

export const totalCents = (po: PurchaseOrder): number =>
  subtotalCents(po) + Math.round(po.freight * 100) + Math.round(po.tax * 100);

/**
 * WHAT THE JOB IS CHARGED. The whole order once it is placed, and nothing from a cancelled one.
 * This used to count only the quantities somebody had ticked off as received — dropped with the
 * receiving flow, so the cost lands when the order does, not when the van does.
 */
export function jobCostCents(po: PurchaseOrder): number {
  return po.status === "ordered" ? totalCents(po) : 0;
}

const money = (cents: number): string =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/* The collapsed summaries. Both modals AND the list row call these, so "3 lines · $841.80" reads
   the same in a create modal's staged row, a record chapter head and a table cell. */

export const poOrderSummary = (po: PurchaseOrder): string =>
  [po.vendor, po.jobTitle ?? "stock order", po.expectedAt ? `expected ${po.expectedAt}` : null]
    .filter(Boolean)
    .join(" · ");

export const poLinesSummary = (po: PurchaseOrder): string =>
  po.lines.length === 0
    ? "Add"
    : `${po.lines.length} line${po.lines.length === 1 ? "" : "s"} · ${money(totalCents(po))}`;

export function poNotesSummary(po: PurchaseOrder): string {
  if (po.notes.length === 0) return "Add";
  const files = po.notes.filter((n) => n.attachment).length;
  const latest = po.notes[po.notes.length - 1]?.body.trim();
  const count = `${po.notes.length} note${po.notes.length === 1 ? "" : "s"}`;
  const withFiles = files ? `${count} · ${files} file${files === 1 ? "" : "s"}` : count;
  return latest ? latest : withFiles;
}
