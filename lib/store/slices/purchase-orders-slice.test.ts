/**
 * lib/store/slices/purchase-orders-slice.test.ts
 * Unit tests for buildPurchaseOrderUpdatePayload and every action on
 * PurchaseOrdersSlice: adoptPurchaseOrders, adoptPurchaseOrder,
 * updatePurchaseOrder, removePurchaseOrder, appendPONote.
 *
 * trpcVanilla and ../write-error are module-mocked so no network/Supabase
 * session is needed and a rolled-back write's failure announcement is
 * assertable directly (vi.mock is hoisted above all imports).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";

const mutate = {
  update: vi.fn(),
  remove: vi.fn(),
  addNote: vi.fn(),
};

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      purchasing: {
        update: { mutate: (...a: unknown[]) => mutate.update(...a) },
        remove: { mutate: (...a: unknown[]) => mutate.remove(...a) },
        addNote: { mutate: (...a: unknown[]) => mutate.addNote(...a) },
      },
    },
  },
}));

const reportWriteError = vi.fn();
vi.mock("../write-error", () => ({
  reportWriteError: (...a: unknown[]) => reportWriteError(...a),
}));

import {
  createPurchaseOrdersSlice,
  buildPurchaseOrderUpdatePayload,
  type PurchaseOrdersSlice,
} from "./purchase-orders-slice";
import { dtoPurchaseOrderToStore } from "@/lib/store/dto-mapper";
import type { PurchaseOrder } from "@/lib/store/types";

const flush = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function po(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: "po-1",
    num: null,
    vendor: "Ferguson",
    status: "draft",
    jobId: null,
    jobTitle: null,
    orderedAt: null,
    expectedAt: null,
    shipToAddress: "412 Elm St, Unit 4",
    orderedByUserId: "user-1",
    orderedByName: "Dana",
    freight: 12.5,
    tax: 8.75,
    total: 100,
    lines: [{ id: "line-1", description: "PEX fitting", qty: 10, uom: "ea", unitCostMillicents: 125_000, amount: 12.5 }],
    createdAt: "2026-08-01T00:00:00.000Z",
    notes: [],
    ...overrides,
  };
}

/** DTO shape as the purchaseOrderDTO wire schema defines it. */
const dbDto = (overrides: Record<string, unknown> = {}) => ({
  id: "po-1",
  num: null,
  vendor: "Ferguson",
  status: "draft",
  jobId: null,
  jobTitle: null,
  orderedAt: null,
  expectedAt: null,
  shipToAddress: "412 Elm St, Unit 4",
  orderedByUserId: "user-1",
  orderedByName: "Dana",
  freight: { cents: 1_250, currency: "USD" },
  tax: { cents: 875, currency: "USD" },
  total: { cents: 10_000, currency: "USD" },
  lines: [
    {
      id: "line-1",
      description: "PEX fitting",
      qty: 10,
      uom: "ea",
      unitCostMillicents: 125_000,
      amount: { cents: 1_250, currency: "USD" },
    },
  ],
  createdAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

const noteDto = (overrides: Record<string, unknown> = {}) => ({
  id: "note-1",
  body: "Called vendor, backordered a week",
  authorUserId: "user-1",
  authorName: "Dana",
  attachmentPath: null,
  attachmentName: null,
  attachmentType: null,
  createdAt: "2026-08-02T00:00:00.000Z",
  ...overrides,
});

// ---------------------------------------------------------------------------
// dtoPurchaseOrderToStore — money in DOLLARS, converted once
// ---------------------------------------------------------------------------

describe("dtoPurchaseOrderToStore", () => {
  it("stores money in DOLLARS, converting once in dto-mapper", () => {
    const order = dtoPurchaseOrderToStore(dbDto({ total: { cents: 95_270, currency: "USD" } }) as never);
    expect(order.total).toBe(952.7);
  });

  it("carries unitCostMillicents through UNCONVERTED — it is a rate, not a money amount", () => {
    const order = dtoPurchaseOrderToStore(dbDto() as never);
    expect(order.lines[0]?.unitCostMillicents).toBe(125_000);
    // The line's own extended amount DOES convert (it's a real dollar figure).
    expect(order.lines[0]?.amount).toBe(12.5);
  });

  it("starts notes empty — no DTO on this router carries the note trail", () => {
    expect(dtoPurchaseOrderToStore(dbDto() as never).notes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildPurchaseOrderUpdatePayload — pure helper
// ---------------------------------------------------------------------------

describe("buildPurchaseOrderUpdatePayload", () => {
  it("returns null for a patch with nothing DB-backed", () => {
    expect(buildPurchaseOrderUpdatePayload("po-1", {})).toBeNull();
  });

  it("maps vendor and shipToAddress straight through", () => {
    const p = buildPurchaseOrderUpdatePayload("po-1", { vendor: "Home Depot", shipToAddress: "1200 Industrial Pkwy" });
    expect(p).toEqual({ poId: "po-1", vendor: "Home Depot", shipToAddress: "1200 Industrial Pkwy" });
  });

  it("maps shipToAddress cleared to null", () => {
    const p = buildPurchaseOrderUpdatePayload("po-1", { shipToAddress: null });
    expect(p).toEqual({ poId: "po-1", shipToAddress: null });
  });

  it("maps freight/tax dollars → cents", () => {
    const p = buildPurchaseOrderUpdatePayload("po-1", { freight: 12.5, tax: 8.75 });
    expect(p?.freightCents).toBe(1_250);
    expect(p?.taxCents).toBe(875);
  });

  it("maps a jobId change, including clearing it to null", () => {
    expect(buildPurchaseOrderUpdatePayload("po-1", { jobId: "job-9" })?.jobId).toBe("job-9");
    expect(buildPurchaseOrderUpdatePayload("po-1", { jobId: null })?.jobId).toBeNull();
  });

  it("maps lines, preserving a real line id and stripping the server-derived amount", () => {
    const p = buildPurchaseOrderUpdatePayload("po-1", {
      lines: [{ id: "line-1", description: "PEX fitting", qty: 10, uom: "ea", unitCostMillicents: 125_000, amount: 12.5 }],
    });
    expect(p?.lines).toEqual([
      { id: "line-1", description: "PEX fitting", qty: 10, uom: "ea", unitCostMillicents: 125_000 },
    ]);
  });

  it("omits the id key entirely for a line with none, letting the server mint one", () => {
    const p = buildPurchaseOrderUpdatePayload("po-1", {
      lines: [{ id: "", description: "New part", qty: 1, uom: "ea", unitCostMillicents: 50_000, amount: 0.5 }],
    });
    expect(p?.lines?.[0]).not.toHaveProperty("id");
  });
});

// ---------------------------------------------------------------------------
// Slice actions
// ---------------------------------------------------------------------------

describe("purchaseOrdersSlice", () => {
  let store: StoreApi<PurchaseOrdersSlice>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore<PurchaseOrdersSlice>((set, get, api) => createPurchaseOrdersSlice(set, get, api));
  });

  it("starts empty", () => {
    expect(store.getState().purchaseOrders).toEqual([]);
  });

  describe("adoptPurchaseOrders", () => {
    it("replaces the whole array with the snapshot", () => {
      store.getState().adoptPurchaseOrders([po(), po({ id: "po-2" })]);
      expect(store.getState().purchaseOrders.map((p) => p.id)).toEqual(["po-1", "po-2"]);
    });

    it("preserves notes a modal already loaded — a snapshot row never carries them", () => {
      const note = { id: "note-1", body: "hi", authorUserId: null, authorName: null, createdAt: "2026-08-01T00:00:00.000Z" };
      store.getState().adoptPurchaseOrders([po({ notes: [note] })]);
      // Re-adopt the SAME order id via a fresh snapshot row (notes: [], as every list DTO is).
      store.getState().adoptPurchaseOrders([po({ vendor: "Renamed", notes: [] })]);
      const held = store.getState().purchaseOrders[0];
      expect(held?.vendor).toBe("Renamed");
      expect(held?.notes).toEqual([note]);
    });
  });

  describe("adoptPurchaseOrder", () => {
    it("inserts when the order is unknown", () => {
      store.getState().adoptPurchaseOrder(po());
      expect(store.getState().purchaseOrders).toHaveLength(1);
    });

    it("merges (preserving notes) when the order is already held", () => {
      const note = { id: "note-1", body: "hi", authorUserId: null, authorName: null, createdAt: "2026-08-01T00:00:00.000Z" };
      store.getState().adoptPurchaseOrder(po({ notes: [note] }));
      store.getState().adoptPurchaseOrder(po({ status: "ordered", num: "PO-1001", notes: [] }));
      const held = store.getState().purchaseOrders[0];
      expect(held?.status).toBe("ordered");
      expect(held?.notes).toEqual([note]);
    });
  });

  describe("updatePurchaseOrder", () => {
    it("applies the patch optimistically before the network resolves", () => {
      mutate.update.mockReturnValue(new Promise(() => undefined)); // never resolves
      store.getState().adoptPurchaseOrder(po());
      store.getState().updatePurchaseOrder("po-1", { vendor: "Home Depot" });
      expect(store.getState().purchaseOrders[0]?.vendor).toBe("Home Depot");
    });

    it("sends only the DB-backed subset of the patch", () => {
      mutate.update.mockResolvedValue(dbDto({ vendor: "Home Depot" }));
      store.getState().adoptPurchaseOrder(po());
      store.getState().updatePurchaseOrder("po-1", { vendor: "Home Depot" });
      expect(mutate.update).toHaveBeenCalledWith({ poId: "po-1", vendor: "Home Depot" });
    });

    it("reconciles with the server DTO on success", async () => {
      mutate.update.mockResolvedValue(dbDto({ vendor: "Home Depot", freight: { cents: 500, currency: "USD" } }));
      store.getState().adoptPurchaseOrder(po());
      store.getState().updatePurchaseOrder("po-1", { vendor: "Home Depot" });
      await flush();
      const held = store.getState().purchaseOrders[0];
      expect(held?.vendor).toBe("Home Depot");
      expect(held?.freight).toBe(5); // cents → dollars, reconciled from the server
    });

    it("preserves notes across the reconcile — the update DTO carries none", async () => {
      const note = { id: "note-1", body: "hi", authorUserId: null, authorName: null, createdAt: "2026-08-01T00:00:00.000Z" };
      mutate.update.mockResolvedValue(dbDto());
      store.getState().adoptPurchaseOrder(po({ notes: [note] }));
      store.getState().updatePurchaseOrder("po-1", { vendor: "Renamed" });
      await flush();
      expect(store.getState().purchaseOrders[0]?.notes).toEqual([note]);
    });

    // THE HOUSE PATTERN this whole test file exists to pin: optimistic → trpcVanilla mutate →
    // reconcile from the returned DTO → on failure ROLL BACK and name the failure. A silent
    // rollback — the store reverting with nobody told why — is the bug this test prevents.
    it("optimistically applies an edit and rolls back on failure, naming the failure", async () => {
      mutate.update.mockRejectedValue(new Error("network down"));
      store.getState().adoptPurchaseOrder(po({ vendor: "Ferguson" }));

      store.getState().updatePurchaseOrder("po-1", { vendor: "Home Depot" });
      expect(store.getState().purchaseOrders[0]?.vendor).toBe("Home Depot"); // optimistic

      await flush();

      expect(store.getState().purchaseOrders[0]?.vendor).toBe("Ferguson"); // rolled back
      // The failure is NAMED, not swallowed — the action and the real error both reach the
      // visible announcer (and the dev console, inside reportWriteError itself).
      expect(reportWriteError).toHaveBeenCalledWith("updatePurchaseOrder", expect.any(Error));
    });

    it("skips the network entirely for a patch with nothing DB-backed", () => {
      store.getState().adoptPurchaseOrder(po());
      store.getState().updatePurchaseOrder("po-1", {});
      expect(mutate.update).not.toHaveBeenCalled();
    });
  });

  describe("removePurchaseOrder", () => {
    it("removes optimistically and stays removed on success", async () => {
      mutate.remove.mockResolvedValue({ removed: true });
      store.getState().adoptPurchaseOrder(po());

      store.getState().removePurchaseOrder("po-1");
      expect(store.getState().purchaseOrders).toHaveLength(0);
      await flush();
      expect(store.getState().purchaseOrders).toHaveLength(0);
    });

    it("rolls back and names the failure when the server refuses (e.g. no longer a draft)", async () => {
      mutate.remove.mockRejectedValue(new Error("This order has already been placed."));
      store.getState().adoptPurchaseOrder(po());

      store.getState().removePurchaseOrder("po-1");
      expect(store.getState().purchaseOrders).toHaveLength(0);
      await flush();

      expect(store.getState().purchaseOrders).toHaveLength(1);
      expect(store.getState().purchaseOrders[0]?.id).toBe("po-1");
      expect(reportWriteError).toHaveBeenCalledWith("removePurchaseOrder", expect.any(Error));
    });

    it("is a no-op for an order the store never held", () => {
      store.getState().removePurchaseOrder("ghost");
      expect(mutate.remove).not.toHaveBeenCalled();
    });
  });

  describe("appendPONote", () => {
    it("appends optimistically with a client-authored id and returns it synchronously", () => {
      mutate.addNote.mockReturnValue(new Promise(() => undefined)); // never resolves
      store.getState().adoptPurchaseOrder(po());

      const note = store.getState().appendPONote("po-1", { body: "Called vendor" });
      expect(note.body).toBe("Called vendor");
      expect(note.id).toBeTruthy();
      expect(store.getState().purchaseOrders[0]?.notes).toHaveLength(1);
    });

    it("reconciles the optimistic note with the server's (author name resolved)", async () => {
      mutate.addNote.mockResolvedValue(noteDto());
      store.getState().adoptPurchaseOrder(po());

      const optimistic = store.getState().appendPONote("po-1", { body: "Called vendor, backordered a week" });
      await flush();

      const notes = store.getState().purchaseOrders[0]?.notes ?? [];
      expect(notes).toHaveLength(1);
      expect(notes[0]?.id).toBe("note-1"); // server id replaces the client-authored one
      expect(notes[0]?.authorName).toBe("Dana");
      expect(optimistic.authorName).toBeNull(); // the synchronous return had no author yet
    });

    it("rolls back the append and names the failure on error", async () => {
      mutate.addNote.mockRejectedValue(new Error("network down"));
      store.getState().adoptPurchaseOrder(po());

      store.getState().appendPONote("po-1", { body: "Called vendor" });
      expect(store.getState().purchaseOrders[0]?.notes).toHaveLength(1);
      await flush();

      expect(store.getState().purchaseOrders[0]?.notes).toHaveLength(0);
      expect(reportWriteError).toHaveBeenCalledWith("appendPONote", expect.any(Error));
    });

    it("is a no-op for an order the store never held, but still returns the note", () => {
      const note = store.getState().appendPONote("ghost", { body: "hi" });
      expect(note.body).toBe("hi");
      expect(mutate.addNote).not.toHaveBeenCalled();
    });
  });
});
