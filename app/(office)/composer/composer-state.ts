/**
 * Composer shared state + pure helpers.
 *
 * ComposerState lives here in one place; the section components under
 * app/(office)/composer/ receive `state` + an `onUpdate` patcher explicitly.
 * Everything in this file is pure data / pure functions — no React.
 *
 * The composer has ONE layout (Customer → The quote → Pricing → Message →
 * Send) and TWO quote formats: "single" (one line table) and "gbb"
 * (Good/Better/Best tier panels). A GBB quote saves / previews / sends the
 * FULL three-tier structure (tier-tagged lines + recommendedTier + tierNames);
 * customers pick one of the three options on their quote page. linesForSend()
 * derives the RECOMMENDED tier's lines at call time for gating and the totals
 * display only — it is no longer what limits the payload.
 */

import type { EstimateLine, QuoteTierKey, TierNames } from "@/lib/store/types";

// ---- composer line + state types --------------------------------------------

export interface ComposerLine {
  d: string;
  q: number;
  r: number;
  c?: number;
  opt?: boolean;
  photo?: boolean;
}

export type QuoteFormat = "single" | "gbb";
export type TierKey = "good" | "better" | "best";

/** One Good/Better/Best tier — name/title editable, lines share the line editor. */
export interface GBBTier {
  k: TierKey;
  /** Editable tier name — leads the panel and the send-button label. */
  name: string;
  /** Editable one-line summary of what this option covers. */
  title: string;
  /** Display-only blurb set by the suggest heuristics ("" when hand-built). */
  note: string;
  lines: ComposerLine[];
}

export interface GBBDraft {
  /** Exactly one recommended tier — shown first to the customer; totals derive from it. */
  rec: TierKey;
  opts: GBBTier[];
}

export interface ComposerState {
  leadId: string | null;
  custQuery: string;
  /** Quote format — toggled in the quote-card header, both directions, any time. */
  format: QuoteFormat;
  /** Single-format lines. In GBB format the tiers in `gbb` hold the lines. */
  lines: ComposerLine[];
  /** GBB tiers — kept across format switches so toggling never loses tier edits. */
  gbb: GBBDraft | null;
  /** One-line in-flow note describing what the last format switch did. */
  switchNote: string | null;
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
  /**
   * Selected job terms — the TEXT is frozen at selection (snapshot semantics:
   * later term edits never rewrite this quote). null = no terms attached.
   */
  terms: { id: string; text: string } | null;
  /** Channel for quote delivery. "text" = SMS via Twilio; "email" = Resend. Default: "text". */
  sendChannel: "text" | "email";
}

export function emptyLine(): ComposerLine {
  return { d: "", q: 1, r: 0 };
}

export function cloneLines(lines: ComposerLine[]): ComposerLine[] {
  return lines.map((l) => ({ ...l }));
}

export const INITIAL_STATE: ComposerState = {
  leadId: null, // overridden from ?lead= in ComposerPage; else the customer picker shows
  custQuery: "",
  format: "single",
  lines: [emptyLine()],
  gbb: null,
  switchNote: null,
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
  terms: null,
  sendChannel: "text",
};

// ---- GBB tier helpers --------------------------------------------------------

/** Immutably patch one tier of a GBB draft. */
export function updateTier(
  gbb: GBBDraft,
  k: TierKey,
  patch: Partial<Omit<GBBTier, "k">>
): GBBDraft {
  return {
    ...gbb,
    opts: gbb.opts.map((o) => (o.k === k ? { ...o, ...patch } : o)),
  };
}

const TIER_DEFAULT_NAMES: Record<TierKey, string> = {
  good: "Good",
  better: "Better",
  best: "Best",
};

/**
 * The tier's name for labels, notes and gate reasons — falls back to the tier
 * key's display name (Good/Better/Best) when the custom name trims empty, so
 * a cleared name input never yields "Send quote —  option".
 */
export function tierDisplayName(tier: Pick<GBBTier, "k" | "name">): string {
  const trimmed = tier.name.trim();
  return trimmed !== "" ? trimmed : TIER_DEFAULT_NAMES[tier.k];
}

/** The recommended tier when the composer is in GBB format, else null. */
export function recommendedTier(
  state: Pick<ComposerState, "format" | "gbb">
): GBBTier | null {
  if (state.format !== "gbb" || !state.gbb) return null;
  const g = state.gbb;
  return g.opts.find((o) => o.k === g.rec) ?? g.opts[0] ?? null;
}

