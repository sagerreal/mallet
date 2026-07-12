/**
 * "Suggest Better & Best from Good" — pure heuristics, NOT AI.
 *
 * Trade seed templates (keyed off the job text) fill the Better and Best
 * tiers; a generic fallback derives them from the Good tier's lines. The
 * user's Good tier is always preserved verbatim — the suggestion only writes
 * Better and Best (and stars Better, the seeds' default recommendation).
 * Everything here is pure data / pure functions — no React.
 */

import {
  cloneLines,
  type ComposerLine,
  type GBBDraft,
  type GBBTier,
} from "./composer-state";

// ---- job-type classifier (mirrors the prototype) -----------------------------

/** Classify free-text job wording into a seed bucket. */
export function jobTypeOf(t: string): string {
  const s = (t || "").toLowerCase();
  if (/water heater|tankless|no hot water|pilot|heater/.test(s)) return "water heater";
  if (/drain|clog|jet|sewer|camera|backup/.test(s)) return "drain";
  if (/toilet/.test(s)) return "toilet";
  return "general";
}

// ---- Better/Best seed pairs (from the prototype's GBB_SEEDS) -----------------

interface SeedTier {
  name: string;
  title: string;
  note: string;
  lines: ComposerLine[];
}

const SEED_BETTER_BEST: Record<string, { better: SeedTier; best: SeedTier }> = {
  "water heater": {
    better: {
      name: "Better",
      title: "Replace + bring to code",
      note: "What most neighbors pick — code-safe, warrantied, done right.",
      lines: [
        { d: "40-gal gas water heater (Rheem Performance)", q: 1, r: 1650 },
        { d: "Expansion tank + seismic straps (code)", q: 1, r: 385 },
        { d: "Drip pan + leak alarm", q: 1, r: 145 },
        { d: "Install, test & haul away", q: 1, r: 585 },
        { d: "City permit", q: 1, r: 110 },
      ],
    },
    best: {
      name: "Best",
      title: "Tankless upgrade",
      note: "Endless hot water, ~40% lower gas use, twice the lifespan.",
      lines: [
        { d: "Tankless unit (Navien NPE-240)", q: 1, r: 2890 },
        { d: "Venting + gas line upsize", q: 1, r: 1160 },
        { d: "Recirc pump — instant hot at the tap", q: 1, r: 420 },
        { d: "Install, descale kit & startup", q: 1, r: 690 },
        { d: "City permit", q: 1, r: 110 },
      ],
    },
  },
  drain: {
    better: {
      name: "Better",
      title: "Clear + see why",
      note: "Jetting scours the pipe; the camera shows what caused it.",
      lines: [
        { d: "Hydro-jet the line", q: 1, r: 450 },
        { d: "Camera inspection w/ locate", q: 1, r: 285 },
      ],
    },
    best: {
      name: "Best",
      title: "Fix it for good",
      note: "Adds the cleanout that makes every future clear cheap.",
      lines: [
        { d: "Hydro-jet the line", q: 1, r: 450 },
        { d: "Camera inspection w/ locate", q: 1, r: 285 },
        { d: "Install exterior cleanout", q: 1, r: 780 },
      ],
    },
  },
  toilet: {
    better: {
      name: "Better",
      title: "Supplied & installed",
      note: "Toto Drake — the workhorse. Supplied, set, hauled away.",
      lines: [
        { d: "Toilet — Toto Drake, supplied & installed", q: 1, r: 460 },
        { d: "Haul away old fixture", q: 1, r: 45 },
      ],
    },
    best: {
      name: "Best",
      title: "Upgrade + stop future leaks",
      note: "Comfort-height Toto + the shut-off valves that always fail, replaced now.",
      lines: [
        { d: "Toilet — Toto Drake II comfort height, supplied & installed", q: 1, r: 585 },
        { d: "Replace angle stop + supply line", q: 1, r: 95 },
        { d: "Haul away old fixture", q: 1, r: 45 },
      ],
    },
  },
};

// ---- generic fallback: derive Better/Best from the Good tier's lines ---------

function genericBetterBest(goodLines: ComposerLine[]): { better: SeedTier; best: SeedTier } {
  const filtered = goodLines
    .filter((l) => (l.d ?? "").trim())
    .map((l) => ({ d: l.d, q: l.q ?? 1, r: l.r ?? 0 }));
  const base: ComposerLine[] =
    filtered.length > 0
      ? filtered
      : [{ d: "Labor & materials — as described", q: 1, r: 850 }];
  const sum = base.reduce((s, l) => s + (l.q ?? 1) * (l.r ?? 0), 0);

  return {
    better: {
      name: "Better",
      title: "Job + protection",
      note: "Adds maintenance so it lasts.",
      lines: [
        ...cloneLines(base),
        {
          d: "Preventive maintenance & 12-mo protection",
          q: 1,
          r: Math.max(89, Math.round((sum * 0.12) / 10) * 10),
        },
      ],
    },
    best: {
      name: "Best",
      title: "Full upgrade",
      note: "Replace / upgrade — scoped on site.",
      lines: [
        {
          d: "Full replacement / upgrade (scoped on site)",
          q: 1,
          r: Math.round((sum * 1.8) / 10) * 10,
        },
      ],
    },
  };
}

// ---- the suggestion ----------------------------------------------------------

/**
 * Build a full GBB draft from the user's Good tier: Good is kept verbatim;
 * Better & Best come from the trade seed matching `jobText` (else the generic
 * fallback derived from Good's lines). Recommends Better — the seeds' default;
 * the star is a visible radio the user can move.
 */
export function suggestFromGood(good: GBBTier, jobText: string): GBBDraft {
  const seed = SEED_BETTER_BEST[jobTypeOf(jobText)] ?? genericBetterBest(good.lines);
  return {
    rec: "better",
    opts: [
      { ...good, lines: cloneLines(good.lines) },
      { k: "better", ...seed.better, lines: cloneLines(seed.better.lines) },
      { k: "best", ...seed.best, lines: cloneLines(seed.best.lines) },
    ],
  };
}
