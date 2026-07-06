/**
 * lib/store/slices/settings-slice.ts
 * Editable workspace configuration for the Settings page — pricebook, labor
 * rates, terms library, lead sources, the AI Front Desk booking playbook,
 * visit durations, parts markup, trade, and permission toggles.
 *
 * Seed values are lifted verbatim from the prototype's `state` (mirrored in
 * the Settings page's former module consts). All updates are immutable
 * (spread patterns only); numeric fields are clamped to match the prototype's
 * setters (setPbField, bkSet, setVisitDur, etc.).
 */

import type { StateCreator } from "zustand";
import { SAMPLE_LEADS } from "@/lib/prototype-sample";

// ---- shapes ----------------------------------------------------------------

export interface PbItem {
  d: string;
  r: number;
  h: number;
  c: number;
}

export interface LaborRate {
  id: number;
  name: string;
  rate: number;
}

export interface TermItem {
  t: string;
  body: string;
}

export interface BookingService {
  name: string;
  lane: string;
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
  serviceFee: number;
  feeCredited: boolean;
  hours: BookingHours;
  area: BookingArea;
}

export interface VisitDur {
  scope: number;
  repair: number;
  install: number;
}

export interface SettingsToggles {
  techSeesPrice: boolean;
  techTexts: boolean;
  frontDesk: boolean;
  scopeOn: boolean;
}

// ---- seed data (verbatim from prototype state / former page consts) --------

const SEED_PRICEBOOK: PbItem[] = [
  { d: "40-gal gas water heater (Rheem Performance)", r: 1650, h: 1, c: 1150 },
  { d: "Remove & haul away existing unit", r: 150, h: 0.5, c: 0 },
  { d: "Expansion tank + seismic straps (code)", r: 385, h: 1, c: 160 },
  { d: "Hydro-jet kitchen drain line", r: 450, h: 1.5, c: 40 },
  { d: "Camera inspection w/ locate", r: 285, h: 1, c: 0 },
  { d: "Toilet — Toto Drake, supplied & installed", r: 460, h: 1.5, c: 260 },
  { d: "City permit", r: 110, h: 0, c: 110 },
];

const SEED_LABOR_RATES: LaborRate[] = [
  { id: 1, name: "Standard", rate: 170 },
  { id: 2, name: "After-hours / emergency", rate: 255 },
];

const SEED_TERMS: TermItem[] = [
  { t: "Workmanship warranty", body: "All labor guaranteed for 12 months. Manufacturer warranties apply to parts." },
  { t: "Water heater install terms", body: "Price includes haul-away and code compliance. Permit fees billed at cost." },
];

const SEED_BOOKING: BookingCfg = {
  services: [
    { name: "Water heater repair",          lane: "repair",   triggers: "leaking, no hot water, pilot out, rusty water, water heater not working" },
    { name: "Water heater replacement",     lane: "estimate", triggers: "replace water heater, new water heater, tankless install, old one died" },
    { name: "AC / heating repair",          lane: "repair",   triggers: "not cooling, warm air, no heat, ac stopped, furnace, no power" },
    { name: "AC / system replacement",      lane: "estimate", triggers: "replace my whole, new system, replace my ac, new ac unit" },
    { name: "Drain cleaning",               lane: "flat",     price: 99,  triggers: "drain cleaning, clogged, slow drain, backed up, snake" },
    { name: "Sewer camera inspection",      lane: "flat",     price: 285, triggers: "sewer camera, camera inspection, locate the line" },
    { name: "Leak detection & repair",      lane: "repair",   triggers: "leak, dripping, water damage" },
    { name: "Toilet & fixture install",     lane: "repair",   triggers: "running toilet, leaking toilet, wont flush, faucet" },
    { name: "Whole-house repipe / re-pipe", lane: "estimate", triggers: "repipe, re-pipe, galvanized, whole house repipe, low pressure everywhere, old pipes" },
  ],
  notServices: "New construction · septic · well pumps",
  serviceFee: 89,
  feeCredited: true,
  hours: { wdOpen: 8, wdClose: 17, satOpen: 0, satClose: 0, sunOpen: 0, sunClose: 0 },
  area: { cities: "Pleasanton, Dublin, Livermore, San Ramon", radiusMi: 25 },
};

