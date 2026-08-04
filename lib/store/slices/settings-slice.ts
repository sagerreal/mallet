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
import { reportWriteError } from "../write-error";
import { tradeMeasures } from "@/app/(office)/settings/pricebooks";
import type { TradeKey } from "@/app/(office)/settings/trade-playbooks";
import type { MeasurementGate } from "@/lib/measurement-gate";

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
  lane: "flat" | "estimate";
  /** Estimate lane only: the org's visit fee applies and the tech prices it on site — the old
   *  "service call". Absent/false = free estimate, quoted after the visit. */
  feeApplies?: boolean;
  price?: number;
  /** Link to a pricebook entry — the phone speaks THAT entry's current price (server-resolved).
   * null/absent = unlinked, `price` above is spoken as before. */
  pricebookServiceId?: string | null;
  triggers: string;
  emergencyTriggers?: string;
  ballpark?: string;
  requiredCerts?: string[];
}

export interface BookingHours {
  /** Retained for a release so a rollback reads real hours. Nothing derives availability from it. */
  wdOpen: number;
  wdClose: number;
  monOpen: number;
  monClose: number;
  tueOpen: number;
  tueClose: number;
  wedOpen: number;
  wedClose: number;
  thuOpen: number;
  thuClose: number;
  friOpen: number;
  friClose: number;
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
  deferKeywords?: string;
  /** E.164; ""/absent = live emergency transfer off (falls back to urgent callback). */
  emergencyTransferNumber?: string;
  hours: BookingHours;
  area: BookingArea;
}

export interface SettingsToggles {
  techSeesPrice: boolean;
  frontDesk: boolean;
  /** Money's "Auto-remind" switch. It was useState(true) in that header — a control promising
   *  reminder texts on a schedule and wired to nothing at all. */
  autoRemind: boolean;
  /**
   * Org-level gate for the measurement surfaces (the composer's Measure card, the field Quote
   * tab's "Scan a room" row, the pricebook editor's measured "Priced by" options).
   *
   * TRI-STATE, not a boolean: `"unknown"` means no settings snapshot has arrived, which is a
   * different fact from `"off"` and must not fail the same way. See lib/measurement-gate.ts —
   * readers go through `measurementSurfacesVisible` (fails OPEN) or `measurementConfirmed`
   * (fails CLOSED) rather than testing this field for truthiness.
   */
  measurementEstimating: MeasurementGate;
}

/**
 * The toggles that really are booleans — i.e. everything `setToggle` may write.
 * `measurementEstimating` is excluded BY TYPE: its only writers are the settings hydrators
 * (server truth) and `setTrade` (which may grant it, never revoke it), so no surface can flip
 * it to a bare `false` by hand. There is no UI switch for it — the trade answers it.
 */
export type BooleanToggleKey = Exclude<keyof SettingsToggles, "measurementEstimating">;

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
  hours: {
    wdOpen: 8, wdClose: 17,
    monOpen: 8, monClose: 17,
    tueOpen: 8, tueClose: 17,
    wedOpen: 8, wedClose: 17,
    thuOpen: 8, thuClose: 17,
    friOpen: 8, friClose: 17,
    satOpen: 0, satClose: 0, sunOpen: 0, sunClose: 0,
  },
  area: { cities: "", radiusMi: 25, originAddress: "" },
};

const EMPTY_MARKUP = 35;
const EMPTY_TRADE = "plumbing";

