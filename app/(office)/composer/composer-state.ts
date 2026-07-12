/**
 * Composer shared state + pure helpers.
 *
 * ComposerState lives here in one place; the section components under
 * app/(office)/composer/ receive `state` + an `onUpdate` patcher explicitly.
 * Everything in this file is pure data / pure functions — no React.
 */

import type { SampleEstimateLine } from "@/lib/prototype-sample";
import type { EstimateLine } from "@/lib/store/types";

// ---- composer line + state types --------------------------------------------

export interface ComposerLine {
  d: string;
  q: number;
  r: number;
  c?: number;
  opt?: boolean;
  photo?: boolean;
  tune?: boolean;
  lc?: boolean;
}

export type ComposerMode = "builder" | "gbb-prompt" | "gbb-review";

export interface ComposerState {
  leadId: string | null;
  custQuery: string;
  mode: ComposerMode;
  lines: ComposerLine[];
  desc: string;
  aiOpen: boolean;
  aiDrafted: boolean;
  pbOpen: boolean;
  priceOpen: boolean;
  msgOpen: boolean;
  fuOn: boolean;
  pricing: { disc: number; dep: number; tax: number };
  validDays: number;
  intro: string;
  gbb: GBBDraft | null;
  gbbType?: string;
  gbbEdit?: "good" | "better" | "best" | null;
  /** Channel for quote delivery. "text" = SMS via Twilio; "email" = Resend. Default: "text". */
  sendChannel: "text" | "email";
}

export const INITIAL_STATE: ComposerState = {
  leadId: null, // overridden from ?lead= in ComposerPage; else the customer picker shows
  custQuery: "",
  mode: "builder",
  lines: [{ d: "", q: 1, r: 0 }],
  desc: "",
  aiOpen: false,
  aiDrafted: false,
  pbOpen: false,
  priceOpen: false,
  msgOpen: false,
  fuOn: true,
  pricing: { disc: 0, dep: 0, tax: 0 },
  validDays: 14,
  intro: "",
  gbb: null,
  gbbType: undefined,
  gbbEdit: null,
  sendChannel: "text",
};

// ---- job-type + draft helpers (mirror the prototype) ------------------------

/** Classify a free-text job description into a seed bucket. */
export function jobTypeOf(t: string): string {
  const s = (t || "").toLowerCase();
  if (/water heater|tankless|no hot water|pilot|heater/.test(s)) return "water heater";
  if (/drain|clog|jet|sewer|camera|backup/.test(s)) return "drain";
  if (/toilet/.test(s)) return "toilet";
  return "general";
}

// ---- GBB seed data (mirrors prototype's GBB_SEEDS) --------------------------

/** A GBB tier line — extends the sample line with the AI-confidence flag. */
export interface GBBLine extends SampleEstimateLine {
  lc?: boolean;
}

export interface GBBTier {
  k: "good" | "better" | "best";
  name: string;
  title: string;
  note: string;
  lines: GBBLine[];
}

export interface GBBDraft {
  rec: "good" | "better" | "best";
  opts: GBBTier[];
}

const WATER_HEATER_GBB: GBBDraft = {
  rec: "better",
  opts: [
    {
      k: "good",
      name: "Good",
      title: "Like-for-like swap",
      note: "Same size, same spot — back in hot water today.",
      lines: [
        { d: "40-gal gas water heater (standard)", q: 1, r: 1495 },
        { d: "Install & haul away", q: 1, r: 585 },
        { d: "City permit", q: 1, r: 110 },
      ],
    },
    {
      k: "better",
      name: "Better",
      title: "Replace + bring to code",
      note: "What most neighbors pick — code-safe, warrantied, done right.",
      lines: [
        { d: "40-gal gas water heater (Rheem Performance)", q: 1, r: 1650 },
        { d: "Expansion tank + seismic straps (code)", q: 1, r: 385, tune: true },
        { d: "Drip pan + leak alarm", q: 1, r: 145, tune: true },
        { d: "Install, test & haul away", q: 1, r: 585 },
        { d: "City permit", q: 1, r: 110 },
      ],
    },
    {
      k: "best",
      name: "Best",
      title: "Tankless upgrade",
      note: "Endless hot water, ~40% lower gas use, twice the lifespan.",
      lines: [
        { d: "Tankless unit (Navien NPE-240)", q: 1, r: 2890 },
        { d: "Venting + gas line upsize", q: 1, r: 1160 },
        { d: "Recirc pump — instant hot at the tap", q: 1, r: 420, tune: true },
        { d: "Install, descale kit & startup", q: 1, r: 690 },
        { d: "City permit", q: 1, r: 110 },
      ],
    },
  ],
};