const SEED_VISIT_DUR: VisitDur = { scope: 0.5, repair: 1.5, install: 4 };
const SEED_MARKUP = 35;
const SEED_TRADE = "plumbing";

// Sources derived from leads (prototype: state.sources = [...new Set(state.leads.map...)])
const SEED_SOURCES: string[] = [
  ...new Set(SAMPLE_LEADS.map((l) => l.source).filter((s): s is string => Boolean(s))),
];

const SEED_TOGGLES: SettingsToggles = {
  techSeesPrice: true, // "Techs can see job prices" defaults on in the prototype
  techTexts: true, // "Techs can text customers" defaults on
  frontDesk: true, // the sample shop runs with the Front Desk ON (home Handoff story)
  scopeOn: false, // Visit checks start off
};

// Labor-rate ids continue past the seed (prototype pulls from state.nextId).
let _nextLaborId = 1000;

// ---- helpers ---------------------------------------------------------------

function clampInt(v: number, min: number): number {
  return Math.max(min, Math.round(Number.isFinite(v) ? v : 0));
}

// ---- slice -----------------------------------------------------------------

export interface SettingsSlice {
  pricebook: PbItem[];
  laborRates: LaborRate[];
  terms: TermItem[];
  sources: string[];
  booking: BookingCfg;
  visitDur: VisitDur;
  markup: number;
  trade: string;
  toggles: SettingsToggles;

  // pricebook
  addPricebookItem: (d: string, r: number, c: number) => void;
  updatePricebookItem: (index: number, field: "d" | "r" | "c", value: string) => void;
  removePricebookItem: (index: number) => void;

  // labor rates
  addLaborRate: (name: string, rate: number) => void;
  updateLaborRate: (id: number, field: "name" | "rate", value: string) => void;
  removeLaborRate: (id: number) => void;

  // terms
  addTerm: (t: string, body: string) => void;
  removeTerm: (index: number) => void;

