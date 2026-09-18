/**
 * lib/store/slices/purchase-orders-slice.ts
 * Purchase order data + mutations. Immutable updates only.
 *
 * PERSISTENCE PATTERN — same house rule as invoices-slice/jobs-slice:
 *   1. Optimistic local update (synchronous, instant UI).
 *   2. Fire v1.purchasing.* via trpcVanilla — fire-and-forget (.then/.catch).
 *   3. On success, reconcile the returned DTO via dtoPurchaseOrderToStore and
 *      REPLACE the record in the store.
 *   4. On error, restore the pre-mutation snapshot AND call reportWriteError —
 *      the dev-log AND the visible write-error announcement. A rollback that
 *      only reverts the UI and says nothing is the bug this whole convention
 *      exists to prevent (see write-error.ts).
 *
 * NO "manual" origin. Unlike Invoice/Estimate, this slice has no store-local
 * draft-before-persist create path — see the note on the store PurchaseOrder
 * type. Every record here already has a real DB row, so updatePurchaseOrder
 * always fires the network call; there is no origin gate to check first.
 *
 * NO invalidateLists call. lib/trpc/list-cache.ts's ListDomain union does not
 * yet include a purchasing entry (out of scope for this task — see the task
 * brief's file list) — add one there before wiring a cross-surface refetch
 * (e.g. invalidating "jobs" when a PO's jobCostCents changes what a job page
 * shows) rather than passing an untyped domain string here.
 */

import type { StateCreator } from "zustand";
import type { PurchaseOrder, PurchaseOrderNote } from "../types";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { dtoPurchaseOrderToStore, dtoPurchaseOrderNoteToStore } from "@/lib/store/dto-mapper";
import { reportWriteError } from "../write-error";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function snapshotPO(orders: PurchaseOrder[], id: string): PurchaseOrder | undefined {
  return orders.find((po) => po.id === id);
}

function restorePOs(orders: PurchaseOrder[], prior: PurchaseOrder): PurchaseOrder[] {
  return orders.map((po) => (po.id === prior.id ? prior : po));
}

/**
 * Fold an incoming record (a hydrator snapshot row, or a mutation's reconciled DTO) onto what
 * the store already knows. No DTO on this router carries the note trail, so `incoming.notes` is
 * always `[]` straight out of dtoPurchaseOrderToStore — replacing wholesale would silently empty
 * a note list a modal had already loaded, every time a sibling field changed and this order
 * happened to be re-adopted. `prior`'s notes win whenever the incoming row has none.
 */
function mergeIncomingPO(prior: PurchaseOrder, incoming: PurchaseOrder): PurchaseOrder {
  return { ...incoming, notes: incoming.notes.length ? incoming.notes : prior.notes };
}

/** One line as the wire's update/create input wants it — `amount` is server-derived, never sent. */
interface POLineInput {
  id?: string;
  description: string;
  qty: number;
  uom: string;
  unitCostMillicents: number;
}

export interface PurchaseOrderUpdatePayload {
  poId: string;
  vendor?: string;
  jobId?: string | null;
  expectedAt?: string | null;
  shipToAddress?: string | null;
  freightCents?: number;
  taxCents?: number;
  lines?: POLineInput[];
}

/**
 * Build the v1.purchasing.update payload from a store patch, or null when the patch touches
 * nothing DB-backed. Every field on PurchaseOrder is DB-backed except `notes` (its own action,
 * appendPONote) and the read-only server-resolved fields (num, jobTitle, orderedByName,
 * orderedByUserId, orderedAt, status, createdAt, total) — those are never accepted here because
 * the wire's updateInput schema has no key for them; a patch touching only those returns null.
 */
