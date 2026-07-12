/**
 * lib/store/slices/settings-slice.ts
 * Editable workspace configuration for the Settings page — pricebook, labor
 * rates, terms library, lead sources, the AI Front Desk booking playbook,
 * visit durations, parts markup, trade, and permission toggles.
 *
 * All collections carry stable server-assigned string UUIDs.
 * All mutating actions follow the pattern:
 *   1. Apply local change optimistically (instant UI).
 *   2. Fire the matching trpcVanilla mutation.
 *   3. Reconcile the returned DTO (adopt server id / canonical values).
 *   4. On error, roll back to the pre-mutation snapshot.
 *
 * EMPTY_* values are pre-hydration placeholders — SettingsHydrator (Task 8)
 * overwrites them from v1.settings.get. They are NOT the source of truth;
 * collections start empty so the hydrator's server data is the only truth.
 */

import type { StateCreator } from "zustand";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { isDefaultSourceLabel } from "@/lib/store/default-sources";

// ---- shapes ----------------------------------------------------------------

export interface PbItem {
  id: string;
  label: string;
  unitPrice: number; // dollars in the store; convert to cents for the API
  cost: number;      // dollars in the store
}

export interface LaborRate {
  id: string;
  name: string;
  rate: number; // dollars/hour in the store
}

export interface TermItem {
  id: string;
  t: string;
  body: string;
}

export interface SourceItem {
  id: string;
  label: string;
}

export interface BookingService {
  name: string;
  lane: "repair" | "flat" | "estimate";
  price?: number;
  triggers: string;
}

export interface BookingHours {
  wdOpen: number;
  wdClose: number;
  satOpen: number;
  satClose: number;
  sunOpen: number;
  sunClose: number;
}

export interface BookingArea {
  cities: string;
  radiusMi: number;
}

export interface BookingCfg {
  services: BookingService[];
  notServices: string;
  serviceFee: number; // dollars (not cents) — matches the server bookingCfgDTO
  feeCredited: boolean;
  hours: BookingHours;
  area: BookingArea;
}

export interface VisitDur {
  scope: number;   // hours
  repair: number;  // hours
  install: number; // hours
}

export interface SettingsToggles {
  techSeesPrice: boolean;
  frontDesk: boolean;
  scopeOn: boolean;
}

// ---- pre-hydration placeholders (NOT a source of truth) --------------------
// SettingsHydrator (Task 8) calls setSettings() and overwrites these.
// Collections start empty; a fresh org gets server defaults on first v1.settings.get.

const EMPTY_PRICEBOOK: PbItem[] = [];
const EMPTY_LABOR_RATES: LaborRate[] = [];
const EMPTY_TERMS: TermItem[] = [];
const EMPTY_SOURCES: SourceItem[] = [];

const EMPTY_BOOKING: BookingCfg = {
  services: [],
  notServices: "",
  serviceFee: 89,
  feeCredited: true,
  hours: { wdOpen: 8, wdClose: 17, satOpen: 0, satClose: 0, sunOpen: 0, sunClose: 0 },
  area: { cities: "", radiusMi: 25 },
};

const EMPTY_VISIT_DUR: VisitDur = { scope: 0.5, repair: 1.5, install: 4 };
const EMPTY_MARKUP = 35;
const EMPTY_TRADE = "plumbing";

const EMPTY_TOGGLES: SettingsToggles = {
  techSeesPrice: true,
  frontDesk: true,
  scopeOn: false,
};

// ---- helpers ---------------------------------------------------------------

function clampInt(v: number, min: number): number {
  return Math.max(min, Math.round(Number.isFinite(v) ? v : 0));
}

// Internal types for the set/get callbacks used by persistBooking.
type SetFn = (
  partial: Partial<SettingsSlice> | ((s: SettingsSlice) => Partial<SettingsSlice>),
) => void;
type GetFn = () => SettingsSlice;

