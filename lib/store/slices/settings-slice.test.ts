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

const mockUpdateConfig = vi.fn().mockResolvedValue({ markupBps: 4200 });
const mockCreateSource = vi.fn().mockResolvedValue({ id: "srv-src", label: "Home show", position: 0 });
const mockRemoveSource = vi.fn().mockResolvedValue({ ok: true });
const mockCreateLabor = vi.fn().mockResolvedValue({ id: "srv-lr", label: "Standard", rateCentsPerHour: 17000, kind: "hourly", position: 0 });
const mockUpdateLabor = vi.fn().mockResolvedValue({ id: "srv-lr", label: "Standard", rateCentsPerHour: 18000, kind: "hourly", position: 0 });
const mockRemoveLabor = vi.fn().mockResolvedValue({ ok: true });
const mockCreateTerm = vi.fn().mockResolvedValue({ id: "srv-term", title: "Warranty", body: "12 months", position: 0 });
const mockRemoveTerm = vi.fn().mockResolvedValue({ ok: true });

vi.mock("@/lib/trpc/vanilla", () => ({
  trpcVanilla: {
    v1: {
      settings: {
        updateConfig: { mutate: (...a: unknown[]) => mockUpdateConfig(...a) },
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

  it("addSource is a no-op for a hardcoded default label (case-insensitive)", async () => {
    const store = makeStore();
    // "Google" is a DEFAULT_SOURCES entry that is NOT in the store's custom
    // sources — persisting it would create an invisible duplicate row (the
    // merged picker already shows the default).
    store.get().addSource("google");
    store.get().addSource("NEXTDOOR / fb");
    await Promise.resolve();
    expect(mockCreateSource).not.toHaveBeenCalled();
    expect(store.get().sources).toHaveLength(0);
  });

  it("addSource reports its outcome so the UI can give feedback (no silent failures)", async () => {
    const store = makeStore();
    expect(await store.get().addSource("   ")).toEqual({ ok: false, reason: "empty" });
    expect(await store.get().addSource("Google")).toEqual({ ok: false, reason: "duplicate" }); // a default
    store.set({ sources: [{ id: "x", label: "Truck wrap" }] });
    expect(await store.get().addSource("truck wrap")).toEqual({ ok: false, reason: "duplicate" }); // existing custom
    expect(await store.get().addSource("Home show")).toEqual({ ok: true });
  });

  it("addSource returns {ok:false, reason:'failed'} and rolls back when the persist rejects", async () => {
    mockCreateSource.mockRejectedValueOnce(new Error("boom"));
    const store = makeStore();
    const r = await store.get().addSource("Home show");
    expect(r).toEqual({ ok: false, reason: "failed" });
    expect(store.get().sources.some((x) => x.label === "Home show")).toBe(false); // rolled back
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
    const arg = mockCreateLabor.mock.calls[0]![0] as { label: string; rateCentsPerHour: number; kind: string };
    expect(arg.label).toBe("Standard");
    expect(arg.rateCentsPerHour).toBe(17000); // 170 * 100
    expect(store.get().laborRates.some((r) => r.id === "srv-lr")).toBe(true);
  });

  it("addLaborRate defaults kind to 'hourly' when omitted", async () => {
    const store = makeStore();
    store.get().addLaborRate("Standard", 170);
    expect(store.get().laborRates.find((r) => r.name === "Standard")?.kind).toBe("hourly");
    await Promise.resolve();
    await Promise.resolve();
    const arg = mockCreateLabor.mock.calls[0]![0] as { kind: string };
    expect(arg.kind).toBe("hourly");
  });

  it("addLaborRate passes an explicit 'flat_fee' kind through to create and the optimistic row", async () => {
    mockCreateLabor.mockResolvedValueOnce({ id: "srv-flat", label: "Diagnostic fee", rateCentsPerHour: 9500, kind: "flat_fee", position: 0 });
    const store = makeStore();
    store.get().addLaborRate("Diagnostic fee", 95, "flat_fee");
    expect(store.get().laborRates.find((r) => r.name === "Diagnostic fee")?.kind).toBe("flat_fee");
    await Promise.resolve();
    await Promise.resolve();
    const arg = mockCreateLabor.mock.calls[0]![0] as { kind: string };
    expect(arg.kind).toBe("flat_fee");
    expect(store.get().laborRates.find((r) => r.id === "srv-flat")?.kind).toBe("flat_fee");
  });

  it("addLaborRate rolls back (removes the optimistic row) when create rejects", async () => {
    mockCreateLabor.mockRejectedValueOnce(new Error("boom"));
    const store = makeStore();
    store.get().addLaborRate("Diagnostic fee", 95, "flat_fee");
    expect(store.get().laborRates.some((r) => r.name === "Diagnostic fee")).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.get().laborRates.some((r) => r.name === "Diagnostic fee")).toBe(false);
  });

  it("updateLaborRate supports switching kind and persists it, rolling back on rejection", async () => {
    const store = makeStore();
    store.set({ laborRates: [{ id: "lr1", name: "Standard", rate: 170, kind: "hourly" }] });
    store.get().updateLaborRate("lr1", "kind", "flat_fee");
    expect(store.get().laborRates.find((r) => r.id === "lr1")?.kind).toBe("flat_fee");
    await Promise.resolve();
    const arg = mockUpdateLabor.mock.calls[0]![0] as { kind: string };
    expect(arg.kind).toBe("flat_fee");

    mockUpdateLabor.mockRejectedValueOnce(new Error("fail"));
    store.get().updateLaborRate("lr1", "kind", "hourly");
    expect(store.get().laborRates.find((r) => r.id === "lr1")?.kind).toBe("hourly");
    await Promise.resolve();
    await Promise.resolve();
    expect(store.get().laborRates.find((r) => r.id === "lr1")?.kind).toBe("flat_fee"); // rolled back
  });

  it("removeLaborRate rolls back on rejection", async () => {
    mockRemoveLabor.mockRejectedValueOnce(new Error("fail"));
    const store = makeStore();
    store.set({
      laborRates: [
        { id: "lr1", name: "Standard", rate: 170, kind: "hourly" },
        { id: "lr2", name: "After hours", rate: 255, kind: "hourly" },
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
    store.set({ laborRates: [{ id: "lr1", name: "Standard", rate: 170, kind: "hourly" }] });
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
      laborRates: [{ id: "lr99", name: "Flat rate", rate: 200, kind: "hourly" as const }],
      terms: [{ id: "tm99", t: "Warranty", body: "12mo" }],
      sources: [{ id: "src99", label: "Google" }],
      booking: store.get().booking,
      markup: 40,
      trade: "hvac",
      toggles: { techSeesPrice: false, frontDesk: false, autoRemind: false, measurementEstimating: false },
    };
    store.get().setSettings(snap);
    expect(store.get().markup).toBe(40);
    expect(store.get().trade).toBe("hvac");
    expect(store.get().toggles.frontDesk).toBe(false);
    expect(store.get().sources[0]?.id).toBe("src99");
  });

  // --- seedBookingServices (trade starter playbooks) ---------------------------

  it("seedBookingServices appends the batch, persists once, and skips duplicates by name", async () => {
    const store = makeStore();
    const before = store.get().booking.services.length;
    store.get().seedBookingServices([
      { name: "Leak repair", lane: "estimate", feeApplies: true, triggers: "leak, dripping" },
      { name: "Repipe / larger job", lane: "estimate", triggers: "repipe" },
    ]);
    expect(store.get().booking.services.length).toBe(before + 2);
    await Promise.resolve();
    expect(mockUpdateConfig).toHaveBeenCalledTimes(1);

    // Re-seeding the same names (any case) adds nothing and does not persist again.
    store.get().seedBookingServices([
      { name: "LEAK REPAIR", lane: "estimate", feeApplies: true, triggers: "x" },
    ]);
    expect(store.get().booking.services.length).toBe(before + 2);
    await Promise.resolve();
    expect(mockUpdateConfig).toHaveBeenCalledTimes(1);
  });

  it("seedBookingServices rolls back on rejection", async () => {
    mockUpdateConfig.mockRejectedValueOnce(new Error("fail"));
    const store = makeStore();
    const before = store.get().booking.services.length;
    store.get().seedBookingServices([{ name: "Storm work", lane: "estimate", feeApplies: true, triggers: "tree fell" }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.get().booking.services.length).toBe(before);
  });

  // --- setBookingDayHours (atomic open+close) --------------------------------

  it("setBookingDayHours persists open+close in ONE write, never the invalid {open, close:0} intermediate", async () => {
    const store = makeStore();
    // Start from Closed (the sentinel), then clear so we only observe the toggle-to-open write.
    store.get().setBookingDayHours("wdOpen", "wdClose", 0, 0);
    await Promise.resolve();
    vi.clearAllMocks();

    // Toggle back to Open: 8–17 must land as a single persisted write with BOTH fields set.
    store.get().setBookingDayHours("wdOpen", "wdClose", 8, 17);
    expect(store.get().booking.hours.wdOpen).toBe(8);
    expect(store.get().booking.hours.wdClose).toBe(17);
    await Promise.resolve();

    expect(mockUpdateConfig).toHaveBeenCalledTimes(1);
    const payload = mockUpdateConfig.mock.calls[0]![0] as { hoursWdOpen: number; hoursWdClose: number };
    expect(payload.hoursWdOpen).toBe(8);
    expect(payload.hoursWdClose).toBe(17);
    // The bug was a separate first write persisting {open:8, close:0}; it must never be emitted.
    const emittedInvalidIntermediate = mockUpdateConfig.mock.calls.some((c) => {
      const p = c[0] as { hoursWdOpen: number; hoursWdClose: number };
      return p.hoursWdOpen === 8 && p.hoursWdClose === 0;
    });
    expect(emittedInvalidIntermediate).toBe(false);
  });

  it("setBookingDayHours rolls back both fields when the persist rejects", async () => {
    mockUpdateConfig.mockRejectedValueOnce(new Error("fail"));
    const store = makeStore();
    const before = { ...store.get().booking.hours };
    store.get().setBookingDayHours("wdOpen", "wdClose", 9, 18);
    await Promise.resolve();
    await Promise.resolve();
    expect(store.get().booking.hours).toEqual(before);
  });

  // --- buildBookingPayload ---------------------------------------------------

  it("buildBookingPayload produces the correct flat payload", () => {
    const booking = {
      services: [{ name: "Drain cleaning", lane: "flat" as const, price: 99, triggers: "clogged" }],
      notServices: "Septic",
      serviceFee: 89,
      feeCredited: true,
      hours: { wdOpen: 8, wdClose: 17,
 monOpen: 8, monClose: 17,
 tueOpen: 8, tueClose: 17,
 wedOpen: 8, wedClose: 17,
 thuOpen: 8, thuClose: 17,
 friOpen: 8, friClose: 17, satOpen: 0, satClose: 0, sunOpen: 0, sunClose: 0 },
      area: { cities: "Oakland", radiusMi: 25, originAddress: "200 Ray St, Pleasanton, CA" },
    };
    const payload = buildBookingPayload(booking);
    expect(payload.booking.services[0]?.name).toBe("Drain cleaning");
    expect(payload.booking.notServices).toBe("Septic");
    expect(payload.booking.serviceFee).toBe(89);
    expect(payload.hoursWdOpen).toBe(8);
    expect(payload.hoursWdClose).toBe(17);
    expect(payload.areaCities).toBe("Oakland");
    expect(payload.areaRadiusMi).toBe(25);
    expect(payload.serviceOriginAddress).toBe("200 Ray St, Pleasanton, CA");
  });

  it("buildBookingPayload maps a blank/whitespace origin address to null", () => {
    const booking = {
      services: [],
      notServices: "",
      serviceFee: 89,
      feeCredited: true,
      hours: { wdOpen: 8, wdClose: 17, monOpen: 8, monClose: 17, tueOpen: 8, tueClose: 17, wedOpen: 8, wedClose: 17, thuOpen: 8, thuClose: 17, friOpen: 8, friClose: 17, satOpen: 0, satClose: 0, sunOpen: 0, sunClose: 0 },
      area: { cities: "", radiusMi: 25, originAddress: "   " },
    };
    expect(buildBookingPayload(booking).serviceOriginAddress).toBeNull();
  });

  it("buildBookingPayload carries emergencyTriggers through per-service objects", () => {
    const booking = {
      services: [
        { name: "Drain cleaning", lane: "flat" as const, price: 99, triggers: "clogged", emergencyTriggers: "burst pipe, flooding" },
      ],
      notServices: "",
      serviceFee: 89,
      feeCredited: true,
      hours: { wdOpen: 8, wdClose: 17, monOpen: 8, monClose: 17, tueOpen: 8, tueClose: 17, wedOpen: 8, wedClose: 17, thuOpen: 8, thuClose: 17, friOpen: 8, friClose: 17, satOpen: 0, satClose: 0, sunOpen: 0, sunClose: 0 },
      area: { cities: "", radiusMi: 25, originAddress: "" },
    };
    const payload = buildBookingPayload(booking);
    expect(payload.booking.services[0]?.emergencyTriggers).toBe("burst pipe, flooding");
  });

  it("buildBookingPayload carries ballpark through per-service objects", () => {
    const booking = {
      services: [
        { name: "Water heater estimate", lane: "estimate" as const, triggers: "water heater, no hot water", ballpark: "$150–$300" },
      ],
      notServices: "",
      serviceFee: 89,
      feeCredited: true,
      hours: { wdOpen: 8, wdClose: 17, monOpen: 8, monClose: 17, tueOpen: 8, tueClose: 17, wedOpen: 8, wedClose: 17, thuOpen: 8, thuClose: 17, friOpen: 8, friClose: 17, satOpen: 0, satClose: 0, sunOpen: 0, sunClose: 0 },
      area: { cities: "", radiusMi: 25, originAddress: "" },
    };
    const payload = buildBookingPayload(booking);
    expect(payload.booking.services[0]?.ballpark).toBe("$150–$300");
  });

  it("buildBookingPayload carries ballpark as undefined when not set on a service", () => {
    const booking = {
      services: [
        { name: "Drain cleaning", lane: "flat" as const, price: 99, triggers: "clogged" },
      ],
      notServices: "",
      serviceFee: 89,
      feeCredited: true,
      hours: { wdOpen: 8, wdClose: 17, monOpen: 8, monClose: 17, tueOpen: 8, tueClose: 17, wedOpen: 8, wedClose: 17, thuOpen: 8, thuClose: 17, friOpen: 8, friClose: 17, satOpen: 0, satClose: 0, sunOpen: 0, sunClose: 0 },
      area: { cities: "", radiusMi: 25, originAddress: "" },
    };
    const payload = buildBookingPayload(booking);
    expect(payload.booking.services[0]?.ballpark).toBeUndefined();
  });

  it("buildBookingPayload carries deferKeywords at the cfg level", () => {
    const booking = {
      services: [],
      notServices: "",
      serviceFee: 89,
      feeCredited: true,
      deferKeywords: "insurance, claim, adjuster",
      hours: { wdOpen: 8, wdClose: 17, monOpen: 8, monClose: 17, tueOpen: 8, tueClose: 17, wedOpen: 8, wedClose: 17, thuOpen: 8, thuClose: 17, friOpen: 8, friClose: 17, satOpen: 0, satClose: 0, sunOpen: 0, sunClose: 0 },
      area: { cities: "", radiusMi: 25, originAddress: "" },
    };
    const payload = buildBookingPayload(booking);
    expect(payload.booking.deferKeywords).toBe("insurance, claim, adjuster");
  });

  it("buildBookingPayload passes deferKeywords as undefined when not set", () => {
    const booking = {
      services: [],
      notServices: "",
      serviceFee: 89,
      feeCredited: true,
      hours: { wdOpen: 8, wdClose: 17, monOpen: 8, monClose: 17, tueOpen: 8, tueClose: 17, wedOpen: 8, wedClose: 17, thuOpen: 8, thuClose: 17, friOpen: 8, friClose: 17, satOpen: 0, satClose: 0, sunOpen: 0, sunClose: 0 },
      area: { cities: "", radiusMi: 25, originAddress: "" },
    };
    const payload = buildBookingPayload(booking);
    expect(payload.booking.deferKeywords).toBeUndefined();
  });

  // --- misc config -----------------------------------------------------------

  /**
   * The trade decides whether the shop measures, so changing one changes both.
   *
   * measurementEstimating gates the job modal's Measurements section. It used to be a switch the
   * owner flipped by hand, in a card whose own copy read "a plumbing shop must never see it" — the
   * trade already answered that, and asking twice let the two disagree.
   */
  it("setTrade persists the trade AND whether that trade measures", async () => {
    const store = makeStore();
    store.get().setTrade("hvac");
    expect(store.get().trade).toBe("hvac");
    // HVAC prices per job, so the Measurements section stays hidden.
    expect(store.get().toggles.measurementEstimating).toBe(false);
    await Promise.resolve();
    expect(mockUpdateConfig).toHaveBeenCalledWith({ trade: "hvac", measurementEstimating: false });
  });

  it("switching to a measured trade turns measurement estimating on, unasked", async () => {
    const store = makeStore();
    store.get().setTrade("painting");
    expect(store.get().toggles.measurementEstimating).toBe(true);
    await Promise.resolve();
    expect(mockUpdateConfig).toHaveBeenCalledWith({ trade: "painting", measurementEstimating: true });
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

  it("measurementEstimating defaults off and setToggle maps it to the correct updateConfig field", async () => {
    const store = makeStore();
    expect(store.get().toggles.measurementEstimating).toBe(false);
    store.get().setToggle("measurementEstimating", true);
    expect(store.get().toggles.measurementEstimating).toBe(true);
    await Promise.resolve();
    expect(mockUpdateConfig).toHaveBeenCalledWith({ measurementEstimating: true });
  });

  // --- collections start empty -----------------------------------------------

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
