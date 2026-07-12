/**
 * lib/store/slices/settings-slice.test.ts
 * Unit tests for settings-slice persistence layer.
 *
 * Each action is tested for:
 *   (a) Optimistic apply — state reflects change immediately before the network round-trip.
 *   (b) Correct mutation input — the trpcVanilla call receives the right payload.
 *   (c) Reconcile — the store adopts the server's canonical id/values after resolution.
 *   (d) Rollback — on rejection the state is restored to the pre-mutation snapshot.
 *
 * trpcVanilla is module-mocked so no network or Supabase session is needed.
 * vi.mock is hoisted by Vitest above all imports, so the module-under-test
 * sees the mock when it evaluates.
 */

// ---------------------------------------------------------------------------
// Module mocks (hoisted by Vitest before all imports)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreatePb = vi.fn().mockResolvedValue({
  id: "srv-pb",
  label: "Camera",
  unitPriceCents: 28500,
  costCents: 0,
  position: 0,
});
const mockUpdatePb = vi.fn().mockResolvedValue({
  id: "srv-pb",
  label: "Camera",
  unitPriceCents: 30000,
  costCents: 0,
  position: 0,
});
const mockRemovePb = vi.fn().mockResolvedValue({ ok: true });
const mockUpdateConfig = vi.fn().mockResolvedValue({ markupBps: 4200 });
const mockCreateSource = vi.fn().mockResolvedValue({ id: "srv-src", label: "Home show", position: 0 });
const mockRemoveSource = vi.fn().mockResolvedValue({ ok: true });
const mockCreateLabor = vi.fn().mockResolvedValue({ id: "srv-lr", label: "Standard", rateCentsPerHour: 17000, position: 0 });
const mockUpdateLabor = vi.fn().mockResolvedValue({ id: "srv-lr", label: "Standard", rateCentsPerHour: 18000, position: 0 });
const mockRemoveLabor = vi.fn().mockResolvedValue({ ok: true });
const mockCreateTerm = vi.fn().mockResolvedValue({ id: "srv-term", title: "Warranty", body: "12 months", position: 0 });
const mockRemoveTerm = vi.fn().mockResolvedValue({ ok: true });

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      settings: {
        updateConfig: { mutate: (...a: unknown[]) => mockUpdateConfig(...a) },
        pricebook: {
          create: { mutate: (...a: unknown[]) => mockCreatePb(...a) },
          update: { mutate: (...a: unknown[]) => mockUpdatePb(...a) },
          remove: { mutate: (...a: unknown[]) => mockRemovePb(...a) },
        },
        laborRates: {
          create: { mutate: (...a: unknown[]) => mockCreateLabor(...a) },
          update: { mutate: (...a: unknown[]) => mockUpdateLabor(...a) },
          remove: { mutate: (...a: unknown[]) => mockRemoveLabor(...a) },
        },
        terms: {
          create: { mutate: (...a: unknown[]) => mockCreateTerm(...a) },
          update: { mutate: vi.fn().mockResolvedValue({ id: "srv-term", title: "Warranty", body: "Updated body", position: 0 }) },
          remove: { mutate: (...a: unknown[]) => mockRemoveTerm(...a) },
        },
        sources: {
          create: { mutate: (...a: unknown[]) => mockCreateSource(...a) },
          remove: { mutate: (...a: unknown[]) => mockRemoveSource(...a) },
        },
      },
    },
  },
}));

// Static imports — resolved AFTER the mock above is registered.
import { createSettingsSlice, buildBookingPayload } from "./settings-slice";
import type { SettingsSlice } from "./settings-slice";

// ---------------------------------------------------------------------------
// Minimal store factory (mirrors leads-slice.test.ts pattern)
// ---------------------------------------------------------------------------