const DRAIN_GBB: GBBDraft = {
  rec: "better",
  opts: [
    {
      k: "good",
      name: "Good",
      title: "Clear the clog",
      note: "Cable the line, water flowing again today.",
      lines: [{ d: "Cable / snake the line", q: 1, r: 295 }],
    },
    {
      k: "better",
      name: "Better",
      title: "Clear + see why",
      note: "Jetting scours the pipe; the camera shows what caused it.",
      lines: [
        { d: "Hydro-jet the line", q: 1, r: 450 },
        { d: "Camera inspection w/ locate", q: 1, r: 285, tune: true },
      ],
    },
    {
      k: "best",
      name: "Best",
      title: "Fix it for good",
      note: "Adds the cleanout that makes every future clear cheap.",
      lines: [
        { d: "Hydro-jet the line", q: 1, r: 450 },
        { d: "Camera inspection w/ locate", q: 1, r: 285 },
        { d: "Install exterior cleanout", q: 1, r: 780, tune: true },
      ],
    },
  ],
};

const TOILET_GBB: GBBDraft = {
  rec: "better",
  opts: [
    {
      k: "good",
      name: "Good",
      title: "Install yours",
      note: "You buy the toilet, we set it right.",
      lines: [
        { d: "Install customer-supplied toilet", q: 1, r: 225 },
        { d: "Wax-free seal + new bolts", q: 1, r: 45 },
      ],
    },
    {
      k: "better",
      name: "Better",
      title: "Supplied & installed",
      note: "Toto Drake — the workhorse. Supplied, set, hauled away.",
      lines: [
        { d: "Toilet — Toto Drake, supplied & installed", q: 1, r: 460 },
        { d: "Haul away old fixture", q: 1, r: 45, tune: true },
      ],
    },
    {
      k: "best",
      name: "Best",
      title: "Upgrade + stop future leaks",
      note: "Comfort-height Toto + the shut-off valves that always fail, replaced now.",
      lines: [
        { d: "Toilet — Toto Drake II comfort height, supplied & installed", q: 1, r: 585 },
        { d: "Replace angle stop + supply line", q: 1, r: 95, tune: true },
        { d: "Haul away old fixture", q: 1, r: 45 },
      ],
    },
  ],
};

/** Deep-clone a GBB draft so builder edits never mutate a shared seed. */
export function cloneGbb(g: GBBDraft): GBBDraft {
  return {
    rec: g.rec,
    opts: g.opts.map((o) => ({ ...o, lines: o.lines.map((l) => ({ ...l })) })),
  };
}

/**
 * Pick the seed GBBDraft for a known job type, else build a generic 3-tier
 * draft from the current builder lines (mirrors the prototype's gbbFor()).
 */
