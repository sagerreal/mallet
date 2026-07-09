/**
 * lib/store/slices/invoices-slice.ts
 * Invoice data + mutations. Immutable updates only.
 * Total is recomputed from lines on every line edit (mirrors the prototype).
 *
 * PERSISTENCE PATTERN — identical to jobs-slice (visit actions):
 *   1. Optimistic local update (synchronous, instant UI).
 *   2. Fire v1.invoicing.* via trpcVanilla — fire-and-forget (.then/.catch).
 *   3. On success, reconcile the returned invoiceDTO via dtoInvoiceToStore
 *      and REPLACE the record in the store (stamps origin: "db").
 *   4. On error, restore the pre-mutation snapshot; log in dev only.
 *
 * origin flag (mirrors jobs "db" | "manual"):
 *   "manual" — created locally; has no DB row yet. Network mutations are
 *              deferred until sendInvoice fires (which drafts + sends in sequence).
 *   "db"     — reconciled from a backend DTO; subsequent mutations go to the DB.
 *
 * WIRED mutations (backend endpoint exists):
 *   addInvoice (fromJob path)  → v1.invoicing.createFromJob  (when jobId is set + job is "db")
 *   sendInvoice                → v1.invoicing.draft + v1.invoicing.send sequence
 *   recordPayment              → v1.invoicing.recordPayment
 *   archiveInvoice             → v1.invoicing.void  (only for non-draft invoices)
 *
 * DEFERRED (no backend endpoint yet — store-local only):
 *   addInvoice (blank path)    — skips network; DB row created at sendInvoice time
 *   updateInvoice              — TODO(persist): no generic update-metadata endpoint
 *   setInvoiceLines            — TODO(persist): no patch-lines endpoint; snapshot at send
 *   archiveInvoice on draft    — guarded: only void non-draft invoices
 */

import type { StateCreator } from "zustand";
import type { Invoice, InvoiceLine, Payment } from "../types";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { dtoInvoiceToStore } from "@/lib/store/dto-mapper";

// Continue the sample's INV numbers.
// After reconcile, the server-canonical `num` overwrites this optimistic value.
let _nextInvNum = 810;