function makeStore() {
  let state = {} as SettingsSlice;
  const set = (
    partial:
      | Partial<SettingsSlice>
      | ((s: SettingsSlice) => Partial<SettingsSlice>),
  ) => {
    const next = typeof partial === "function" ? partial(state) : partial;
    state = { ...state, ...next };
  };
  const get = () => state;
  state = createSettingsSlice(set as never, get as never, {} as never);
  return { get, set };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("settings-slice persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- pricebook -------------------------------------------------------------

  it("addPricebookItem optimistically appends then reconciles the server id", async () => {
    const store = makeStore();
    store.get().addPricebookItem("Camera", 285, 0);

    // Optimistic row present immediately (unitPrice is cents in server, dollars in store)
    expect(store.get().pricebook.some((p) => p.label === "Camera")).toBe(true);

    // Let the promise resolve
    await Promise.resolve();
    await Promise.resolve();

    expect(mockCreatePb).toHaveBeenCalledTimes(1);

    // Mutation payload carries the label and cents
    const arg = mockCreatePb.mock.calls[0]![0] as {
      label: string;
      unitPriceCents: number;
    };
    expect(arg.label).toBe("Camera");
    expect(arg.unitPriceCents).toBe(28500); // 285 * 100

    // After reconciliation the row carries the server id
    expect(store.get().pricebook.some((p) => p.id === "srv-pb")).toBe(true);
  });

  it("addPricebookItem dedupes by label (case-insensitive)", () => {
    const store = makeStore();
    store.get().addPricebookItem("Camera", 285, 0);
    const before = store.get().pricebook.length;
    store.get().addPricebookItem("camera", 285, 0); // duplicate
    expect(store.get().pricebook).toHaveLength(before);
    expect(mockCreatePb).toHaveBeenCalledTimes(1);
  });

  it("removePricebookItem rolls back on rejection", async () => {
    mockRemovePb.mockRejectedValueOnce(new Error("boom"));
    const store = makeStore();
    // Seed a pricebook item with a string id
    store.set({ pricebook: [{ id: "p1", label: "Camera", unitPrice: 285, cost: 0 }] });
    store.get().removePricebookItem("p1");

    // Optimistic removal
    expect(store.get().pricebook).toHaveLength(0);

    await Promise.resolve();
    await Promise.resolve();

    // Rolled back
    expect(store.get().pricebook.some((p) => p.id === "p1")).toBe(true);
  });

  it("updatePricebookItem rolls back on rejection", async () => {
    mockUpdatePb.mockRejectedValueOnce(new Error("fail"));
    const store = makeStore();
    store.set({
      pricebook: [{ id: "p1", label: "Old label", unitPrice: 100, cost: 0 }],
    });
    store.get().updatePricebookItem("p1", "label", "New label");

    // Optimistic update
    expect(store.get().pricebook.find((p) => p.id === "p1")?.label).toBe("New label");

    await Promise.resolve();
    await Promise.resolve();

    // Rolled back
    expect(store.get().pricebook.find((p) => p.id === "p1")?.label).toBe("Old label");
  });

  // --- setMarkup -------------------------------------------------------------

  it("setMarkup persists via updateConfig (bps)", async () => {
    const store = makeStore();
    store.get().setMarkup(42);
    expect(store.get().markup).toBe(42);
    await Promise.resolve();
    expect(mockUpdateConfig).toHaveBeenCalledWith({ markupBps: 4200 });
  });

  it("setMarkup rolls back on rejection", async () => {
    mockUpdateConfig.mockRejectedValueOnce(new Error("fail"));
    const store = makeStore();
    const before = store.get().markup;
    store.get().setMarkup(99);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.get().markup).toBe(before);
  });

  // --- sources ---------------------------------------------------------------

  it("addSource optimistically appends then reconciles server id", async () => {
    const store = makeStore();
    store.get().addSource("Home show");
    expect(store.get().sources.some((x) => x.label === "Home show")).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockCreateSource).toHaveBeenCalledTimes(1);
    expect(store.get().sources.some((x) => x.id === "srv-src")).toBe(true);
  });

  it("addSource dedupes case-insensitively before persisting", async () => {
    const store = makeStore();
    store.set({ sources: [{ id: "x", label: "Google" }] });
    store.get().addSource("google");
    await Promise.resolve();
    expect(mockCreateSource).not.toHaveBeenCalled();
    expect(store.get().sources).toHaveLength(1);
  });

  it("removeSource rolls back on rejection", async () => {
    mockRemoveSource.mockRejectedValueOnce(new Error("boom"));
    const store = makeStore();
    store.set({ sources: [{ id: "s1", label: "Google" }] });
    store.get().removeSource("s1");
    expect(store.get().sources).toHaveLength(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.get().sources.some((x) => x.id === "s1")).toBe(true);
  });

  // --- laborRates ------------------------------------------------------------

  it("addLaborRate optimistically appends then reconciles server id", async () => {
    const store = makeStore();
    store.get().addLaborRate("Standard", 170);
    expect(store.get().laborRates.some((r) => r.name === "Standard")).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockCreateLabor).toHaveBeenCalledTimes(1);
    const arg = mockCreateLabor.mock.calls[0]![0] as { label: string; rateCentsPerHour: number };
    expect(arg.label).toBe("Standard");
    expect(arg.rateCentsPerHour).toBe(17000); // 170 * 100
    expect(store.get().laborRates.some((r) => r.id === "srv-lr")).toBe(true);
  });

  it("removeLaborRate rolls back on rejection", async () => {
    mockRemoveLabor.mockRejectedValueOnce(new Error("fail"));
    const store = makeStore();
    store.set({
      laborRates: [
        { id: "lr1", name: "Standard", rate: 170 },
        { id: "lr2", name: "After hours", rate: 255 },
      ],
    });
    store.get().removeLaborRate("lr1");
    expect(store.get().laborRates).toHaveLength(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.get().laborRates).toHaveLength(2);
  });

  it("removeLaborRate does nothing when only one rate remains", () => {
    const store = makeStore();
    store.set({ laborRates: [{ id: "lr1", name: "Standard", rate: 170 }] });
    store.get().removeLaborRate("lr1");
    expect(store.get().laborRates).toHaveLength(1);
    expect(mockRemoveLabor).not.toHaveBeenCalled();
  });

  // --- terms -----------------------------------------------------------------

  it("addTerm optimistically appends then reconciles server id", async () => {
    const store = makeStore();
    store.get().addTerm("Warranty", "12 months");
    expect(store.get().terms.some((x) => x.t === "Warranty")).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockCreateTerm).toHaveBeenCalledTimes(1);
    const arg = mockCreateTerm.mock.calls[0]![0] as { title: string; body: string };
    expect(arg.title).toBe("Warranty");
    expect(arg.body).toBe("12 months");
    expect(store.get().terms.some((x) => x.id === "srv-term")).toBe(true);
  });

  it("removeTerm rolls back on rejection", async () => {
    mockRemoveTerm.mockRejectedValueOnce(new Error("fail"));
    const store = makeStore();
    store.set({ terms: [{ id: "t1", t: "Warranty", body: "12 months" }] });
    store.get().removeTerm("t1");
    expect(store.get().terms).toHaveLength(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.get().terms.some((x) => x.id === "t1")).toBe(true);
  });

  // --- setSettings -----------------------------------------------------------

  it("setSettings replaces the whole slice state", () => {
    const store = makeStore();
    const snap = {
      pricebook: [{ id: "p99", label: "Item", unitPrice: 100, cost: 0 }],
      laborRates: [{ id: "lr99", name: "Flat rate", rate: 200 }],
      terms: [{ id: "tm99", t: "Warranty", body: "12mo" }],
      sources: [{ id: "src99", label: "Google" }],
      booking: store.get().booking,
      visitDur: { scope: 1, repair: 2, install: 6 },
      markup: 40,
      trade: "hvac",
      toggles: { techSeesPrice: false, frontDesk: false, scopeOn: true },
    };
    store.get().setSettings(snap);
    expect(store.get().markup).toBe(40);
    expect(store.get().trade).toBe("hvac");
    expect(store.get().visitDur.scope).toBe(1);
    expect(store.get().sources[0]?.id).toBe("src99");
  });

  // --- buildBookingPayload ---------------------------------------------------

  it("buildBookingPayload produces the correct flat payload", () => {
    const booking = {
      services: [{ name: "Drain cleaning", lane: "flat" as const, price: 99, triggers: "clogged" }],
      notServices: "Septic",
      serviceFee: 89,
      feeCredited: true,
      hours: { wdOpen: 8, wdClose: 17, satOpen: 0, satClose: 0, sunOpen: 0, sunClose: 0 },
      area: { cities: "Oakland", radiusMi: 25 },
    };
    const payload = buildBookingPayload(booking);
    expect(payload.booking.services[0]?.name).toBe("Drain cleaning");
    expect(payload.booking.notServices).toBe("Septic");
    expect(payload.booking.serviceFee).toBe(89);
    expect(payload.hoursWdOpen).toBe(8);
    expect(payload.hoursWdClose).toBe(17);
    expect(payload.areaCities).toBe("Oakland");
    expect(payload.areaRadiusMi).toBe(25);
  });

  // --- misc config -----------------------------------------------------------

  it("setTrade persists via updateConfig", async () => {
    const store = makeStore();
    store.get().setTrade("hvac");
    expect(store.get().trade).toBe("hvac");
    await Promise.resolve();
    expect(mockUpdateConfig).toHaveBeenCalledWith({ trade: "hvac" });
  });

  it("setToggle persists via updateConfig with explicit field mapping", async () => {
    const store = makeStore();
    store.get().setToggle("frontDesk", false);
    expect(store.get().toggles.frontDesk).toBe(false);
    await Promise.resolve();
    expect(mockUpdateConfig).toHaveBeenCalledWith({ frontDesk: false });
  });

  it("setToggle maps techSeesPrice toggle to correct updateConfig field", async () => {
    const store = makeStore();
    store.get().setToggle("techSeesPrice", false);
    expect(store.get().toggles.techSeesPrice).toBe(false);
    await Promise.resolve();
    expect(mockUpdateConfig).toHaveBeenCalledWith({ techSeesPrice: false });
  });

  it("setVisitDur converts minutes to hours and persists via updateConfig", async () => {
    const store = makeStore();
    store.get().setVisitDur("scope", 30); // 30 minutes → 0.5 hours
    expect(store.get().visitDur.scope).toBeCloseTo(0.5);
    await Promise.resolve();
    expect(mockUpdateConfig).toHaveBeenCalledWith({ visitScopeMinutes: 30 });
  });

  // --- collections start empty -----------------------------------------------

  it("pricebook starts empty (no SEED_* data)", () => {
    const store = makeStore();
    expect(store.get().pricebook).toHaveLength(0);
  });

  it("laborRates starts empty (no SEED_* data)", () => {
    const store = makeStore();
    expect(store.get().laborRates).toHaveLength(0);
  });

  it("terms starts empty (no SEED_* data)", () => {
    const store = makeStore();
    expect(store.get().terms).toHaveLength(0);
  });

  it("sources starts empty (no SEED_* data)", () => {
    const store = makeStore();
    expect(store.get().sources).toHaveLength(0);
  });
});
