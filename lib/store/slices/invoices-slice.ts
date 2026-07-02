/**
 * lib/store/slices/invoices-slice.ts
 * Invoice data + mutations (seeded from sample). Immutable updates only.
 * Total is recomputed from lines on every line edit (mirrors the prototype).
 */

import type { StateCreator } from "zustand";
import type { Invoice, InvoiceLine, Payment } from "../types";
import { SAMPLE_INVOICES } from "@/lib/prototype-sample";

const SEED_INVOICES: Invoice[] = SAMPLE_INVOICES.map((i) => ({
  ...i,
  lines: i.lines.map((l) => ({ ...l })),
  payments: (i.payments ?? []).map((p) => ({ ...p })),
})) as unknown as Invoice[];

// Continue the sample's INV numbers.
let _nextInvId = 800;
let _nextInvNum = 810;

function linesTotal(lines: InvoiceLine[]): number {
  return lines.reduce((s, l) => s + (l.q ?? 1) * (l.r ?? 0), 0);
}

export interface InvoicesSlice {
  invoices: Invoice[];
  addInvoice: (draft: Omit<Invoice, "id" | "num">) => Invoice;
  updateInvoice: (id: number, patch: Partial<Invoice>) => void;
  setInvoiceLines: (id: number, lines: InvoiceLine[]) => void;
  recordPayment: (id: number, payment: Payment) => void;
  sendInvoice: (id: number) => void;
  archiveInvoice: (id: number) => void;
}

export const createInvoicesSlice: StateCreator<InvoicesSlice, [], [], InvoicesSlice> = (set) => ({
  invoices: SEED_INVOICES,

  addInvoice: (draft) => {
    const inv: Invoice = { ...draft, id: ++_nextInvId, num: `INV-${_nextInvNum++}` };
    set((s) => ({ invoices: [inv, ...s.invoices] }));
    return inv;
  },

  updateInvoice: (id, patch) =>
    set((s) => ({ invoices: s.invoices.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),

  // Editing lines re-derives the invoice total (prototype invSetLine behavior).
  setInvoiceLines: (id, lines) =>
    set((s) => ({
      invoices: s.invoices.map((i) =>
        i.id === id ? { ...i, lines, total: linesTotal(lines) } : i
      ),
    })),

  recordPayment: (id, payment) =>
    set((s) => ({
      invoices: s.invoices.map((i) =>
        i.id === id
          ? {
              ...i,
              payments: [...(i.payments ?? []), payment],
              status: i.status === "draft" ? "sent" : i.status,
            }
          : i
      ),
    })),

  sendInvoice: (id) =>
    set((s) => ({
      invoices: s.invoices.map((i) =>
        i.id === id ? { ...i, status: "sent", age: 0, fu: { on: true, stage: 0 } } : i
      ),
    })),

  archiveInvoice: (id) =>
    set((s) => ({ invoices: s.invoices.map((i) => (i.id === id ? { ...i, archived: true } : i)) })),
});