export function buildPurchaseOrderUpdatePayload(
  id: string,
  patch: Partial<PurchaseOrder>,
): PurchaseOrderUpdatePayload | null {
  const payload: PurchaseOrderUpdatePayload = { poId: id };
  let persistable = false;

  if ("vendor" in patch && patch.vendor !== undefined) {
    payload.vendor = patch.vendor;
    persistable = true;
  }
  if ("jobId" in patch) {
    payload.jobId = patch.jobId ?? null;
    persistable = true;
  }
  if ("expectedAt" in patch) {
    payload.expectedAt = patch.expectedAt ?? null;
    persistable = true;
  }
  if ("shipToAddress" in patch) {
    payload.shipToAddress = patch.shipToAddress ?? null;
    persistable = true;
  }
  if ("freight" in patch && patch.freight != null) {
    payload.freightCents = Math.round(patch.freight * 100); // dollars → cents
    persistable = true;
  }
  if ("tax" in patch && patch.tax != null) {
    payload.taxCents = Math.round(patch.tax * 100); // dollars → cents
    persistable = true;
  }
  if ("lines" in patch && patch.lines !== undefined) {
    payload.lines = patch.lines.map((l) => ({
      // A line this device minted (a real, client-authored UUID — same convention createInput's
      // `id` follows) rides through as-is: the use-case upserts by id, minting its own only when
      // this key is absent entirely. Never omit-vs-empty-string here — an id is either the line's
      // real one or not present at all.
      ...(l.id ? { id: l.id } : {}),
      description: l.description,
      qty: l.qty,
      uom: l.uom,
      unitCostMillicents: l.unitCostMillicents,
    }));
    persistable = true;
  }

  return persistable ? payload : null;
}

// ---------------------------------------------------------------------------
// Slice
// ---------------------------------------------------------------------------

export interface PurchaseOrdersSlice {
  purchaseOrders: PurchaseOrder[];

  /**
   * Replace the purchase-orders array with a server snapshot — called by the hydrator. Each
   * incoming row is merged onto whatever the store already holds for that id (mergeIncomingPO)
   * so a note trail a modal already fetched survives the refetch.
   */
  adoptPurchaseOrders: (orders: PurchaseOrder[]) => void;

  /**
   * Put one purchase order into the store without a network write — the reconcile target for
   * every mutation here (create/update/place/cancel all return the full DTO) and the fetch-by-id
   * path for a record the hydrator's snapshot never reached. Inserts when unknown, merges
   * (preserving notes) when already held. Mirrors adoptInvoice/adoptLead.
   */
  adoptPurchaseOrder: (order: PurchaseOrder) => void;

  /**
   * Optimistic header/line edit — persists via v1.purchasing.update. Every field in `patch` is
   * applied to the store immediately; buildPurchaseOrderUpdatePayload then filters to the
   * DB-backed subset actually sent over the wire (skipping the network call entirely when the
   * patch is empty of those). Rolls back to the pre-edit snapshot and reports the failure —
   * never silently — if the server refuses or the request fails.
   */
  updatePurchaseOrder: (id: string, patch: Partial<PurchaseOrder>) => void;

  /**
   * Optimistically removes the order and persists via v1.purchasing.remove — a draft-only soft
   * delete; the server is the single source of truth for that rule (RemovePurchaseOrderUseCase),
   * not duplicated here. Re-inserts (at the front — original position isn't tracked) and reports
   * the failure if the server refuses, e.g. an already-placed order.
   */
  removePurchaseOrder: (id: string) => void;

  /**
   * Append a note to a purchase order's trail — optimistic, client-authored id, persists via
   * v1.purchasing.addNote, then reconciles the optimistic row with the server's (author name
   * resolved, real timestamp). Returns the optimistic note synchronously, same convention as
   * addLeadNote, so a caller needing it immediately (an Undo affordance) has it without waiting
   * on the round trip. A note against an order this device never loaded is a no-op past the
   * synchronous return — there is no row here to render it against or roll back.
   */
  appendPONote: (
    poId: string,
    note: { body: string; attachment?: { path: string; type: string; name: string } },
  ) => PurchaseOrderNote;
}

export const createPurchaseOrdersSlice: StateCreator<
  PurchaseOrdersSlice,
  [],
  [],
  PurchaseOrdersSlice