  // sources
  addSource: (name: string) => void;
  removeSource: (name: string) => void;

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

export const createSettingsSlice: StateCreator<SettingsSlice, [], [], SettingsSlice> = (set) => ({
  pricebook: SEED_PRICEBOOK,
  laborRates: SEED_LABOR_RATES,
  terms: SEED_TERMS,
  sources: SEED_SOURCES,
  booking: SEED_BOOKING,
  visitDur: SEED_VISIT_DUR,
  markup: SEED_MARKUP,
  trade: SEED_TRADE,
  toggles: SEED_TOGGLES,

  // ---- pricebook ----
  addPricebookItem: (d, r, c) => {
    const desc = d.trim();
    if (!desc) return;
    const cost = Math.max(0, Math.round(Number.isFinite(c) ? c : 0));
    let rate = Math.max(0, Math.round(Number.isFinite(r) ? r : 0));
    set((s) => {
      // dedupe by description (prototype pbHas)
      if (s.pricebook.some((p) => p.d.trim().toLowerCase() === desc.toLowerCase())) return {};
      // no price typed → suggest one from cost at the default markup (prototype)
      if (!rate && cost) rate = Math.round(cost * (1 + (s.markup || 0) / 100));
      return { pricebook: [...s.pricebook, { d: desc, r: rate, h: 0, c: cost }] };
    });
  },

  updatePricebookItem: (index, field, value) =>
    set((s) => ({
      pricebook: s.pricebook.map((p, i) => {
        if (i !== index) return p;
        if (field === "d") return { ...p, d: value };
        return { ...p, [field]: Math.max(0, Math.round(Number(value) || 0)) };
      }),
    })),

  removePricebookItem: (index) =>
    set((s) => ({ pricebook: s.pricebook.filter((_, i) => i !== index) })),

  // ---- labor rates ----
  addLaborRate: (name, rate) => {
    const nm = name.trim();
    if (!nm) return;
    const r = Math.max(1, Math.round(Number.isFinite(rate) ? rate : 0)) || 170;
    set((s) => ({ laborRates: [...s.laborRates, { id: ++_nextLaborId, name: nm, rate: r }] }));
  },

  updateLaborRate: (id, field, value) =>
    set((s) => ({
      laborRates: s.laborRates.map((lr) => {
        if (lr.id !== id) return lr;
        if (field === "rate") return { ...lr, rate: Math.max(1, Number(value) || lr.rate) };
        return { ...lr, name: value.trim() || lr.name };
      }),
    })),

  removeLaborRate: (id) =>
    set((s) => {
      // Keep at least one labor rate (prototype guard).
      if (s.laborRates.length <= 1) return {};
      return { laborRates: s.laborRates.filter((lr) => lr.id !== id) };
    }),

  // ---- terms ----
  addTerm: (t, body) => {
    const name = t.trim();
    const text = body.trim();
    if (!name || !text) return;
    set((s) => ({ terms: [...s.terms, { t: name, body: text }] }));
  },

  removeTerm: (index) =>
    set((s) => ({ terms: s.terms.filter((_, i) => i !== index) })),

  // ---- sources ----
  addSource: (name) => {
    const nm = name.trim();
    if (!nm) return;
    set((s) => {
      if (s.sources.some((x) => x.toLowerCase() === nm.toLowerCase())) return {};
      return { sources: [...s.sources, nm] };
    });
  },

  removeSource: (name) =>
    set((s) => ({ sources: s.sources.filter((x) => x !== name) })),

  // ---- booking ----
  updateBookingService: (index, field, value) =>
    set((s) => ({
      booking: {
        ...s.booking,
        services: s.booking.services.map((svc, i) => {
          if (i !== index) return svc;
          if (field === "price") return { ...svc, price: Math.max(0, Number(value) || 0) };
          return { ...svc, [field]: value };
        }),
      },
    })),

  addBookingService: (name) => {
    const nm = name.trim();
    if (!nm) return;
    set((s) => ({
      booking: {
        ...s.booking,
        services: [...s.booking.services, { name: nm, lane: "repair", triggers: "" }],
      },
    }));
  },

  removeBookingService: (index) =>
    set((s) => ({
      booking: { ...s.booking, services: s.booking.services.filter((_, i) => i !== index) },
    })),

  setServiceFee: (n) =>
    set((s) => ({ booking: { ...s.booking, serviceFee: Math.max(0, Number(n) || 0) } })),

  setFeeCredited: (b) =>
    set((s) => ({ booking: { ...s.booking, feeCredited: b } })),

  setBookingField: (field, value) =>
    set((s) => ({ booking: { ...s.booking, [field]: value } })),

  setBookingHours: (key, value) =>
    set((s) => ({
      booking: { ...s.booking, hours: { ...s.booking.hours, [key]: Math.max(0, Number(value) || 0) } },
    })),

  setBookingArea: (field, value) =>
    set((s) => ({
      booking: {
        ...s.booking,
        area: {
          ...s.booking.area,
          [field]: field === "radiusMi" ? Math.max(0, Number(value) || 0) : value,
        },
      },
    })),

  // ---- misc config ----
  // Store hours = clamped minutes / 60 (prototype: max(15, round(min))/60).
  setVisitDur: (key, minutes) =>
    set((s) => ({ visitDur: { ...s.visitDur, [key]: clampInt(minutes, 15) / 60 } })),

  setMarkup: (n) =>
    set(() => ({ markup: Math.max(0, Number(n) || 0) })),

  setTrade: (t) =>
    set(() => ({ trade: t })),

  setToggle: (key, value) =>
    set((s) => ({ toggles: { ...s.toggles, [key]: value } })),
});
