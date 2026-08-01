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
 *   archiveInvoice             → v1.invoicing.void  (any db invoice, incl. drafts)
 *   updateInvoice   → v1.invoicing.updateMetadata (db invoices; DB-backed fields only)
 *   setInvoiceLines → v1.invoicing.patchLines     (db invoices; recomputes total)
 *
 * DEFERRED (no backend endpoint yet — store-local only):
 *   addInvoice (blank path)    — skips network; DB row created at sendInvoice time
 *   archiveInvoice on manual   — no DB row yet; optimistic hide is store-local
 */

import type { StateCreator } from "zustand";
import type { Invoice, InvoiceLine, Payment } from "../types";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { invalidateLists } from "@/lib/trpc/list-cache";
import { dtoInvoiceToStore } from "@/lib/store/dto-mapper";
import { reportWriteError } from "../write-error";

// Continue the sample's INV numbers.
// After reconcile, the server-canonical `num` overwrites this optimistic value.
let _nextInvNum = 810;

function linesTotal(lines: InvoiceLine[]): number {
  return lines.reduce((s, l) => s + (l.q ?? 1) * (l.r ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Metadata payload helper
// ---------------------------------------------------------------------------

// Only these Invoice fields have DB columns on the invoices header. Everything else
// (cust/phone/email/fu/archived/pricing/age/payments/status) is client-local — a patch
// touching only those must NOT hit the network (mirrors buildLeadUpdatePayload).
export interface InvoiceMetadataPayload {
  invoiceId: string;
  leadId?: string;
  title?: string | null;
  termsDays?: number;
  depositPaidCents?: number;
}

export function buildInvoiceMetadataPayload(
  id: string,
  patch: Partial<Invoice>,
): InvoiceMetadataPayload | null {
  const payload: InvoiceMetadataPayload = { invoiceId: id };
  let persistable = false;
  if ("leadId" in patch && patch.leadId != null && patch.leadId !== "") {
    payload.leadId = patch.leadId;
    persistable = true;
  }
  if ("title" in patch) {
    payload.title = patch.title ?? null;
    persistable = true;
  }
  if ("termsDays" in patch && patch.termsDays != null) {
    payload.termsDays = patch.termsDays;
    persistable = true;
  }
  if ("depPaid" in patch && patch.depPaid != null) {
    payload.depositPaidCents = Math.round(patch.depPaid * 100); // dollars → cents
    persistable = true;
  }
  return persistable ? payload : null;
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
  /** Put an invoice fetched by id into the store, without a network write. See adoptLead. */
  adoptInvoice: (invoice: Invoice) => void;
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
  // adoptInvoice — an invoice the store never hydrated, fetched by id.
  //
  // The Money ledger pages through the database (847 invoices on the seeded org),
  // so opening a row past the hydrator's page found nothing and rendered an EMPTY
  // sheet under an open modal shell. Mirrors adoptLead.
  // ---------------------------------------------------------------------------
  adoptInvoice: (invoice) =>
    set((s) => ({
      invoices: s.invoices.some((i) => i.id === invoice.id)
        ? reconcileInv(s.invoices, invoice)
        : [invoice, ...s.invoices],
    })),

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
          invalidateLists("invoices", "jobs");
          // Reconcile — keep local id stable; server row now has the canonical num.
          const reconciled = dtoInvoiceToStore(dto, inv);
          const merged: Invoice = { ...reconciled, id };
          set((s) => ({ invoices: reconcileInv(s.invoices, merged) }));
        })
        .catch((err: unknown) => {
          set({ invoices: prior });
          reportWriteError("addInvoice", err);
        });
    }
    // Blank path: DB row deferred to sendInvoice.

    return inv;
  },

  // ---------------------------------------------------------------------------
  // updateInvoice — optimistic + persist via v1.invoicing.updateMetadata + reconcile.
  //
  // All fields (including client-local ones like cust/phone/email) are applied
  // optimistically. Only DB-backed fields (title, termsDays, depPaid, leadId)
  // trigger a network call — client-local-only patches skip the network entirely.
  // Only "db"-origin invoices persist; "manual" invoices stay store-local.
  // ---------------------------------------------------------------------------
  updateInvoice: (id, patch) => {
    const prior = snapshotInv(get().invoices, id);

    // 1. Optimistic local update (all fields — client-local included).
    set((s) => ({ invoices: s.invoices.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));

    const inv = get().invoices.find((i) => i.id === id);
    // 2. Persist only DB-origin invoices with a DB-backed field in the patch.
    if (!inv || inv.origin !== "db") return;

    // Follow-up rides its own endpoint: updateMetadata refuses a paid or void invoice, and the
    // moment an invoice is paid is exactly when the shop stops chasing it.
    if (patch.fu) {
      const { on, stage } = patch.fu;
      void trpcVanilla.v1.invoicing.setFollowUp
        .mutate({ invoiceId: id, on, stage })
        .catch((err: unknown) => {
          if (prior) set((s) => ({ invoices: restoreInv(s.invoices, prior) }));
          reportWriteError("updateInvoice.followUp", err);
        });
    }

    const payload = buildInvoiceMetadataPayload(id, patch);
    if (!payload) return; // client-local-only patch — no network call

    trpcVanilla.v1.invoicing.updateMetadata
      .mutate(payload)
      .then((dto) => {
        invalidateLists("invoices", "jobs");
        const reconciled = dtoInvoiceToStore(dto, inv);
        set((s) => ({ invoices: reconcileInv(s.invoices, { ...reconciled, id }) }));
      })
      .catch((err: unknown) => {
        if (prior) set((s) => ({ invoices: restoreInv(s.invoices, prior) }));
        reportWriteError("updateInvoice", err);
      });
  },

  // ---------------------------------------------------------------------------
  // setInvoiceLines — optimistic + persist via v1.invoicing.patchLines + reconcile.
  //
  // Lines are applied optimistically and the total is recomputed immediately
  // (prototype invSetLine behaviour). Only "db"-origin invoices fire the
  // network call; "manual" invoices stay store-local until sendInvoice.
  // ---------------------------------------------------------------------------
  setInvoiceLines: (id, lines) => {
    const prior = snapshotInv(get().invoices, id);

    // 1. Optimistic update — recompute the total from lines.
    set((s) => ({
      invoices: s.invoices.map((i) =>
        i.id === id ? { ...i, lines, total: linesTotal(lines) } : i,
      ),
    }));

    const inv = get().invoices.find((i) => i.id === id);
    // 2. Persist only DB-origin invoices; manual drafts snapshot at sendInvoice.
    if (!inv || inv.origin !== "db") return;

    trpcVanilla.v1.invoicing.patchLines
      .mutate({
        invoiceId: id,
        lines: lines.map((l) => ({
          description: l.d,
          quantity: l.q ?? 1,
          rateCents: Math.round((l.r ?? 0) * 100), // dollars → cents
          costCents: Math.round((l.c ?? 0) * 100), // dollars → cents; 0 when absent
        })),
      })
      .then((dto) => {
        invalidateLists("invoices", "jobs");
        const reconciled = dtoInvoiceToStore(dto, inv);
        set((s) => ({ invoices: reconcileInv(s.invoices, { ...reconciled, id }) }));
      })
      .catch((err: unknown) => {
        if (prior) set((s) => ({ invoices: restoreInv(s.invoices, prior) }));
        reportWriteError("setInvoiceLines", err);
      });
  },

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
        invalidateLists("invoices", "jobs");
        const reconciled = dtoInvoiceToStore(dto, inv);
        set((s) => ({ invoices: reconcileInv(s.invoices, { ...reconciled, id }) }));
      })
      .catch((err: unknown) => {
        if (prior) set((s) => ({ invoices: restoreInv(s.invoices, prior) }));
        reportWriteError("recordPayment", err);
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
          id: inv.id,
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
          invalidateLists("invoices", "jobs");
          // Step 1 reconcile: stamps origin: "db" on the newly created row.
          const reconciled = dtoInvoiceToStore(draftDto, inv);
          set((s) => ({ invoices: reconcileInv(s.invoices, { ...reconciled, id }) }));
          // Step 2: send using the server's canonical invoice id.
          return trpcVanilla.v1.invoicing.send.mutate({ invoiceId: draftDto.id });
        })
        .then((sendDto) => {
          invalidateLists("invoices", "jobs");
          // Step 2 reconcile: sendDto is always defined here — if draft threw, .catch ran instead.
          const currentInv = get().invoices.find((i) => i.id === id) ?? inv;
          const reconciled = dtoInvoiceToStore(sendDto, currentInv);
          set((s) => ({ invoices: reconcileInv(s.invoices, { ...reconciled, id }) }));
        })
        .catch((err: unknown) => {
          if (prior) set((s) => ({ invoices: restoreInv(s.invoices, prior) }));
          reportWriteError("sendInvoice", err);
        });
      return;
    }

    // "db" path: send directly.
    trpcVanilla.v1.invoicing.send
      .mutate({ invoiceId: id })
      .then((dto) => {
        invalidateLists("invoices", "jobs");
        const currentInv = get().invoices.find((i) => i.id === id) ?? inv;
        const reconciled = dtoInvoiceToStore(dto, currentInv);
        set((s) => ({ invoices: reconcileInv(s.invoices, { ...reconciled, id }) }));
      })
      .catch((err: unknown) => {
        if (prior) set((s) => ({ invoices: restoreInv(s.invoices, prior) }));
        reportWriteError("sendInvoice", err);
      });
  },

  // ---------------------------------------------------------------------------
  // archiveInvoice — maps to v1.invoicing.void, which moves the invoice to the
  // Archived tab (status "void" → archived, per dtoInvoiceToStore / the hydrator).
  //
  // Drafts archive the SAME way (Owen's call Jul 19 2026 — a removed draft lives
  // in Archived, not deleted): the domain void() accepts a draft, so we persist it
  // rather than leaving the archive store-local (which reappeared on the next
  // reload as the hydrator re-derived archived=false from status "draft").
  //
  // Guard: only a "db"-origin invoice has a row to void. A "manual" invoice that
  // was never persisted has no DB row, so skip the network call and keep the
  // optimistic hide store-local (it never existed server-side to come back).
  // ---------------------------------------------------------------------------
  archiveInvoice: (id) => {
    const prior = snapshotInv(get().invoices, id);
    const inv = get().invoices.find((i) => i.id === id);

    // 1. Optimistic update.
    set((s) => ({ invoices: s.invoices.map((i) => (i.id === id ? { ...i, archived: true } : i)) }));

    // 2. Guard: only DB-origin invoices have a row to void.
    if (!inv || inv.origin !== "db") {
      return;
    }

    trpcVanilla.v1.invoicing.void
      .mutate({ invoiceId: id })
      .then((dto) => {
        invalidateLists("invoices", "jobs");
        const currentInv = get().invoices.find((i) => i.id === id) ?? inv;
        const reconciled = dtoInvoiceToStore(dto, currentInv);
        set((s) => ({ invoices: reconcileInv(s.invoices, { ...reconciled, id }) }));
      })
      .catch((err: unknown) => {
        if (prior) set((s) => ({ invoices: restoreInv(s.invoices, prior) }));
        reportWriteError("archiveInvoice", err);
      });
  },
});
