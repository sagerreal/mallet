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
import type { HeldTrace } from "@/lib/measure/held-trace";
import { JOB_TAG_MAX_LENGTH } from "@/modules/quoting/domain/quoting-rule";

// ---- composer line + state types --------------------------------------------

export interface ComposerLine {
  d: string;
  q: number;
  r: number;
  c?: number;
  opt?: boolean;
  photo?: boolean;
  /** This line is NOT taxable. Seeded from the pricebook item/material; the exception, not the
   *  default — see the same key on the store's EstimateLine. */
  notax?: boolean;
  /** Provenance: set when the line came from a pricebook MATERIAL (sellable part/equipment).
   * Values are snapshots — this id rides to the server for costing, never live repricing. */
  materialId?: string;
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

/** One line of the AI's original draft, frozen at apply time (rates in dollars). */
export interface AiOriginalLine {
  d: string;
  q: number;
  r: number;
  tier?: TierKey;
}

/**
 * A durable fact the refine loop extracted from the office's correction.
 * Rendered as a one-tap chip — labor_hours writes back to the pricebook
 * service, rule persists to the shop's quoting rules. Never auto-written.
 */
export type AiProposal =
  | { kind: "labor_hours"; serviceName: string; hours: number }
  | { kind: "rule"; rule: string };

/**
 * A proposal as the composer renders it: the payload plus a STABLE identity
 * (chips are accepted/dismissed by id, never by array index — index-keyed
 * dismissal races a pending save and removes the wrong chip) and a per-chip
 * `saving` flag that disables both buttons while its write is in flight.
 */
export type ProposalChip = AiProposal & { id: string; saving: boolean };

/** Key freshly-landed proposals by identity; a new draft mints new ids. */
export function toProposalChips(proposals: AiProposal[], newId: () => string): ProposalChip[] {
  return proposals.map((p) => ({ ...p, id: newId(), saving: false }));
}

/**
 * The rule payload for a labor_hours proposal with no pricebook match — kept
 * as a shop rule instead of dropped. The jobTag is clipped to the server's cap
 * (the drafter allows serviceName up to 200 chars; v1.quoting.rules.create
 * caps jobTag at JOB_TAG_MAX_LENGTH — an unclipped tag would fail forever).
 */
export function laborRulePayload(p: { serviceName: string; hours: number }): {
  rule: string;
  jobTag: string;
} {
  return {
    rule: `${p.serviceName} takes ${p.hours}h of labor`,
    jobTag: p.serviceName.slice(0, JOB_TAG_MAX_LENGTH),
  };
}

/**
 * The pricebook service a labor_hours proposal writes to — ONE matcher shared
 * by the chip label and the accept handler, so what the chip promises is what
 * the tap does (no match → the fact is saved as a shop rule instead).
 */
export function matchServiceByName<T extends { id: string; name: string }>(
  services: T[],
  name: string
): T | undefined {
  const q = name.trim().toLowerCase();
  return services.find((s) => s.name.trim().toLowerCase() === q);
}

export interface ComposerState {
  leadId: string | null;
  /**
   * The scope-visit job this quote prices — seeded once from ?job= (the pipeline's scoped
   * card / a measured job's Build-the-price). Sent as the draft's jobId so accepting the
   * quote CONVERTS that job into the sold work instead of minting a duplicate. null = the
   * quote has no walkthrough behind it.
   */
  jobId: string | null;
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
  /**
   * The AI's ORIGINAL lines, captured when a draft applies and never edited —
   * user edits touch `lines`/`gbb` only. Sent as the ai_draft snapshot with
   * the quote payload so the server can diff what the office changed
   * (edit-delta mining). null until an AI draft lands.
   */
  aiOriginal: AiOriginalLine[] | null;
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
  /**
   * Satellite traces made from THIS quote before any job exists — held here
   * (lib/measure/held-trace.ts), seeded into lines client-side, and persisted
   * via siteCreate only when the quote's flow has a job to anchor them to
   * (?job= / ?change=). An abandoned draft takes them with it — deliberate.
   */
  heldTraces: HeldTrace[];
}

export function emptyLine(): ComposerLine {
  return { d: "", q: 1, r: 0 };
}

export function cloneLines(lines: ComposerLine[]): ComposerLine[] {
  return lines.map((l) => ({ ...l }));
}

export const INITIAL_STATE: ComposerState = {
  leadId: null, // overridden from ?lead= in ComposerPage; else the customer picker shows
  jobId: null, // overridden from ?job= in ComposerPage (scoped card / Build-the-price)
  custQuery: "",
  format: "single",
  lines: [emptyLine()],
  gbb: null,
  switchNote: null,
  desc: "",
  aiOpen: false,
  aiDrafted: false,
  aiOriginal: null,
  pbOpen: false,
  priceOpen: false,
  msgOpen: false,
  fuOn: true,
  pricing: { disc: 0, dep: 0, tax: 0 },
  validDays: 14,
  intro: "",
  terms: null,
  sendChannel: "text",
  heldTraces: [],
};

/** Append a trace held on this quote (immutable — a new state, a new array). */
export function addHeldTrace(state: ComposerState, trace: HeldTrace): ComposerState {
  return { ...state, heldTraces: [...state.heldTraces, trace] };
}

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

/**
 * How many tiers hold at least one real line — what the GBB payload will carry
 * (empty tiers emit no lines, so the customer never sees them). Drives the
 * send button's option count. 0 outside GBB format.
 */
export function realTierCount(
  state: Pick<ComposerState, "format" | "gbb">
): number {
  if (state.format !== "gbb" || !state.gbb) return 0;
  return state.gbb.opts.filter((o) => hasRealLine(o.lines)).length;
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
  // Freeze the AI's original lines for the ai_draft snapshot (edit-delta mining).
  const aiOriginal: AiOriginalLine[] = lines.map((l) => ({ d: l.d, q: l.q, r: l.r }));
  const drafted = { aiOpen: false, aiDrafted: true, aiOriginal, switchNote: null };
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

// ---- measurement seed (deterministic — the "Build the price" entry) --------
// A measured job's ?job= boot calls v1.quoting.buildFromMeasurements and drops
// the result straight into the single-format line table. Unlike an AI draft
// this NEVER sets aiDrafted/aiOriginal — there is no ai_draft snapshot for a
// deterministic seed (aiDraftForPayload only fires off aiDrafted), so a quote
// sent from here carries no ai_draft on the wire.

/** One line as v1.quoting.buildFromMeasurements returns it (cents, per-unit).
 * Assembly seeds (v1.assemblies.seedFromCapture / assembly-held-seed) share the
 * shape and may flag a line optional (e.g. an overlay's edge milling). */
export interface MeasurementSeedLine {
  description: string;
  quantity: number;
  rateCents: number;
  costCents: number;
  opt?: boolean;
}

/** cents → dollars at the store boundary, same conversion the AI drafters use. */
export function seedLinesToComposerLines(lines: MeasurementSeedLine[]): ComposerLine[] {
  return lines.map((l) => ({
    d: l.description,
    q: l.quantity,
    r: l.rateCents / 100,
    c: l.costCents / 100,
    ...(l.opt ? { opt: true } : {}),
  }));
}

/**
 * Seed the composer from a measured job: sets the lead context (the returned
 * leadId) and the single-format line table. An empty seed (every room's only
 * quantity was a gap or unconfirmed) falls back to one blank line — the empty
 * line table would otherwise render with nothing to click into (quote-card's
 * "no hero in the way" invariant).
 */
export function applyMeasurementSeed(
  state: ComposerState,
  leadId: string,
  seedLines: ComposerLine[]
): ComposerState {
  const lines = seedLines.length > 0 ? cloneLines(seedLines) : [emptyLine()];
  return { ...state, leadId, lines };
}

/**
 * Append one surface's seed lines to what's already on screen — the composer
 * panel's per-surface "Seed lines". Unlike applyMeasurementSeed (the ?job=
 * boot, which REPLACES the table), this keeps every real line the office
 * already has and adds the new ones after them; blank placeholder rows are
 * dropped so a fresh composer doesn't keep an empty first row above the seed.
 * In GBB format the lines land in the Good tier (same target applyAiDraftLines
 * uses — Good is the base scope the office builds up from). An empty seed
 * returns the state unchanged (the caller surfaces why — usually a pricing
 * gap — instead of silently no-oping).
 */
export function appendMeasurementLines(
  state: ComposerState,
  seedLines: ComposerLine[]
): ComposerState {
  if (seedLines.length === 0) return state;
  const appended = (existing: ComposerLine[]): ComposerLine[] => [
    ...realLines(cloneLines(existing)),
    ...cloneLines(seedLines),
  ];
  if (state.format === "gbb" && state.gbb) {
    const good = state.gbb.opts.find((o) => o.k === "good");
    if (!good) return state;
    return {
      ...state,
      gbb: updateTier(state.gbb, "good", { lines: appended(good.lines) }),
    };
  }
  return { ...state, lines: appended(state.lines) };
}

/** One line of a persisted estimate, as the composer's revise seed consumes it (cents in). */
export interface ReviseSeedLine {
  d: string;
  q: number;
  rCents: number;
  cCents: number;
  opt: boolean;
  photo: boolean;
  /** Does this line take sales tax. Restored so a revision does not silently re-tax a line the
   *  shop had excluded. */
  taxable: boolean;
  tier: TierKey | null;
}

export interface ReviseSeed {
  leadId: string;
  title: string;
  discBps: number;
  taxBps: number;
  depBps: number;
  lines: ReviseSeedLine[];
  recommendedTier: TierKey | null;
  tierNames: { good: string; better: string; best: string } | null;
  /**
   * The scope-visit job the ORIGINAL quote priced — carried onto the revision, or the edited
   * quote would accept into a duplicate job (the exact defect convert-on-accept exists to fix,
   * resurfacing through Edit / Edit & resend). null when the original had no walkthrough behind
   * it — and the seed then CLEARS any stale ?job= state, it never merges.
   */
  jobId: string | null;
}

/**
 * Boot the composer from an EXISTING sent quote ("Revise" — a customer asked for a
 * change). Restores lead, title, pricing and every line; a tiered quote restores its
 * three tiers + recommendation, a flat one lands in the single table. The original
 * stays untouched until the revision actually SENDS (the page archives it then) —
 * abandoning the composer leaves the sent quote exactly as it was.
 */
export function applyReviseSeed(state: ComposerState, seed: ReviseSeed): ComposerState {
  const toLine = (l: ReviseSeedLine): ComposerLine => ({
    d: l.d,
    q: l.q,
    r: l.rCents / 100,
    ...(l.cCents > 0 ? { c: l.cCents / 100 } : {}),
    ...(l.opt ? { opt: true } : {}),
    ...(l.photo ? { photo: true } : {}),
    ...(l.taxable ? {} : { notax: true }),
  });
  const pricing = { disc: seed.discBps / 100, tax: seed.taxBps / 100, dep: seed.depBps / 100 };
  const tiered = seed.lines.some((l) => l.tier != null);

  if (!tiered) {
    const lines = seed.lines.length > 0 ? seed.lines.map(toLine) : [emptyLine()];
    return {
      ...state,
      leadId: seed.leadId,
      jobId: seed.jobId,
      desc: seed.title,
      pricing,
      format: "single",
      lines,
    };
  }

  const tierLines = (k: TierKey): ComposerLine[] => {
    const ls = seed.lines.filter((l) => l.tier === k).map(toLine);
    return ls.length > 0 ? ls : [emptyLine()];
  };
  const names = seed.tierNames;
  const fallbackNames = { good: "Good", better: "Better", best: "Best" } as const;
  const gbb: GBBDraft = {
    rec: seed.recommendedTier ?? "better",
    opts: (["good", "better", "best"] as const).map((k) => ({
      k,
      name: names?.[k] ?? fallbackNames[k],
      title: "",
      note: "",
      lines: tierLines(k),
    })),
  };
  return { ...state, leadId: seed.leadId, jobId: seed.jobId, desc: seed.title, pricing, format: "gbb", gbb };
}

export interface MeasurementGap {
  kind: string;
  label: string;
}

/** Quiet inline notice copy for a pricebook gap — informational, no dead link v1. */
export function gapNoticeText(gap: MeasurementGap): string {
  return `No rate set for ${gap.label} — add one in the Pricebook.`;
}

/** Quiet inline notice copy for rooms whose only trace is "unconfirmed" (no line, no gap). */
export function unconfirmedRoomsNoticeText(count: number): string | null {
  if (count <= 0) return null;
  const noun = count === 1 ? "room has" : "rooms have";
  return `${count} ${noun} unconfirmed measurements — confirm them on the job before sending.`;
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
 *
 * Mid-flight format switch (GBB → single before the response lands): the tier
 * panels are hidden, so filling them silently would look like "Draft with AI"
 * did nothing. The draft still lands in the panels (they survive switches) and
 * the in-flow card note says where it went — no silent invisible state. The
 * single-format line table is never touched.
 */
export function applyAiDraftTiers(
  state: ComposerState,
  draft: AiTiersDraft
): ComposerState {
  if (!state.gbb) return state;
  const gbb: GBBDraft = {
    rec: draft.recommended,
    opts: state.gbb.opts.map((o) => ({
      ...o,
      note: draft[o.k].note,
      lines: cloneLines(draft[o.k].lines),
    })),
  };
  // Freeze the AI's original tier-tagged lines for the ai_draft snapshot.
  const aiOriginal: AiOriginalLine[] = (["good", "better", "best"] as const).flatMap((k) =>
    draft[k].lines.map((l) => ({ d: l.d, q: l.q, r: l.r, tier: k }))
  );
  if (state.format !== "gbb") {
    return {
      ...state,
      aiOpen: false,
      aiDrafted: true,
      aiOriginal,
      gbb,
      switchNote:
        "AI drafted three options after you switched formats — switch to Good, Better & Best to see them.",
    };
  }
  return { ...state, aiOpen: false, aiDrafted: true, aiOriginal, switchNote: null, gbb };
}

/**
 * The ai_draft snapshot for the v1.quoting.draft payload — or null when the
 * quote shouldn't carry one: no AI draft landed, or the format changed since
 * the draft (an untiered snapshot diffed against tiered sent lines would read
 * as all-added/all-removed noise, so the snapshot is dropped instead).
 */
export function aiDraftForPayload(
  state: Pick<ComposerState, "aiDrafted" | "aiOriginal" | "format">
): { lines: { description: string; quantity: number; rateCents: number; tier?: TierKey }[] } | null {
  if (!state.aiDrafted || !state.aiOriginal || state.aiOriginal.length === 0) return null;
  const draftedTiered = state.aiOriginal.some((l) => l.tier != null);
  if (draftedTiered !== (state.format === "gbb")) return null;
  return {
    lines: state.aiOriginal.map((l) => ({
      description: l.d,
      quantity: l.q ?? 1,
      rateCents: Math.round((l.r ?? 0) * 100),
      ...(l.tier ? { tier: l.tier } : {}),
    })),
  };
}

// ---- Pricing summary label --------------------------------------------------

export function pricingSummary(p: { disc: number; dep: number; tax: number }): string {
  const parts: string[] = [];
  if (p.disc) parts.push(`${p.disc}% discount`);
  if (p.dep) parts.push(`${p.dep}% deposit`);
  if (p.tax) parts.push(`${p.tax}% tax`);
  return parts.join(" · ");
}

// ---- ComposerLine[] → EstimateLine[] (keep d,q,r,c,opt,photo,notax,tier) ----

export function toEstimateLines(lines: (ComposerLine | TieredComposerLine)[]): EstimateLine[] {
  return lines.map((l) => {
    const e: EstimateLine = { d: l.d, q: l.q, r: l.r };
    if (l.c != null) e.c = l.c;
    if (l.opt != null) e.opt = l.opt;
    if (l.photo != null) e.photo = l.photo;
    if (l.notax != null) e.notax = l.notax;
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
