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
import { userMessage } from "@/lib/trpc/error-map";

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
  poNumber?: string | null;
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
  if ("poNumber" in patch) {
    // Trim to null when blank — preserve null for "not set" (mirrors the domain's editMetadata).
    payload.poNumber = (patch.poNumber ?? "").trim() || null;
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

/**
 * Fold a hydrator SNAPSHOT row onto what the store already knows — the invoice mirror of
 * mergeIncomingJob in jobs-slice.
 *
 * A summary row is a HEADER: no lines, no payment history, no terms, no signed amount. Letting
 * it replace a record the modal or a mutation reconcile had already filled in threw all of that
 * away on every refetch — the whole reason the field close-out's done card and payment sheet
 * flapped. The incoming row still wins on everything the list DOES carry (status, total, the
 * balance, the customer, follow-up state); it just stops erasing what it never knew.
 *
 * The merged row stays `partial`, because it still isn't a full server read — a surface that
 * must decide from lines/history keeps fetching the real record.
 */
function mergeIncomingInvoice(prior: Invoice, incoming: Invoice): Invoice {
  if (!incoming.partial) return incoming;
  return {
    ...incoming,
    // The job link — the field surfaces find a job's bill through it, and it is the field the
    // list used to null on every refetch.
    jobId: incoming.jobId ?? prior.jobId,
    lines: incoming.lines?.length ? incoming.lines : prior.lines,
    payments: incoming.payments?.length ? incoming.payments : prior.payments,
    // depPaid is NOT preserved, deliberately. The summary's `paidTotal` is total − due, which
    // ALREADY contains the deposit, and the close-out's DueCard itemises the two separately:
    // carrying a $200 deposit forward beside a $200 paidTotal rendered "− $200 deposit paid /
    // − $200 paid / $800 due" on a $1,000 invoice — credits plus balance adding to $1,200 in
    // front of the customer. The headline was right; the itemisation lied. The summary's own 0
    // is the honest value here: this row does not know what part of the paid figure was a
    // deposit, and the full record (which does) overwrites this wholesale.
    termsDays: incoming.termsDays ?? prior.termsDays,
    poNumber: incoming.poNumber ?? prior.poNumber,
    publicToken: incoming.publicToken ?? prior.publicToken,
    publicUrl: incoming.publicUrl ?? prior.publicUrl,
    tax: incoming.tax ?? prior.tax,
    pricing: incoming.pricing ?? prior.pricing,
    authorization: incoming.authorization ?? prior.authorization,
    cust: incoming.cust || prior.cust,
    phone: incoming.phone || prior.phone,
    email: incoming.email ?? prior.email,
  };
}

/**
 * The summary-row money figures after `amount` more dollars are paid, or `{}` when this record
 * carries none (a fully-loaded invoice, where the payments themselves ARE the balance).
 *
 * A row built from a LIST DTO answers "what is owed" with the server's `due` and "what is paid"
 * with `paidTotal`, NOT by summing `payments` — the list sends no payment history. So an
 * optimistic write that only appends to `payments` is invisible to both derivations. These two
 * move together and stay in the relationship the server guarantees: paidTotal === total − due.
 */
function creditSummaryPayment(inv: Invoice, amount: number): Partial<Invoice> {
  if (inv.due === undefined && inv.paidTotal === undefined) return {};
  const patch: Partial<Invoice> = {};
  if (inv.due !== undefined) patch.due = Math.max(0, inv.due - amount);
  if (inv.paidTotal !== undefined) patch.paidTotal = inv.paidTotal + amount;
  return patch;
}

/**
 * The summary-row money figures after the invoice's TOTAL is re-priced to `total`.
 *
 * The server's `due` was computed against the OLD total, so an on-site bill set through
 * setInvoiceLines left a freshly-priced $450 invoice reading "$0 due" — the close-out foot
 * offered "Log & send to office" instead of "Take payment — $450". What is already paid does
 * not change when the price does; the balance is what moves.
 */
function repriceSummaryTotal(inv: Invoice, total: number): Partial<Invoice> {
  if (inv.due === undefined) return {};
  return { due: Math.max(0, total - (inv.paidTotal ?? 0)) };
}

export interface InvoicesSlice {
  invoices: Invoice[];
  /**
   * Replace the invoices array with a server snapshot — called by the hydrator. Summary rows
   * are merged onto what the store already holds rather than clobbering it (see
   * mergeIncomingInvoice): a list row carries no lines, no payment history and no job link.
   */
  setInvoices: (invoices: Invoice[]) => void;
  /** Put an invoice fetched by id into the store, without a network write. See adoptLead. */
  adoptInvoice: (invoice: Invoice) => void;
  /**
   * Optimistically inserts the invoice and, on the fromJob path, fires v1.invoicing.createFromJob.
   *
   * Returns `{ invoice }` synchronously (the optimistic record with the client-authored id) and
   * `persisted` — a promise that resolves { ok } once the server confirms, or { ok: false, error }
   * after the row was rolled back. It NEVER rejects, so fire-and-forget callers stay safe while
   * an interactive caller (the close-out sheet, which cannot render at all until this invoice
   * exists) can await it and show the real reason instead of an empty sheet. Mirrors addJob's
   * { job, persisted }. On the blank/manual path `persisted` resolves { ok: true } immediately —
   * nothing was promised to the server yet; sendInvoice does that.
   */
  addInvoice: (draft: Omit<Invoice, "id" | "num">) => {
    invoice: Invoice;
    persisted: Promise<{ ok: boolean; error?: string }>;
  };
  updateInvoice: (id: string, patch: Partial<Invoice>) => void;
  setInvoiceLines: (id: string, lines: InvoiceLine[]) => void;
  recordPayment: (id: string, payment: Payment) => void;
  /**
   * Resolves { ok, error } once the send genuinely completes (never rejects) so a caller that
   * must not proceed until the invoice is actually sent (e.g. opening a payment sheet on it)
   * can await it. Existing fire-and-forget callers are unaffected — the resolved value is
   * optional to consume. Mirrors setJobLines/setVisitNotes's Promise<{ok, error?}> convention.
   */
  sendInvoice: (id: string) => Promise<{ ok: boolean; error?: string }>;
  archiveInvoice: (id: string) => void;
  /**
   * Remove a store-local invoice that never reached the server (or whose sendInvoice failed
   * and was rolled back to its pre-send "manual" snapshot — see sendInvoice's catch). Refuses
   * to touch a "db"-origin invoice — that one has a real row, and the correct way to remove it
   * is archiveInvoice/void, never a local delete. No-op if origin is already "db" or the id
   * isn't found.
   */
  removeLocalInvoice: (id: string) => void;
}

export const createInvoicesSlice: StateCreator<InvoicesSlice, [], [], InvoicesSlice> = (set, get) => ({
  invoices: [],

  // Hydrator path: the snapshot is authoritative for which invoices exist and for every field
  // it carries, but a summary row must not erase the fields it cannot carry (mergeIncomingInvoice).
  setInvoices: (invoices) =>
    set((s) => ({
      invoices: invoices.map((incoming) => {
        const prior = s.invoices.find((i) => i.id === incoming.id);
        return prior ? mergeIncomingInvoice(prior, incoming) : incoming;
      }),
    })),

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
    set((s) => ({ invoices: [inv, ...s.invoices] }));

    // 2. fromJob path: fire createFromJob when jobId is provided. The client id rides the
    //    input (the use case preserves it for the NEW row), so a fresh create echoes it back
    //    and the ids never split.
    if (!draft.jobId || !draft.leadId) {
      // Blank path: DB row deferred to sendInvoice. Nothing is in flight, so nothing can fail.
      return { invoice: inv, persisted: Promise.resolve({ ok: true }) };
    }

    const persisted = trpcVanilla.v1.invoicing.createFromJob
      .mutate({ jobId: draft.jobId, id })
      .then(
        (dto) => {
          invalidateLists("invoices", "jobs");
          // Reconcile — ADOPT the server id (dto.id). On a fresh create it IS the client id
          // (passed through above). On the idempotent path — the job already had an invoice —
          // the ids differ and the server id must win: every later mutation (send,
          // recordPayment, createPayment, get) sends the store id to the server, and the old
          // `{...reconciled, id}` clobber made all of them NOT_FOUND (rollback + dev-only log)
          // while the UI showed success.
          const reconciled = dtoInvoiceToStore(dto, inv);
          set((s) => ({
            invoices: s.invoices
              // Drop any OTHER row already carrying the server id (keep the one being replaced)
              // so adoption never leaves two rows with the same id.
              .filter((i) => i.id !== reconciled.id || i.id === id)
              .map((i) => (i.id === id ? reconciled : i)),
          }));
          return { ok: true };
        },
        (err: unknown) => {
          // Row-level rollback: drop the one row this call added. Restoring a whole-array
          // snapshot taken before the optimistic write ALSO discarded every invoice the
          // hydrator landed while this create was in flight — a failed create emptied the
          // ledger. restoreInv/reconcileInv are per-row for the same reason.
          set((s) => ({ invoices: s.invoices.filter((i) => i.id !== id) }));
          reportWriteError("addInvoice", err);
          return {
            ok: false,
            error: userMessage(err, "Couldn't raise the invoice — check your connection and try again."),
          };
        },
      );

    return { invoice: inv, persisted };
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

    // 1. Optimistic update — recompute the total from lines, and re-derive a summary row's
    //    balance against the new total (the server's `due` was computed against the old one).
    set((s) => ({
      invoices: s.invoices.map((i) =>
        i.id === id
          ? { ...i, lines, total: linesTotal(lines), ...repriceSummaryTotal(i, linesTotal(lines)) }
          : i,
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
              // …and move the SUMMARY figures by the same amount. On a row built from a list
              // DTO, invDue reads the server's `due` and invPaid reads `paidTotal`; appending
              // to `payments` alone moved neither, so recording a payment in full still read
              // "Approved · $1,000 · $1,000 still due" until the server round trip landed —
              // with the customer standing there. Both stay mutually consistent
              // (paidTotal === total − due) so the itemisation never contradicts the headline.
              ...creditSummaryPayment(i, payment.amt),
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

    if (!inv) return Promise.resolve({ ok: false, error: "invoice not found" });

    if (inv.origin !== "db") {
      // "manual" path: must draft first, then send.
      // v1.invoicing.draft requires lines >= 1.
      if (!inv.lines.length || !inv.leadId) {
        // Can't draft without lines or leadId — stay store-local.
        return Promise.resolve({ ok: false, error: "an invoice needs at least one line" });
      }

      // The two legs (draft, then send) get DIFFERENT rollback behavior on failure — the
      // two-argument .then(onFulfilled, onRejected) form scopes each rejection handler to
      // exactly the mutate call it's attached to (unlike a single trailing .catch(), which
      // can't tell which leg failed):
      //   - draft-leg failure: no server row was ever created — full restore to `prior` is
      //     correct (origin reverts to "manual", matching reality).
      //   - send-leg failure AFTER a successful draft: a REAL server row now exists (origin
      //     was just reconciled to "db"). A full restore to `prior` would silently clobber
      //     origin back to "manual", orphaning that real row — the caller can no longer tell
      //     this apart from a true local-only failure, and a naive retry mints a SECOND server
      //     draft (draft-invoice.ts has no lead/title idempotency). Restore ONLY the status
      //     flip (back to "draft"); origin stays "db" so a retry resumes the SAME row via this
      //     function's "db" path below instead of minting a duplicate.
      return trpcVanilla.v1.invoicing.draft
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
        .then(
          (draftDto) => {
            invalidateLists("invoices", "jobs");
            // Step 1 reconcile: stamps origin: "db" on the newly created row.
            const reconciled = dtoInvoiceToStore(draftDto, inv);
            set((s) => ({ invoices: reconcileInv(s.invoices, { ...reconciled, id }) }));
            // Step 2: send using the server's canonical invoice id.
            return trpcVanilla.v1.invoicing.send.mutate({ invoiceId: draftDto.id }).then(
              (sendDto) => {
                invalidateLists("invoices", "jobs");
                const currentInv = get().invoices.find((i) => i.id === id) ?? inv;
                const reconciledSend = dtoInvoiceToStore(sendDto, currentInv);
                set((s) => ({ invoices: reconcileInv(s.invoices, { ...reconciledSend, id }) }));
                return { ok: true };
              },
              (err: unknown) => {
                set((s) => ({
                  invoices: s.invoices.map((i) => (i.id === id ? { ...i, status: "draft" } : i)),
                }));
                reportWriteError("sendInvoice", err);
                return {
                  ok: false,
                  error: err instanceof Error ? err.message : "Couldn't send the invoice.",
                };
              },
            );
          },
          (err: unknown) => {
            if (prior) set((s) => ({ invoices: restoreInv(s.invoices, prior) }));
            reportWriteError("sendInvoice", err);
            return { ok: false, error: err instanceof Error ? err.message : "Couldn't send the invoice." };
          },
        )
        .catch((err: unknown) => {
          // Defensive fallback for a genuinely unexpected failure outside either mutate call
          // (e.g. a thrown error inside the reconcile logic itself) — full restore is the
          // safest default when it's unclear which leg's own rollback (above) already ran.
          if (prior) set((s) => ({ invoices: restoreInv(s.invoices, prior) }));
          reportWriteError("sendInvoice", err);
          return { ok: false, error: err instanceof Error ? err.message : "Couldn't send the invoice." };
        });
    }

    // "db" path: send directly.
    return trpcVanilla.v1.invoicing.send
      .mutate({ invoiceId: id })
      .then((dto) => {
        invalidateLists("invoices", "jobs");
        const currentInv = get().invoices.find((i) => i.id === id) ?? inv;
        const reconciled = dtoInvoiceToStore(dto, currentInv);
        set((s) => ({ invoices: reconcileInv(s.invoices, { ...reconciled, id }) }));
        return { ok: true };
      })
      .catch((err: unknown) => {
        if (prior) set((s) => ({ invoices: restoreInv(s.invoices, prior) }));
        reportWriteError("sendInvoice", err);
        return { ok: false, error: err instanceof Error ? err.message : "Couldn't send the invoice." };
      });
  },

  // ---------------------------------------------------------------------------
  // removeLocalInvoice — deletes a store-local-only invoice (an optimistic addInvoice whose
  // sendInvoice never reached the server, or was rolled back to its pre-send snapshot). Guards
  // on origin !== "db" so a caller can never accidentally delete a real, persisted invoice —
  // that path is archiveInvoice/void.
  //
  // Callers: tech-job-modal.tsx's collectVisitFee, on a failed fee-invoice send — the failed
  // optimistic draft must not linger (it would otherwise satisfy the "already collected" guard
  // and permanently hide the retry button, and leak into any other surface reading s.invoices
  // by lead/title, e.g. the Money ledger or the office job-modal's un-reconciled jobId match).
  // ---------------------------------------------------------------------------
  removeLocalInvoice: (id) => {
    set((s) => ({
      invoices: s.invoices.filter((i) => !(i.id === id && i.origin !== "db")),
    }));
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