function linesTotal(lines: InvoiceLine[]): number {
  return lines.reduce((s, l) => s + (l.q ?? 1) * (l.r ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function snapshotInv(invoices: Invoice[], id: string): Invoice | undefined {
  return invoices.find((i) => i.id === id);
}

function reconcileInv(invoices: Invoice[], reconciled: Invoice): Invoice[] {
  return invoices.map((i) => (i.id === reconciled.id ? reconciled : i));
}

function restoreInv(invoices: Invoice[], prior: Invoice): Invoice[] {
  return invoices.map((i) => (i.id === prior.id ? prior : i));
}

export interface InvoicesSlice {
  invoices: Invoice[];
  /** Replace the entire invoices array — called by the server hydrator. */
  setInvoices: (invoices: Invoice[]) => void;
  addInvoice: (draft: Omit<Invoice, "id" | "num">) => Invoice;
  updateInvoice: (id: string, patch: Partial<Invoice>) => void;
  setInvoiceLines: (id: string, lines: InvoiceLine[]) => void;
  recordPayment: (id: string, payment: Payment) => void;
  sendInvoice: (id: string) => void;
  archiveInvoice: (id: string) => void;
}

export const createInvoicesSlice: StateCreator<InvoicesSlice, [], [], InvoicesSlice> = (set, get) => ({
  invoices: [],

  setInvoices: (invoices) => set({ invoices }),

  // ---------------------------------------------------------------------------
  // addInvoice — two semantic paths:
  //
  // Path A — fromJob (jobId is set and the job exists in the DB):
  //   Fire v1.invoicing.createFromJob immediately; reconcile returned DTO.
  //   The job must be a "db"-origin job — callers are responsible for checking
  //   job.origin === "db" before passing a non-null jobId here.
  //
  // Path B — blank / manual (jobId === null or empty leadId):
  //   Defer network call to sendInvoice. The draft lives store-local with
  //   origin: "manual" until send time. v1.invoicing.draft requires lines >= 1,
  //   so we can't fire it here on an empty draft.
  // ---------------------------------------------------------------------------
  addInvoice: (draft) => {
    const id = crypto.randomUUID();
    const inv: Invoice = {
      ...draft,
      id,
      num: `INV-${_nextInvNum++}`,
      origin: "manual",
    };

    // 1. Optimistic update.
    const prior = get().invoices.slice();
    set((s) => ({ invoices: [inv, ...s.invoices] }));

    // 2. fromJob path: fire createFromJob when jobId is provided.
    if (draft.jobId && draft.leadId) {
      trpcVanilla.v1.invoicing.createFromJob
        .mutate({ jobId: draft.jobId })
        .then((dto) => {
          // Reconcile — keep local id stable; server row now has the canonical num.
          const reconciled = dtoInvoiceToStore(dto, inv);
          const merged: Invoice = { ...reconciled, id };
          set((s) => ({ invoices: reconcileInv(s.invoices, merged) }));
        })
        .catch((err: unknown) => {
          set({ invoices: prior });
          if (process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.error("[invoices-slice] addInvoice(fromJob) failed — rolled back", { id, jobId: draft.jobId, err });
          }
        });
    }
    // Blank path: DB row deferred to sendInvoice.

    return inv;
  },

  // ---------------------------------------------------------------------------
  // updateInvoice — store-local for pilot.
  // The backend has no generic update-metadata endpoint.
  // Fields like cust, phone, email, termsDays, pricing, depPaid, fu are
  // captured at the store level and sent as part of the draft/send payload
  // when sendInvoice fires.
  // TODO(persist): no backend update-metadata endpoint — all patches are store-local
  // ---------------------------------------------------------------------------
  updateInvoice: (id, patch) =>
    // TODO(persist): no backend update-metadata endpoint — store-local only
    set((s) => ({ invoices: s.invoices.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),

  // ---------------------------------------------------------------------------
  // setInvoiceLines — store-local until sendInvoice fires.
  // Editing lines re-derives the invoice total (prototype invSetLine behaviour).
  // TODO(persist): no patch-lines endpoint; snapshot at sendInvoice time
  // ---------------------------------------------------------------------------
  setInvoiceLines: (id, lines) =>
    // TODO(persist): no patch-lines endpoint — store-local; lines snapshotted at send
    set((s) => ({
      invoices: s.invoices.map((i) =>
        i.id === id ? { ...i, lines, total: linesTotal(lines) } : i
      ),
    })),

  // ---------------------------------------------------------------------------
  // recordPayment — optimistic + persist via v1.invoicing.recordPayment + reconcile.
  //
  // A fresh idempotencyKey is minted here (not in the caller) to prevent double-
  // charges across retries. Only "db"-origin invoices fire the network call.
  //
  // Callers: invoice-modal.tsx record(), cust-invoice-modal.tsx pay(),
  //          close-out-modal.tsx approvePayment(), money-ledger.tsx onCharge().
  // ---------------------------------------------------------------------------
  recordPayment: (id, payment) => {
    const prior = snapshotInv(get().invoices, id);

    // 1. Optimistic update.
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
    }));

    const inv = get().invoices.find((i) => i.id === id);

    // 2. Only persist DB-origin invoices.
    if (!inv || inv.origin !== "db") return;

    const idempotencyKey = crypto.randomUUID();

    trpcVanilla.v1.invoicing.recordPayment
      .mutate({
        invoiceId: id,
        amountCents: Math.round(payment.amt * 100),  // dollars → cents
        method: payment.method as "card" | "ach" | "cash" | "check" | "card_terminal",
        idempotencyKey,
      })
      .then((dto) => {
        const reconciled = dtoInvoiceToStore(dto, inv);
        set((s) => ({ invoices: reconcileInv(s.invoices, { ...reconciled, id }) }));
      })
      .catch((err: unknown) => {
        if (prior) set((s) => ({ invoices: restoreInv(s.invoices, prior) }));
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.error("[invoices-slice] recordPayment failed — rolled back", { id, err });
        }
      });
  },

  // ---------------------------------------------------------------------------
  // sendInvoice — handles both origin paths:
  //
  // "manual" (no DB row): call v1.invoicing.draft first (snapshot current lines),
  //   then v1.invoicing.send on the returned DTO id. The local id stays stable.
  //
  // "db" (row already exists via createFromJob or a prior draft call): call
  //   v1.invoicing.send directly.
  //
  // Callers: invoice-modal.tsx send(), close-out-modal.tsx approvePayment().
  // ---------------------------------------------------------------------------
  sendInvoice: (id) => {
    const inv = get().invoices.find((i) => i.id === id);
    const prior = snapshotInv(get().invoices, id);

    // 1. Optimistic update.
    set((s) => ({
      invoices: s.invoices.map((i) =>
        i.id === id ? { ...i, status: "sent", age: 0, fu: { on: true, stage: 0 } } : i
      ),
    }));

    if (!inv) return;

    if (inv.origin !== "db") {
      // "manual" path: must draft first, then send.
      // v1.invoicing.draft requires lines >= 1.
      if (!inv.lines.length || !inv.leadId) {
        // Can't draft without lines or leadId — stay store-local.
        return;
      }

      trpcVanilla.v1.invoicing.draft
        .mutate({
          leadId: inv.leadId,
          title: inv.title ?? undefined,
          termsDays: inv.termsDays ?? 7,
          lines: inv.lines.map((l) => ({
            description: l.d,
            quantity:    l.q ?? 1,
            rateCents:   Math.round((l.r ?? 0) * 100),   // dollars → cents
            costCents:   Math.round((l.c ?? 0) * 100),   // dollars → cents; 0 when absent
          })),
        })
        .then((draftDto) => {
          // Step 1 reconcile: stamps origin: "db" on the newly created row.
          const reconciled = dtoInvoiceToStore(draftDto, inv);
          set((s) => ({ invoices: reconcileInv(s.invoices, { ...reconciled, id }) }));
          // Step 2: send using the server's canonical invoice id.
          return trpcVanilla.v1.invoicing.send.mutate({ invoiceId: draftDto.id });
        })
        .then((sendDto) => {
          // Step 2 reconcile: sendDto is always defined here — if draft threw, .catch ran instead.
          const currentInv = get().invoices.find((i) => i.id === id) ?? inv;
          const reconciled = dtoInvoiceToStore(sendDto, currentInv);
          set((s) => ({ invoices: reconcileInv(s.invoices, { ...reconciled, id }) }));
        })
        .catch((err: unknown) => {
          if (prior) set((s) => ({ invoices: restoreInv(s.invoices, prior) }));
          if (process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.error("[invoices-slice] sendInvoice(manual→draft→send) failed — rolled back", { id, err });
          }
        });
      return;
    }

    // "db" path: send directly.
    trpcVanilla.v1.invoicing.send
      .mutate({ invoiceId: id })
      .then((dto) => {
        const currentInv = get().invoices.find((i) => i.id === id) ?? inv;
        const reconciled = dtoInvoiceToStore(dto, currentInv);
        set((s) => ({ invoices: reconcileInv(s.invoices, { ...reconciled, id }) }));
      })
      .catch((err: unknown) => {
        if (prior) set((s) => ({ invoices: restoreInv(s.invoices, prior) }));
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.error("[invoices-slice] sendInvoice(db) failed — rolled back", { id, err });
        }
      });
  },

  // ---------------------------------------------------------------------------
  // archiveInvoice — maps to v1.invoicing.void (irreversible in the backend).
  //
  // Guard: only void non-draft "db" invoices. Voiding a draft is semantically
  // wrong (use deleteInvoice once that endpoint exists). Voiding a "manual"
  // invoice that has no DB row would fail, so skip the network call there too.
  // ---------------------------------------------------------------------------
  archiveInvoice: (id) => {
    const prior = snapshotInv(get().invoices, id);
    const inv = get().invoices.find((i) => i.id === id);

    // 1. Optimistic update.
    set((s) => ({ invoices: s.invoices.map((i) => (i.id === id ? { ...i, archived: true } : i)) }));

    // 2. Guard: only void DB-origin, non-draft invoices.
    if (!inv || inv.origin !== "db" || inv.status === "draft") {
      // TODO(persist): void endpoint only valid for non-draft; draft archive is store-local
      return;
    }

    trpcVanilla.v1.invoicing.void
      .mutate({ invoiceId: id })
      .then((dto) => {
        const currentInv = get().invoices.find((i) => i.id === id) ?? inv;
        const reconciled = dtoInvoiceToStore(dto, currentInv);
        set((s) => ({ invoices: reconcileInv(s.invoices, { ...reconciled, id }) }));
      })
      .catch((err: unknown) => {
        if (prior) set((s) => ({ invoices: restoreInv(s.invoices, prior) }));
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.error("[invoices-slice] archiveInvoice(void) failed — rolled back", { id, err });
        }
      });
  },
});