> = (set, get) => ({
  purchaseOrders: [],

  adoptPurchaseOrders: (orders) =>
    set((s) => ({
      purchaseOrders: orders.map((incoming) => {
        const prior = s.purchaseOrders.find((po) => po.id === incoming.id);
        return prior ? mergeIncomingPO(prior, incoming) : incoming;
      }),
    })),

  adoptPurchaseOrder: (order) =>
    set((s) => {
      const prior = s.purchaseOrders.find((po) => po.id === order.id);
      return {
        purchaseOrders: prior
          ? s.purchaseOrders.map((po) => (po.id === order.id ? mergeIncomingPO(prior, order) : po))
          : [order, ...s.purchaseOrders],
      };
    }),

  updatePurchaseOrder: (id, patch) => {
    const prior = snapshotPO(get().purchaseOrders, id);

    // 1. Optimistic local update — every field in the patch, including notes-adjacent ones this
    //    action never actually sends (there are none; notes has its own action).
    set((s) => ({
      purchaseOrders: s.purchaseOrders.map((po) => (po.id === id ? { ...po, ...patch } : po)),
    }));

    // 2. Persist only the DB-backed subset. A patch containing nothing persistable (there is
    //    none today, but a future caller may pass one) skips the network entirely.
    const payload = buildPurchaseOrderUpdatePayload(id, patch);
    if (!payload) return;

    trpcVanilla.v1.purchasing.update
      .mutate(payload)
      .then((dto) => {
        const reconciled = dtoPurchaseOrderToStore(dto);
        set((s) => ({
          purchaseOrders: s.purchaseOrders.map((po) =>
            po.id === id ? mergeIncomingPO(po, reconciled) : po,
          ),
        }));
      })
      .catch((err: unknown) => {
        if (prior) set((s) => ({ purchaseOrders: restorePOs(s.purchaseOrders, prior) }));
        reportWriteError("updatePurchaseOrder", err);
      });
  },

  removePurchaseOrder: (id) => {
    const prior = snapshotPO(get().purchaseOrders, id);
    if (!prior) return;

    // 1. Optimistic removal.
    set((s) => ({ purchaseOrders: s.purchaseOrders.filter((po) => po.id !== id) }));

    trpcVanilla.v1.purchasing.remove
      .mutate({ poId: id })
      .catch((err: unknown) => {
        // Rollback: re-insert. A silently vanished PO row (e.g. the server refused because it was
        // no longer a draft) is exactly the bug this exists to prevent.
        set((s) => ({ purchaseOrders: [prior, ...s.purchaseOrders] }));
        reportWriteError("removePurchaseOrder", err);
      });
  },

  appendPONote: (poId, note) => {
    const fullNote: PurchaseOrderNote = {
      id: crypto.randomUUID(),
      body: note.body,
      // Resolved server-side from ctx.principal — unknown until the mutation reconciles (see the
      // router's addNote: authorUserId is stamped from the caller, never accepted as client input).
      authorUserId: null,
      authorName: null,
      ...(note.attachment ? { attachment: note.attachment } : {}),
      createdAt: new Date().toISOString(),
    };

    const prior = snapshotPO(get().purchaseOrders, poId);
    // A note against an order this device never loaded has no row to render it against or roll
    // back to — persisting it would write a record no surface could show. Mirrors addLeadNote.
    if (!prior) return fullNote;

    set((s) => ({
      purchaseOrders: s.purchaseOrders.map((po) =>
        po.id === poId ? { ...po, notes: [...po.notes, fullNote] } : po,
      ),
    }));

    trpcVanilla.v1.purchasing.addNote
      .mutate({
        poId,
        body: note.body,
        ...(note.attachment ? { attachment: note.attachment } : {}),
      })
      .then((dto) => {
        const reconciled = dtoPurchaseOrderNoteToStore(dto);
        set((s) => ({
          purchaseOrders: s.purchaseOrders.map((po) =>
            po.id === poId
              ? { ...po, notes: po.notes.map((n) => (n.id === fullNote.id ? reconciled : n)) }
              : po,
          ),
        }));
      })
      .catch((err: unknown) => {
        set((s) => ({ purchaseOrders: restorePOs(s.purchaseOrders, prior) }));
        reportWriteError("appendPONote", err);
      });

    return fullNote;
  },
});
