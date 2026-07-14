/**
 * lib/store/slices/settings-slice.ts
 * Editable workspace configuration for the Settings page — labor rates, terms
 * library, lead sources, the AI Front Desk booking playbook, parts markup,
 * trade, and permission toggles. The pricebook catalog itself (services +
 * categories) lives in pricebook-slice.ts (its own module, hydrator, and DTOs).
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

// Mirrors modules/settings/domain/settings-repository.ts LaborRateKind. Kept as a local
// literal union here so the store doesn't import a domain type (store shapes are their own
// contract, distinct from DTO and domain).
export type LaborRateKind = "hourly" | "flat_fee";

export interface LaborRate {
  id: string;
  name: string;
  rate: number; // dollars — per hour when kind is "hourly", a flat charge when "flat_fee"
  kind: LaborRateKind;
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

// Outcome of addSource so the UI can give feedback instead of silently swallowing a failure:
// "empty" (blank input), "duplicate" (matches a built-in or an existing custom source), or
// "failed" (the persist call errored — e.g. a transient connection blip).
export type AddSourceResult = { ok: true } | { ok: false; reason: "empty" | "duplicate" | "failed" };

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
  /** Address the service-area proximity is measured from. "" = unset. Geocoded server-side on save. */
  originAddress: string;
}

export interface BookingCfg {
  services: BookingService[];
  notServices: string;
  serviceFee: number; // dollars (not cents) — matches the server bookingCfgDTO
  feeCredited: boolean;
  hours: BookingHours;
  area: BookingArea;
}

export interface SettingsToggles {
  techSeesPrice: boolean;
  frontDesk: boolean;
}

// ---- pre-hydration placeholders (NOT a source of truth) --------------------
// SettingsHydrator (Task 8) calls setSettings() and overwrites these.
// Collections start empty; a fresh org gets server defaults on first v1.settings.get.

const EMPTY_LABOR_RATES: LaborRate[] = [];
const EMPTY_TERMS: TermItem[] = [];
const EMPTY_SOURCES: SourceItem[] = [];

const EMPTY_BOOKING: BookingCfg = {
  services: [],
  notServices: "",
  serviceFee: 89,
  feeCredited: true,
  hours: { wdOpen: 8, wdClose: 17, satOpen: 0, satClose: 0, sunOpen: 0, sunClose: 0 },
  area: { cities: "", radiusMi: 25, originAddress: "" },
};

const EMPTY_MARKUP = 35;
const EMPTY_TRADE = "plumbing";

const EMPTY_TOGGLES: SettingsToggles = {
  techSeesPrice: true,
  frontDesk: true,
};

// ---- helpers ---------------------------------------------------------------

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
  /** Address the origin is geocoded from; null clears it server-side. Empty input → null. */
  serviceOriginAddress: string | null;
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
    // Trim; an empty address becomes null so the server clears the origin (rather than storing "").
    serviceOriginAddress: b.area.originAddress.trim() || null,
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
  laborRates: LaborRate[];
  terms: TermItem[];
  sources: SourceItem[];
  booking: BookingCfg;
  markup: number;
  trade: string;
  toggles: SettingsToggles;

  /** Replace the whole slice — called by SettingsHydrator (Task 8). */
  setSettings: (snapshot: {
    laborRates: LaborRate[];
    terms: TermItem[];
    sources: SourceItem[];
    booking: BookingCfg;
    markup: number;
    trade: string;
    toggles: SettingsToggles;
  }) => void;

  // labor rates
  addLaborRate: (name: string, rate: number, kind?: LaborRateKind) => void;
  updateLaborRate: (id: string, field: "name" | "rate" | "kind", value: string) => void;
  removeLaborRate: (id: string) => void;

  // terms
  addTerm: (t: string, body: string) => void;
  removeTerm: (id: string) => void;

  // sources
  addSource: (name: string) => Promise<AddSourceResult>;
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
  setMarkup: (n: number) => void;
  setTrade: (t: string) => void;
  setToggle: (key: keyof SettingsToggles, value: boolean) => void;
}

// ---- slice -----------------------------------------------------------------

export const createSettingsSlice: StateCreator<SettingsSlice, [], [], SettingsSlice> = (
  set,
  get,
) => ({
  laborRates: EMPTY_LABOR_RATES,
  terms: EMPTY_TERMS,
  sources: EMPTY_SOURCES,
  booking: EMPTY_BOOKING,
  markup: EMPTY_MARKUP,
  trade: EMPTY_TRADE,
  toggles: EMPTY_TOGGLES,

  // ---- hydration ------------------------------------------------------------

  setSettings: (snapshot) => set({ ...snapshot }),

  // ---- labor rates ----------------------------------------------------------

  addLaborRate: (name, rate, kind = "hourly") => {
    const nm = name.trim();
    if (!nm) return;
    const r = Math.max(1, Math.round(Number.isFinite(rate) ? rate : 0)) || 170;
    const id = crypto.randomUUID();
    set((s) => ({ laborRates: [...s.laborRates, { id, name: nm, rate: r, kind }] }));
    void trpcVanilla.v1.settings.laborRates.create
      .mutate({ id, label: nm, rateCentsPerHour: r * 100, kind })
      .then((dto) => {
        set((s) => ({
          laborRates: s.laborRates.map((x) =>
            x.id === id
              ? { id: dto.id, name: dto.label, rate: Math.round(dto.rateCentsPerHour / 100), kind: dto.kind }
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
        if (field === "kind") return { ...lr, kind: value === "flat_fee" ? "flat_fee" : "hourly" };
        return { ...lr, name: value.trim() || lr.name };
      }),
    }));
    const next = get().laborRates.find((x) => x.id === id);
    if (!next) return;
    void trpcVanilla.v1.settings.laborRates.update
      .mutate({ id, label: next.name, rateCentsPerHour: next.rate * 100, kind: next.kind })
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

  addSource: async (name) => {
    const nm = name.trim();
    if (!nm) return { ok: false, reason: "empty" };
    // Dedupe case-insensitively — against BOTH the store's custom sources and the hardcoded
    // defaults; a persisted default duplicate would be an invisible row (the merged picker
    // already shows the default). Report it so the UI can say so instead of doing nothing.
    if (isDefaultSourceLabel(nm) || get().sources.some((x) => x.label.toLowerCase() === nm.toLowerCase())) {
      return { ok: false, reason: "duplicate" };
    }
    const id = crypto.randomUUID();
    set((s) => ({ sources: [...s.sources, { id, label: nm }] }));
    try {
      const dto = await trpcVanilla.v1.settings.sources.create.mutate({ id, label: nm });
      set((s) => ({
        sources: s.sources.map((x) => (x.id === id ? { id: dto.id, label: dto.label } : x)),
      }));
      return { ok: true };
    } catch (e) {
      // Roll back the optimistic row and surface the failure — never silently swallow it.
      set((s) => ({ sources: s.sources.filter((x) => x.id !== id) }));
      if (process.env.NODE_ENV !== "production") console.warn("[addSource] create failed", e);
      return { ok: false, reason: "failed" };
    }
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
    };
    const col = toggleToField[key];
    void trpcVanilla.v1.settings.updateConfig
      .mutate({ [col]: value })
      .catch(() => set(snapshot));
  },
});