/**
 * The flat payload shape expected by trpcVanilla.v1.settings.updateConfig for
 * the AI Front Desk booking config.
 *
 * The store keeps hours + area nested inside BookingCfg for co-location, but
 * the server splits them: services/notServices/serviceFee/feeCredited go into
 * the `booking` jsonb column; hours/area are individual scalar columns. One
 * updateConfig call carries both halves.
 */
export interface BookingPayload {
  booking: {
    services: BookingService[];
    notServices: string;
    serviceFee: number;
    feeCredited: boolean;
  };
  hoursWdOpen: number;
  hoursWdClose: number;
  hoursSatOpen: number;
  hoursSatClose: number;
  hoursSunOpen: number;
  hoursSunClose: number;
  areaCities: string;
  areaRadiusMi: number;
}

/**
 * Pure helper — converts a store BookingCfg into the flat updateConfig payload.
 * Exported so unit tests can verify the mapping without invoking the store.
 * Mirrors buildLeadUpdatePayload in leads-slice.ts.
 */
export function buildBookingPayload(b: BookingCfg): BookingPayload {
  return {
    booking: {
      services: b.services,
      notServices: b.notServices,
      serviceFee: b.serviceFee,
      feeCredited: b.feeCredited,
    },
    hoursWdOpen: b.hours.wdOpen,
    hoursWdClose: b.hours.wdClose,
    hoursSatOpen: b.hours.satOpen,
    hoursSatClose: b.hours.satClose,
    hoursSunOpen: b.hours.sunOpen,
    hoursSunClose: b.hours.sunClose,
    areaCities: b.area.cities,
    areaRadiusMi: b.area.radiusMi,
  };
}

/**
 * Persist the AI Front Desk booking config.
 * Rolls back to `snapshot` if the mutation rejects.
 */
function persistBooking(get: GetFn, set: SetFn, snapshot: BookingCfg): void {
  const payload = buildBookingPayload(get().booking);
  void trpcVanilla.v1.settings.updateConfig
    .mutate(payload)
    .catch(() => set({ booking: snapshot }));
}

// ---- slice interface -------------------------------------------------------

export interface SettingsSlice {
  pricebook: PbItem[];
  laborRates: LaborRate[];
  terms: TermItem[];
  sources: SourceItem[];
  booking: BookingCfg;
  visitDur: VisitDur;
  markup: number;
  trade: string;
  toggles: SettingsToggles;

  /** Replace the whole slice — called by SettingsHydrator (Task 8). */
  setSettings: (snapshot: {
    pricebook: PbItem[];
    laborRates: LaborRate[];
    terms: TermItem[];
    sources: SourceItem[];
    booking: BookingCfg;
    visitDur: VisitDur;
    markup: number;
    trade: string;
    toggles: SettingsToggles;
  }) => void;

  // pricebook
  addPricebookItem: (label: string, unitPrice: number, cost: number) => void;
  updatePricebookItem: (id: string, field: "label" | "unitPrice" | "cost", value: string) => void;
  removePricebookItem: (id: string) => void;

  // labor rates
  addLaborRate: (name: string, rate: number) => void;
  updateLaborRate: (id: string, field: "name" | "rate", value: string) => void;
  removeLaborRate: (id: string) => void;

  // terms
  addTerm: (t: string, body: string) => void;
  removeTerm: (id: string) => void;

  // sources
  addSource: (name: string) => void;
  removeSource: (id: string) => void;

  // booking
  updateBookingService: (index: number, field: keyof BookingService, value: string) => void;
  addBookingService: (name: string) => void;
  removeBookingService: (index: number) => void;
  setServiceFee: (n: number) => void;
  setFeeCredited: (b: boolean) => void;
  setBookingField: (field: "notServices", value: string) => void;
  setBookingHours: (key: keyof BookingHours, value: number) => void;
  setBookingArea: (field: keyof BookingArea, value: string) => void;

  // misc config
  setVisitDur: (key: keyof VisitDur, minutes: number) => void;
  setMarkup: (n: number) => void;
  setTrade: (t: string) => void;
  setToggle: (key: keyof SettingsToggles, value: boolean) => void;
}