export function gbbFor(type: string, baseLines: ComposerLine[]): GBBDraft {
  if (type === "water heater") return cloneGbb(WATER_HEATER_GBB);
  if (type === "drain") return cloneGbb(DRAIN_GBB);
  if (type === "toilet") return cloneGbb(TOILET_GBB);

  // Generic fallback — no seed for this type.
  const filtered: GBBLine[] = baseLines
    .filter((l) => (l.d ?? "").trim())
    .map((l) => ({ d: l.d, q: l.q ?? 1, r: l.r ?? 0, lc: true }));
  const base: GBBLine[] =
    filtered.length > 0
      ? filtered
      : [{ d: "Labor & materials — as described", q: 1, r: 850, lc: true }];
  const sum = base.reduce((s, l) => s + (l.q ?? 1) * (l.r ?? 0), 0);

  const good: GBBLine[] = base.map((l) => ({ ...l }));
  const better: GBBLine[] = [
    ...base.map((l) => ({ ...l })),
    {
      d: "Preventive maintenance & 12-mo protection",
      q: 1,
      r: Math.max(89, Math.round((sum * 0.12) / 10) * 10),
      lc: true,
      tune: true,
    },
  ];
  const best: GBBLine[] = [
    {
      d: "Full replacement / upgrade (scoped on site)",
      q: 1,
      r: Math.round((sum * 1.8) / 10) * 10,
      lc: true,
    },
  ];

  return {
    rec: "better",
    opts: [
      { k: "good", name: "Good", title: "The essentials", note: "Covers the job as described.", lines: good },
      { k: "better", name: "Better", title: "Job + protection", note: "Adds maintenance so it lasts.", lines: better },
      { k: "best", name: "Best", title: "Full upgrade", note: "Replace / upgrade — scoped on site.", lines: best },
    ],
  };
}

// ---- Pricebook items (mirrors prototype seed) -------------------------------

export const PRICEBOOK = [
  { d: "40-gal gas water heater (Rheem Performance)", r: 1650 },
  { d: "Remove & haul away existing unit", r: 150 },
  { d: "Expansion tank + seismic straps (code)", r: 385 },
  { d: "Hydro-jet kitchen drain line", r: 450 },
  { d: "Camera inspection w/ locate", r: 285 },
  { d: "Toilet — Toto Drake, supplied & installed", r: 460 },
  { d: "City permit", r: 110 },
];

// ---- GBB tier total ---------------------------------------------------------

export function gbbTierTotal(tier: GBBTier): number {
  return tier.lines.reduce((s, x) => s + (x.q ?? 1) * (x.r ?? 0), 0);
}

// ---- Pricing summary label --------------------------------------------------

export function pricingSummary(p: { disc: number; dep: number; tax: number }): string {
  const parts: string[] = [];
  if (p.disc) parts.push(`${p.disc}% discount`);
  if (p.dep) parts.push(`${p.dep}% deposit`);
  if (p.tax) parts.push(`${p.tax}% tax`);
  return parts.join(" · ");
}

// ---- ComposerLine[] → EstimateLine[] (drop tune/lc; keep d,q,r,c,opt,photo) -

export function toEstimateLines(lines: ComposerLine[]): EstimateLine[] {
  return lines.map((l) => {
    const e: EstimateLine = { d: l.d, q: l.q, r: l.r };
    if (l.c != null) e.c = l.c;
    if (l.opt != null) e.opt = l.opt;
    if (l.photo != null) e.photo = l.photo;
    return e;
  });
}

// ---- send gating ------------------------------------------------------------

/** True when at least one line has a non-blank description. */
export function hasRealLine(lines: ComposerLine[]): boolean {
  return lines.some((l) => (l.d ?? "").trim() !== "");
}

/**
 * Why Preview / Save draft / Send are disabled right now — or null when the
 * quote is sendable. Shown inline next to the action row (no silent no-ops).
 */
export function sendGateReason(
  hasLead: boolean,
  lines: ComposerLine[]
): string | null {
  if (!hasLead) return "Pick a customer first.";
  if (!hasRealLine(lines)) return "Add at least one line.";
  return null;
}

// ---- quote message body -------------------------------------------------------

/**
 * The SMS / email body for a quote send: the intro the user typed (or the
 * auto-intro fallback) followed by the quote link line.
 */
export function buildQuoteMessageBody(opts: {
  firstName: string;
  intro: string;
  quoteNum: string;
  quoteLink: string;
}): string {
  const intro =
    opts.intro.trim() || `Hi ${opts.firstName} — thanks for having us out.`;
  return `${intro} Your quote ${opts.quoteNum} is ready — view and approve here: ${opts.quoteLink}`;
}