/**
 * The lines the send GATE and the totals display derive from, at call time.
 * GBB format: the RECOMMENDED tier's lines — mirrors the domain's send rule
 * (the recommended tier needs ≥1 real line; server totals derive from it).
 * Single format: the line table. NOTE: the GBB payload itself carries ALL
 * tiers' lines (tieredLinesForPayload) — this is gating/display only.
 */
export function linesForSend(
  state: Pick<ComposerState, "format" | "gbb" | "lines">
): ComposerLine[] {
  const rec = recommendedTier(state);
  return rec ? rec.lines : state.lines;
}

export function gbbTierTotal(tier: GBBTier): number {
  return tier.lines.reduce((s, x) => s + (x.q ?? 1) * (x.r ?? 0), 0);
}

// ---- GBB payload derivation ----------------------------------------------------
// A GBB quote persists the FULL three-tier structure: every real line tagged with
// its tier, plus recommendedTier + tierNames. The server rejects a tiered payload
// with untagged lines (and vice versa), so these two always travel together.

export interface TieredComposerLine extends ComposerLine {
  tier: TierKey;
}

/** All tiers' real (non-blank) lines, each tagged with its tier key. */
export function tieredLinesForPayload(gbb: GBBDraft): TieredComposerLine[] {
  return gbb.opts.flatMap((o) => realLines(o.lines).map((l) => ({ ...l, tier: o.k })));
}

// The server caps tier display names at 60 chars (tierNamesInput).
const TIER_NAME_MAX = 60;

/** The three tiers' display names for the draft payload (fallbacks applied, server cap enforced). */
export function tierNamesForPayload(gbb: GBBDraft): TierNames {
  const names: Record<QuoteTierKey, string> = { ...TIER_DEFAULT_NAMES };
  for (const o of gbb.opts) names[o.k] = tierDisplayName(o).slice(0, TIER_NAME_MAX);
  return names;
}

// ---- format switching --------------------------------------------------------
// Both directions, always available, no confirm dialogs. Each switch returns a
// state patch plus a one-line note (rendered in-flow under the card header).

/**
 * single → GBB. First switch seeds Good with the current lines (Better & Best
 * start empty). If tiers already exist from an earlier GBB session, the current
 * lines go back into the recommended tier (the tier they came from) and the
 * other tiers keep their edits.
 */
export function switchToGbb(state: ComposerState): Partial<ComposerState> {
  if (state.format === "gbb") return {};
  const lines = state.lines.length > 0 ? cloneLines(state.lines) : [emptyLine()];
  if (state.gbb) {
    const gbb = updateTier(state.gbb, state.gbb.rec, { lines });
    const recTier = gbb.opts.find((o) => o.k === gbb.rec);
    const recName = recTier ? tierDisplayName(recTier) : "the recommended";
    return {
      format: "gbb",
      gbb,
      switchNote: `Your lines moved into ${recName} — the other tiers kept their edits.`,
    };
  }
  return {
    format: "gbb",
    gbb: {
      rec: "good",
      opts: [
        { k: "good", name: "Good", title: "", note: "", lines },
        { k: "better", name: "Better", title: "", note: "", lines: [emptyLine()] },
        { k: "best", name: "Best", title: "", note: "", lines: [emptyLine()] },
      ],
    },
    switchNote: "Your lines moved into Good — Better & Best start empty.",
  };
}

/** GBB → single. Keeps the RECOMMENDED tier's lines; tier edits stay in `gbb`. */
export function switchToSingle(state: ComposerState): Partial<ComposerState> {
  if (state.format === "single") return {};
  const rec = recommendedTier(state);
  const lines =
    rec && rec.lines.length > 0 ? cloneLines(rec.lines) : [emptyLine()];
  return {
    format: "single",
    lines,
    switchNote: rec ? `Kept the ${tierDisplayName(rec)} option's lines.` : null,
  };
}

// ---- state patching ------------------------------------------------------------

/**
 * Apply a section patch to the composer state. The format-switch note
 * describes what the LAST switch did — any patch that changes the lines or
 * tiers without setting its own note makes it stale, so it clears here rather
 * than pinning a claim that is no longer true.
 */
export function applyComposerPatch(
  prev: ComposerState,
  patch: Partial<ComposerState>
): ComposerState {
  const editsLines = "lines" in patch || "gbb" in patch;
  const noteWentStale =
    prev.switchNote != null && editsLines && !("switchNote" in patch);
  return noteWentStale
    ? { ...prev, ...patch, switchNote: null }
    : { ...prev, ...patch };
}

// ---- AI draft routing --------------------------------------------------------

/**
 * Apply AI-drafted lines to the right target: the Good tier in GBB format
 * (a mid-flight format switch can land a single-format draft here), else the
 * single-format line table. In GBB the star moves to Good — the user just
 * drafted it, so it's what they expect to send. Any format-switch note is
 * stale after the rewrite and clears.
 */