// ---- slice -----------------------------------------------------------------

export const createSettingsSlice: StateCreator<SettingsSlice, [], [], SettingsSlice> = (
  set,
  get,
) => ({
  pricebook: EMPTY_PRICEBOOK,
  laborRates: EMPTY_LABOR_RATES,
  terms: EMPTY_TERMS,
  sources: EMPTY_SOURCES,
  booking: EMPTY_BOOKING,
  visitDur: EMPTY_VISIT_DUR,
  markup: EMPTY_MARKUP,
  trade: EMPTY_TRADE,
  toggles: EMPTY_TOGGLES,

  // ---- hydration ------------------------------------------------------------

  setSettings: (snapshot) => set({ ...snapshot }),

  // ---- pricebook ------------------------------------------------------------

  addPricebookItem: (label, unitPrice, cost) => {
    const desc = label.trim();
    if (!desc) return;
    const c = Math.max(0, Math.round(Number.isFinite(cost) ? cost : 0));
    let r = Math.max(0, Math.round(Number.isFinite(unitPrice) ? unitPrice : 0));
    // Dedupe by label (case-insensitive), matching prototype behaviour.
    if (get().pricebook.some((p) => p.label.trim().toLowerCase() === desc.toLowerCase())) return;
    // No price typed → derive from cost + current markup.
    if (!r && c) r = Math.round(c * (1 + (get().markup || 0) / 100));
    const id = crypto.randomUUID();
    const item: PbItem = { id, label: desc, unitPrice: r, cost: c };
    set((s) => ({ pricebook: [...s.pricebook, item] }));
    void trpcVanilla.v1.settings.pricebook.create
      .mutate({ id, label: desc, unitPriceCents: r * 100, costCents: c * 100 })
      .then((dto) => {
        // Reconcile: adopt the server id (and any normalised values).
        set((s) => ({
          pricebook: s.pricebook.map((p) =>
            p.id === id
              ? {
                  ...p,
                  id: dto.id,
                  label: dto.label,
                  unitPrice: Math.round(dto.unitPriceCents / 100),
                  cost: Math.round(dto.costCents / 100),
                }
              : p,
          ),
        }));
      })
      .catch(() => {
        set((s) => ({ pricebook: s.pricebook.filter((p) => p.id !== id) }));
      });
  },

  updatePricebookItem: (id, field, value) => {
    const snapshot = get().pricebook;
    set((s) => ({
      pricebook: s.pricebook.map((p) => {
        if (p.id !== id) return p;
        if (field === "label") return { ...p, label: value };
        return { ...p, [field]: Math.max(0, Math.round(Number(value) || 0)) };
      }),
    }));
    const next = get().pricebook.find((p) => p.id === id);
    if (!next) return;
    void trpcVanilla.v1.settings.pricebook.update
      .mutate({ id, label: next.label, unitPriceCents: next.unitPrice * 100, costCents: next.cost * 100 })
      .catch(() => set({ pricebook: snapshot }));
  },

  removePricebookItem: (id) => {
    const snapshot = get().pricebook;
    set((s) => ({ pricebook: s.pricebook.filter((p) => p.id !== id) }));
    void trpcVanilla.v1.settings.pricebook.remove.mutate({ id }).catch(() => set({ pricebook: snapshot }));
  },

  // ---- labor rates ----------------------------------------------------------

  addLaborRate: (name, rate) => {
    const nm = name.trim();
    if (!nm) return;
    const r = Math.max(1, Math.round(Number.isFinite(rate) ? rate : 0)) || 170;
    const id = crypto.randomUUID();
    set((s) => ({ laborRates: [...s.laborRates, { id, name: nm, rate: r }] }));
    void trpcVanilla.v1.settings.laborRates.create
      .mutate({ id, label: nm, rateCentsPerHour: r * 100 })
      .then((dto) => {
        set((s) => ({
          laborRates: s.laborRates.map((x) =>
            x.id === id
              ? { id: dto.id, name: dto.label, rate: Math.round(dto.rateCentsPerHour / 100) }
              : x,
          ),
        }));
      })
      .catch(() => {
        set((s) => ({ laborRates: s.laborRates.filter((x) => x.id !== id) }));
      });
  },

  updateLaborRate: (id, field, value) => {
    const snapshot = get().laborRates;
    set((s) => ({
      laborRates: s.laborRates.map((lr) => {
        if (lr.id !== id) return lr;
        if (field === "rate") return { ...lr, rate: Math.max(1, Number(value) || lr.rate) };
        return { ...lr, name: value.trim() || lr.name };
      }),
    }));
    const next = get().laborRates.find((x) => x.id === id);
    if (!next) return;
    void trpcVanilla.v1.settings.laborRates.update
      .mutate({ id, label: next.name, rateCentsPerHour: next.rate * 100 })
      .catch(() => set({ laborRates: snapshot }));
  },

  removeLaborRate: (id) => {
    // Keep at least one labor rate — client guard mirrors the server invariant.
    if (get().laborRates.length <= 1) return;
    const snapshot = get().laborRates;
    set((s) => ({ laborRates: s.laborRates.filter((lr) => lr.id !== id) }));
    void trpcVanilla.v1.settings.laborRates.remove.mutate({ id }).catch(() => set({ laborRates: snapshot }));
  },

  // ---- terms ----------------------------------------------------------------

  addTerm: (t, body) => {
    const name = t.trim();
    const text = body.trim();
    if (!name || !text) return;
    const id = crypto.randomUUID();
    set((s) => ({ terms: [...s.terms, { id, t: name, body: text }] }));
    void trpcVanilla.v1.settings.terms.create
      .mutate({ id, title: name, body: text })
      .then((dto) => {
        set((s) => ({
          terms: s.terms.map((x) =>
            x.id === id ? { id: dto.id, t: dto.title, body: dto.body } : x,
          ),
        }));
      })
      .catch(() => {
        set((s) => ({ terms: s.terms.filter((x) => x.id !== id) }));
      });
  },

  removeTerm: (id) => {
    const snapshot = get().terms;
    set((s) => ({ terms: s.terms.filter((x) => x.id !== id) }));
    void trpcVanilla.v1.settings.terms.remove.mutate({ id }).catch(() => set({ terms: snapshot }));
  },

  // ---- sources --------------------------------------------------------------

  addSource: (name) => {
    const nm = name.trim();
    if (!nm) return;
    // Dedupe case-insensitively before persisting — against BOTH the store's
    // custom sources and the hardcoded defaults; a persisted default duplicate
    // would be an invisible row (the merged picker already shows the default).
    if (isDefaultSourceLabel(nm)) return;
    if (get().sources.some((x) => x.label.toLowerCase() === nm.toLowerCase())) return;
    const id = crypto.randomUUID();
    set((s) => ({ sources: [...s.sources, { id, label: nm }] }));
    void trpcVanilla.v1.settings.sources.create
      .mutate({ id, label: nm })
      .then((dto) => {
        set((s) => ({
          sources: s.sources.map((x) =>
            x.id === id ? { id: dto.id, label: dto.label } : x,
          ),
        }));
      })
      .catch(() => {
        set((s) => ({ sources: s.sources.filter((x) => x.id !== id) }));
      });
  },

  removeSource: (id) => {
    const snapshot = get().sources;
    set((s) => ({ sources: s.sources.filter((x) => x.id !== id) }));
    void trpcVanilla.v1.settings.sources.remove.mutate({ id }).catch(() => set({ sources: snapshot }));
  },

  // ---- booking (full blob persisted via updateConfig on every edit) ----------
  // The store keeps hours + area nested under booking; the server splits them.
  // Every booking action snapshots before mutation and rolls back on failure.

  updateBookingService: (index, field, value) => {
    const snapshot = get().booking;
    set((s) => ({
      booking: {
        ...s.booking,
        services: s.booking.services.map((svc, i) => {
          if (i !== index) return svc;
          if (field === "price") return { ...svc, price: Math.max(0, Number(value) || 0) };
          return { ...svc, [field]: value };
        }),
      },
    }));
    persistBooking(get, set, snapshot);
  },

  addBookingService: (name) => {
    const nm = name.trim();
    if (!nm) return;
    const snapshot = get().booking;
    set((s) => ({
      booking: {
        ...s.booking,
        services: [...s.booking.services, { name: nm, lane: "repair", triggers: "" }],
      },
    }));
    persistBooking(get, set, snapshot);
  },

  removeBookingService: (index) => {
    const snapshot = get().booking;
    set((s) => ({
      booking: { ...s.booking, services: s.booking.services.filter((_, i) => i !== index) },
    }));
    persistBooking(get, set, snapshot);
  },

  setServiceFee: (n) => {
    const snapshot = get().booking;
    set((s) => ({ booking: { ...s.booking, serviceFee: Math.max(0, Number(n) || 0) } }));
    persistBooking(get, set, snapshot);
  },

  setFeeCredited: (b) => {
    const snapshot = get().booking;
    set((s) => ({ booking: { ...s.booking, feeCredited: b } }));
    persistBooking(get, set, snapshot);
  },

  setBookingField: (field, value) => {
    const snapshot = get().booking;
    set((s) => ({ booking: { ...s.booking, [field]: value } }));
    persistBooking(get, set, snapshot);
  },

  setBookingHours: (key, value) => {
    const snapshot = get().booking;
    set((s) => ({
      booking: {
        ...s.booking,
        hours: { ...s.booking.hours, [key]: Math.max(0, Number(value) || 0) },
      },
    }));
    persistBooking(get, set, snapshot);
  },

  setBookingArea: (field, value) => {
    const snapshot = get().booking;
    set((s) => ({
      booking: {
        ...s.booking,
        area: {
          ...s.booking.area,
          [field]: field === "radiusMi" ? Math.max(0, Number(value) || 0) : value,
        },
      },
    }));
    persistBooking(get, set, snapshot);
  },

  // ---- misc config (scalars → updateConfig) ----------------------------------

  setVisitDur: (key, minutes) => {
    const snapshot = { visitDur: get().visitDur };
    const hours = clampInt(minutes, 15) / 60;
    set((s) => ({ visitDur: { ...s.visitDur, [key]: hours } }));
    const col =
      key === "scope"
        ? "visitScopeMinutes"
        : key === "repair"
        ? "visitRepairMinutes"
        : "visitInstallMinutes";
    void trpcVanilla.v1.settings.updateConfig
      .mutate({ [col]: Math.round(hours * 60) })
      .catch(() => set(snapshot));
  },

  setMarkup: (n) => {
    const snapshot = { markup: get().markup };
    const markup = Math.max(0, Number(n) || 0);
    set({ markup });
    void trpcVanilla.v1.settings.updateConfig
      .mutate({ markupBps: Math.round(markup * 100) })
      .catch(() => set(snapshot));
  },

  setTrade: (t) => {
    const snapshot = { trade: get().trade };
    set({ trade: t });
    void trpcVanilla.v1.settings.updateConfig.mutate({ trade: t }).catch(() => set(snapshot));
  },

  setToggle: (key, value) => {
    const snapshot = { toggles: get().toggles };
    set((s) => ({ toggles: { ...s.toggles, [key]: value } }));
    // Explicit mapping: each toggle key → updateConfig field name (type-checked at compile time).
    const toggleToField: Record<keyof SettingsToggles, string> = {
      techSeesPrice: "techSeesPrice",
      frontDesk: "frontDesk",
      scopeOn: "scopeOn",
    };
    const col = toggleToField[key];
    void trpcVanilla.v1.settings.updateConfig
      .mutate({ [col]: value })
      .catch(() => set(snapshot));
  },
});