const EMPTY_TOGGLES: SettingsToggles = {
  techSeesPrice: true,
  frontDesk: true,
  autoRemind: true,
  // "unknown", NOT false. This placeholder used to be `false`, which made a settings read that
  // had not happened yet — or had failed — indistinguishable from a shop that does not measure,
  // and every reader hid the scanner. See lib/measurement-gate.ts.
  measurementEstimating: "unknown",
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
    deferKeywords?: string;
    emergencyTransferNumber?: string;
  };
  hoursWdOpen: number;
  hoursWdClose: number;
  hoursMonOpen: number;
  hoursMonClose: number;
  hoursTueOpen: number;
  hoursTueClose: number;
  hoursWedOpen: number;
  hoursWedClose: number;
  hoursThuOpen: number;
  hoursThuClose: number;
  hoursFriOpen: number;
  hoursFriClose: number;
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
      deferKeywords: b.deferKeywords,
      emergencyTransferNumber: b.emergencyTransferNumber,
    },
    hoursWdOpen: b.hours.wdOpen,
    hoursWdClose: b.hours.wdClose,
    hoursMonOpen: b.hours.monOpen,
    hoursMonClose: b.hours.monClose,
    hoursTueOpen: b.hours.tueOpen,
    hoursTueClose: b.hours.tueClose,
    hoursWedOpen: b.hours.wedOpen,
    hoursWedClose: b.hours.wedClose,
    hoursThuOpen: b.hours.thuOpen,
    hoursThuClose: b.hours.thuClose,
    hoursFriOpen: b.hours.friOpen,
    hoursFriClose: b.hours.friClose,
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
    .catch((err: unknown) => { set({ booking: snapshot }); reportWriteError("write", err); });
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
  updateBookingService: (index: number, field: keyof BookingService, value: string | string[] | boolean) => void;
  addBookingService: (name: string, feeApplies?: boolean) => void;
  // Append a starter-playbook batch (deduped case-insensitively by name against existing
  // services) and persist ONCE. Used by trade onboarding — never replaces owner services.
  seedBookingServices: (services: BookingService[]) => void;
  removeBookingService: (index: number) => void;
  setServiceFee: (n: number) => void;
  setFeeCredited: (b: boolean) => void;
  setBookingField: (field: "notServices" | "deferKeywords" | "emergencyTransferNumber", value: string) => void;
  setBookingHours: (key: keyof BookingHours, value: number) => void;
  /**
   * Set a single day's open AND close in ONE persisted write. The Closed↔Open toggle (and any
   * open change that must bump close to stay forward) route through this so the store never
   * round-trips through an invalid intermediate — open set while close is still the closed
   * sentinel 0. Two separate persists could otherwise strand {open:8, close:0} on an out-of-order
   * or dropped response, which the voice availability math reads as a closed day and silently sends
   * every caller to voicemail. The domain now rejects that intermediate, so it must never ship.
   */
  setBookingDayHours: (
    openKey: keyof BookingHours,
    closeKey: keyof BookingHours,
    open: number,
    close: number,
  ) => void;
  setBookingArea: (field: keyof BookingArea, value: string) => void;

  // misc config
  setMarkup: (n: number) => void;
  /** Takes a trade KEY (`TradeKey`), never a display label — see the note on `setTrade`. */
  setTrade: (t: TradeKey) => void;
  setToggle: (key: BooleanToggleKey, value: boolean) => void;
  /**
   * Store-only write of the measurement gate from a settings read. Used by
   * FieldTogglesHydrator, which reads `v1.settings.fieldToggles` for technicians (the office
   * SettingsHydrator's `setSettings` covers owner/office). Persists nothing — it is a read
   * landing, not an edit.
   */
  setMeasurementGate: (gate: MeasurementGate) => void;
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
      .catch((err: unknown) => { set({ laborRates: snapshot }); reportWriteError("updateLaborRate", err); });
  },

  removeLaborRate: (id) => {
    // Keep at least one labor rate — client guard mirrors the server invariant.
    if (get().laborRates.length <= 1) return;
    const snapshot = get().laborRates;
    set((s) => ({ laborRates: s.laborRates.filter((lr) => lr.id !== id) }));
    void trpcVanilla.v1.settings.laborRates.remove.mutate({ id }).catch((err: unknown) => { set({ laborRates: snapshot }); reportWriteError("removeLaborRate", err); });
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
    void trpcVanilla.v1.settings.terms.remove.mutate({ id }).catch((err: unknown) => { set({ terms: snapshot }); reportWriteError("removeTerm", err); });
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
      reportWriteError("addSource", e);
      return { ok: false, reason: "failed" };
    }
  },

  removeSource: (id) => {
    const snapshot = get().sources;
    set((s) => ({ sources: s.sources.filter((x) => x.id !== id) }));
    void trpcVanilla.v1.settings.sources.remove.mutate({ id }).catch((err: unknown) => { set({ sources: snapshot }); reportWriteError("removeSource", err); });
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
          // Leaving the estimate lane clears the fee flag: a flat service carrying feeApplies is
          // a dormant misread for any reader that forgets to gate on lane first.
          if (field === "lane") {
            const lane = value as BookingService["lane"];
            return lane === "estimate" ? { ...svc, lane } : { ...svc, lane, feeApplies: undefined };
          }
          // false → undefined keeps untouched services clean in the blob (requiredCerts pattern).
          if (field === "feeApplies") return { ...svc, feeApplies: value === true ? true : undefined };
          // "" = unlink (undefined keeps the blob clean, matching requiredCerts below).
          if (field === "pricebookServiceId") return { ...svc, pricebookServiceId: value === "" ? undefined : (value as string) };
          if (field === "requiredCerts") {
            const certs = Array.isArray(value) ? value : [];
            // Empty array → undefined so untouched services stay clean in the blob.
            return { ...svc, requiredCerts: certs.length > 0 ? certs : undefined };
          }
          return { ...svc, [field]: value };
        }),
      },
    }));
    persistBooking(get, set, snapshot);
  },

  addBookingService: (name, feeApplies = true) => {
    const nm = name.trim();
    if (!nm) return;
    const snapshot = get().booking;
    set((s) => ({
      booking: {
        ...s.booking,
        services: [...s.booking.services, { name: nm, lane: "estimate", ...(feeApplies ? { feeApplies: true } : {}), triggers: "" }],
      },
    }));
    persistBooking(get, set, snapshot);
  },

  seedBookingServices: (services) => {
    const existing = new Set(get().booking.services.map((x) => x.name.trim().toLowerCase()));
    const fresh = services.filter((x) => !existing.has(x.name.trim().toLowerCase()));
    if (fresh.length === 0) return;
    const snapshot = get().booking;
    set((s) => ({
      booking: { ...s.booking, services: [...s.booking.services, ...fresh] },
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

  setBookingDayHours: (openKey, closeKey, open, close) => {
    const snapshot = get().booking;
    set((s) => ({
      booking: {
        ...s.booking,
        hours: {
          ...s.booking.hours,
          [openKey]: Math.max(0, Number(open) || 0),
          [closeKey]: Math.max(0, Number(close) || 0),
        },
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
      .catch((err: unknown) => { set(snapshot); reportWriteError("setMarkup", err); });
  },

  /**
   * Set the shop's trade. The trade may GRANT measurement estimating; it never revokes it.
   *
   * `t` is a `TradeKey`, and that type is the fix for a real customer bug. This action resolves
   * `tradeMeasures(t)`, which matches the lowercase pricebook key — so when the Front Desk's
   * "Starter playbook" button passed a LABEL ("Plumbing", "Concrete & flatwork"), nothing
   * matched, `measures` came back false, and `measurement_estimating: false` was written to the
   * database. One tap on a button that is always on screen permanently removed the composer's
   * Measure card, the field Quote tab's "Scan a room" row and the room card's Re-scan — for the
   * whole shop, with no reason shown anywhere.
   *
   * WHY GRANT-ONLY, AND NOT "DERIVE BOTH WAYS". Owen's rule stands: the industry decides whether
   * a shop measures and the shop should not be asked. But a derivation that can also switch the
   * capability OFF is a silent destructive write triggered by an unrelated control, and it left
   * the app's own state self-contradictory — the App Review demo org is `trade: "plumbing"` with
   * `measurementEstimating: true` (the scanner is the whole answer to guideline 4.2), and
   * `tradeMeasures("plumbing")` is false BY DESIGN, so any re-derivation switched the scanner off
   * behind the reviewer. Monotone resolves that contradiction without lying about either fact:
   *   - plumbing → painting turns measuring ON, which is the case the old comment was written for;
   *   - painting → plumbing leaves it on. A Measure card a shop ignores costs one card. Deleting
   *     a shop's measured rooms and their only native capability costs the product.
   * `false` is now written by exactly one path — org creation, where it is a default, not a
   * revocation (modules/identity/api/identity-router.ts).
   */
  setTrade: (t) => {
    const snapshot = { trade: get().trade, toggles: get().toggles };
    const grantsMeasuring = tradeMeasures(t);
    set((s) => ({
      trade: t,
      toggles: grantsMeasuring ? { ...s.toggles, measurementEstimating: "on" } : s.toggles,
    }));
    void trpcVanilla.v1.settings.updateConfig
      .mutate(grantsMeasuring ? { trade: t, measurementEstimating: true } : { trade: t })
      .catch((err: unknown) => { set(snapshot); reportWriteError("setTrade", err); });
  },

  setToggle: (key, value) => {
    const snapshot = { toggles: get().toggles };
    set((s) => ({ toggles: { ...s.toggles, [key]: value } }));
    // Explicit mapping: each toggle key → updateConfig field name (type-checked at compile time).
    // measurementEstimating is absent by type (BooleanToggleKey) — it is not a hand switch.
    const toggleToField: Record<BooleanToggleKey, string> = {
      techSeesPrice: "techSeesPrice",
      frontDesk: "frontDesk",
      autoRemind: "autoRemind",
    };
    const col = toggleToField[key];
    void trpcVanilla.v1.settings.updateConfig
      .mutate({ [col]: value })
      .catch((err: unknown) => { set(snapshot); reportWriteError("setToggle", err); });
  },

  setMeasurementGate: (gate) => {
    set((s) => ({ toggles: { ...s.toggles, measurementEstimating: gate } }));
  },
});