export function applyAiDraftLines(
  state: ComposerState,
  lines: ComposerLine[]
): ComposerState {
  const drafted = { aiOpen: false, aiDrafted: true, switchNote: null };
  if (state.format === "gbb" && state.gbb) {
    return {
      ...state,
      ...drafted,
      gbb: {
        ...updateTier(state.gbb, "good", { lines: cloneLines(lines) }),
        rec: "good",
      },
    };
  }
  return { ...state, ...drafted, lines: cloneLines(lines) };
}

/** One AI-drafted tier: the display-only note + its lines (rates in dollars). */
export interface AiTierDraft {
  note: string;
  lines: ComposerLine[];
}

/** The full AI Good/Better/Best draft, plus the model's recommended key. */
export interface AiTiersDraft {
  recommended: TierKey;
  good: AiTierDraft;
  better: AiTierDraft;
  best: AiTierDraft;
}

/**
 * Apply a full AI Good/Better/Best draft: fills ALL THREE tier panels (lines +
 * the display-only note) and moves the star to the AI's recommended key. Tier
 * names/titles the user typed are kept. No-op when no GBB draft exists (the
 * tiers endpoint is only called from GBB format, which seeds one).
 */
export function applyAiDraftTiers(
  state: ComposerState,
  draft: AiTiersDraft
): ComposerState {
  if (!state.gbb) return state;
  return {
    ...state,
    aiOpen: false,
    aiDrafted: true,
    switchNote: null,
    gbb: {
      rec: draft.recommended,
      opts: state.gbb.opts.map((o) => ({
        ...o,
        note: draft[o.k].note,
        lines: cloneLines(draft[o.k].lines),
      })),
    },
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

// ---- Pricing summary label --------------------------------------------------

export function pricingSummary(p: { disc: number; dep: number; tax: number }): string {
  const parts: string[] = [];
  if (p.disc) parts.push(`${p.disc}% discount`);
  if (p.dep) parts.push(`${p.dep}% deposit`);
  if (p.tax) parts.push(`${p.tax}% tax`);
  return parts.join(" · ");
}

// ---- ComposerLine[] → EstimateLine[] (keep d,q,r,c,opt,photo,tier) -----------

export function toEstimateLines(lines: (ComposerLine | TieredComposerLine)[]): EstimateLine[] {
  return lines.map((l) => {
    const e: EstimateLine = { d: l.d, q: l.q, r: l.r };
    if (l.c != null) e.c = l.c;
    if (l.opt != null) e.opt = l.opt;
    if (l.photo != null) e.photo = l.photo;
    if ("tier" in l && l.tier != null) e.tier = l.tier;
    return e;
  });
}

// ---- send gating ------------------------------------------------------------

/**
 * Only the lines with a non-blank description — the composer manufactures
 * blank rows (initial state, "+ Add line", GBB seeding), and the server's
 * draft schema rejects them (`description: min(1)`), so every persisted
 * payload (save draft AND send) filters through here.
 */
export function realLines(lines: ComposerLine[]): ComposerLine[] {
  return lines.filter((l) => (l.d ?? "").trim() !== "");
}

/** True when at least one line has a non-blank description. */
export function hasRealLine(lines: ComposerLine[]): boolean {
  return realLines(lines).length > 0;
}

/**
 * Why Preview / Save draft / Send are disabled right now — or null when the
 * quote is sendable. Shown inline next to the action row (no silent no-ops).
 * In GBB format pass the recommended tier's name so the reason names the tier
 * whose lines would send.
 */
export function sendGateReason(
  hasLead: boolean,
  lines: ComposerLine[],
  tierName?: string | null
): string | null {
  if (!hasLead) return "Pick a customer first.";
  if (!hasRealLine(lines)) {
    return tierName
      ? `Add at least one line to the ${tierName} option.`
      : "Add at least one line.";
  }
  return null;
}

/**
 * Why Send is blocked for the chosen channel — or null when a destination is
 * on file. Same rules the send card's destination field uses: trimmed, and
 * the "—" phone placeholder counts as empty. This gates SEND ONLY: Preview
 * and Save draft don't deliver, so they don't take this gate.
 */
export function deliveryGateReason(
  channel: "text" | "email",
  contact: { phone?: string | null; email?: string | null }
): string | null {
  if (channel === "text") {
    const phone = (contact.phone ?? "").trim();
    return phone === "" || phone === "—" ? "Add a mobile number." : null;
  }
  const email = (contact.email ?? "").trim();
  return email === "" ? "Add an email address." : null;
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
