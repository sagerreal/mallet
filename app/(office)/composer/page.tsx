"use client";

/**
 * Composer page — pixel-faithful port of the prototype's vComposer().
 * Renders the "New quote" Good · Better · Best composer.
 * Wired to the Zustand app-store (leads + estimates). The markup mirrors the
 * prototype; only the action handlers are live.
 *
 * Prototype reference: elas-crm-prototype.html lines 7031–7139.
 *
 * Deferred (intentional no-ops — see inline comments):
 *   - previewComposer()  — needs the customer-facing quote page
 *   - savePbLine(i)      — needs a store pricebook
 *   - descMic() / 🎤     — no speech API in the app yet
 */

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  SAMPLE_ESTIMATES,
  calcQuote,
  SAMPLE_BRAND,
  type SampleEstimateLine,
} from "@/lib/prototype-sample";
import { useLeads, useAppStore } from "@/lib/store/app-store";
import type { Lead, Estimate, EstimateLine } from "@/lib/store/types";
import { STAGE_ORDER } from "@/features/pipeline/pipeline-constants";

// ---- start-tile icons (soft line icons for the "how do you start" cards) ----
function TileIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const ICO_AI = (
  <TileIcon><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" /><path d="M19 14l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" /></TileIcon>
);
const ICO_GBB = (
  <TileIcon><path d="M12 2 2 7l10 5 10-5-10-5Z" /><path d="m2 17 10 5 10-5" /><path d="m2 12 10 5 10-5" /></TileIcon>
);
const ICO_PEN = (
  <TileIcon><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></TileIcon>
);

// ---- helpers ----------------------------------------------------------------

function fmt$(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

// ---- job-type + draft helpers (mirror the prototype) ------------------------

/** Classify a free-text job description into a seed bucket. */
function jobTypeOf(t: string): string {
  const s = (t || "").toLowerCase();
  if (/water heater|tankless|no hot water|pilot|heater/.test(s)) return "water heater";
  if (/drain|clog|jet|sewer|camera|backup/.test(s)) return "drain";
  if (/toilet/.test(s)) return "toilet";
  return "general";
}

// Note: the former `stub(...)` console-log helper was removed — every action
// is now either wired to the store or an explicit deferred no-op.

// ---- GBB seed data (mirrors prototype's GBB_SEEDS) --------------------------

/** A GBB tier line — extends the sample line with the AI-confidence flag. */
interface GBBLine extends SampleEstimateLine {
  lc?: boolean;
}

interface GBBTier {
  k: "good" | "better" | "best";
  name: string;
  title: string;
  note: string;
  lines: GBBLine[];
}

interface GBBDraft {
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
function cloneGbb(g: GBBDraft): GBBDraft {
  return {
    rec: g.rec,
    opts: g.opts.map((o) => ({ ...o, lines: o.lines.map((l) => ({ ...l })) })),
  };
}

/**
 * Pick the seed GBBDraft for a known job type, else build a generic 3-tier
 * draft from the current builder lines (mirrors the prototype's gbbFor()).
 */
function gbbFor(type: string, baseLines: ComposerLine[]): GBBDraft {
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

/**
 * Build starter line items from a free-text description (mirrors the
 * prototype's draftLinesFor()). Keyword → template lines, else generic.
 */
function draftLinesFor(desc: string): ComposerLine[] {
  const s = (desc || "").toLowerCase();
  let template: { d: string; q: number; r: number }[] | null = null;
  if (/water heater|heater/.test(s)) template = TEMPLATES[0]?.lines ?? null;
  else if (/drain|clog|jet/.test(s)) template = TEMPLATES[1]?.lines ?? null;
  else if (/toilet/.test(s)) template = TEMPLATES[2]?.lines ?? null;

  let lines: ComposerLine[];
  if (template) {
    // Deep-clone so we never share references with the template seed.
    lines = template.map((l) => ({ d: l.d, q: l.q, r: l.r }));
  } else {
    lines = [
      { d: "Labor — " + desc.slice(0, 48), q: 3, r: 170, c: 0 },
      { d: "Materials (estimated)", q: 1, r: 350, c: 0 },
    ];
  }

  // Contextual touch: two of something → qty 2 on matching lines.
  if (s.includes("two") || s.includes("2 ")) {
    lines = lines.map((l) =>
      (l.d ?? "").toLowerCase().includes("toilet") ? { ...l, q: 2 } : l
    );
  }

  return lines;
}

// ---- Pricebook items (mirrors prototype seed) -------------------------------

const PRICEBOOK = [
  { d: "40-gal gas water heater (Rheem Performance)", r: 1650 },
  { d: "Remove & haul away existing unit", r: 150 },
  { d: "Expansion tank + seismic straps (code)", r: 385 },
  { d: "Hydro-jet kitchen drain line", r: 450 },
  { d: "Camera inspection w/ locate", r: 285 },
  { d: "Toilet — Toto Drake, supplied & installed", r: 460 },
  { d: "City permit", r: 110 },
];

// ---- Templates (mirrors prototype TEMPLATES seed) ---------------------------

const TEMPLATES = [
  {
    k: "wh",
    t: "Water heater",
    sub: "40-gal gas — supply, install, haul",
    lines: [
      { d: "40-gal gas water heater (Rheem Performance)", q: 1, r: 1650 },
      { d: "Remove & haul away existing unit", q: 1, r: 150 },
      { d: "Expansion tank + seismic straps (code)", q: 1, r: 385 },
      { d: "City permit", q: 1, r: 110 },
    ],
  },
  {
    k: "drain",
    t: "Drain clean",
    sub: "Cable + camera + cleanout",
    lines: [
      { d: "Hydro-jet kitchen drain line", q: 1, r: 450 },
      { d: "Camera inspection w/ locate", q: 1, r: 285 },
    ],
  },
  {
    k: "toilet",
    t: "Toilet install",
    sub: "Toto Drake supplied & set",
    lines: [
      { d: "Toilet — Toto Drake, supplied & installed", q: 2, r: 460 },
    ],
  },
];

// ---- Terms library ----------------------------------------------------------

const TERMS_LIB = [
  { t: "Workmanship warranty", body: "All labor guaranteed for 12 months." },
  {
    t: "Water heater install terms",
    body: "Price includes haul-away and code compliance. Permit fees billed at cost.",
  },
];

// ---- Composer state type ---------------------------------------------------

interface ComposerLine {
  d: string;
  q: number;
  r: number;
  c?: number;
  opt?: boolean;
  photo?: boolean;
  tune?: boolean;
  lc?: boolean;
}

type ComposerMode = "builder" | "gbb-prompt" | "gbb-review";

interface ComposerState {
  leadId: number | null;
  custQuery: string;
  custMatches: Lead[];
  mode: ComposerMode;
  lines: ComposerLine[];
  desc: string;
  aiOpen: boolean;
  aiDrafted: boolean;
  tmplOpen: boolean;
  pbOpen: boolean;
  priceOpen: boolean;
  msgOpen: boolean;
  fuOn: boolean;
  pricing: { disc: number; dep: number; tax: number };
  validDays: number;
  terms: number | null;
  intro: string;
  gbb: GBBDraft | null;
  gbbType?: string;
  gbbEdit?: "good" | "better" | "best" | null;
}

const INITIAL_STATE: ComposerState = {
  leadId: null, // overridden from ?lead= in ComposerPage; else the customer picker shows
  custQuery: "",
  custMatches: [],
  mode: "builder",
  lines: [{ d: "", q: 1, r: 0 }],
  desc: "",
  aiOpen: false,
  aiDrafted: false,
  tmplOpen: false,
  pbOpen: false,
  priceOpen: false,
  msgOpen: false,
  fuOn: true,
  pricing: { disc: 0, dep: 0, tax: 0 },
  validDays: 14,
  terms: null,
  intro: "",
  gbb: null,
  gbbType: undefined,
  gbbEdit: null,
};

// ---- GBB tier total ---------------------------------------------------------

function gbbTierTotal(tier: GBBTier): number {
  return tier.lines.reduce((s, x) => s + (x.q ?? 1) * (x.r ?? 0), 0);
}

// ---- Pricing summary label --------------------------------------------------

function pricingSummary(p: { disc: number; dep: number; tax: number }): string {
  const parts: string[] = [];
  if (p.disc) parts.push(`${p.disc}% discount`);
  if (p.dep) parts.push(`${p.dep}% deposit`);
  if (p.tax) parts.push(`${p.tax}% tax`);
  return parts.join(" · ");
}

// ---- ComposerLine[] → EstimateLine[] (drop tune/lc; keep d,q,r,c,opt,photo) -

function toEstimateLines(lines: ComposerLine[]): EstimateLine[] {
  return lines.map((l) => {
    const e: EstimateLine = { d: l.d, q: l.q, r: l.r };
    if (l.c != null) e.c = l.c;
    if (l.opt != null) e.opt = l.opt;
    if (l.photo != null) e.photo = l.photo;
    return e;
  });
}

// ---- Customer selector component -------------------------------------------

function CustomerSelector({
  state,
  onUpdate,
  leads,
  onNewCust,
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
  leads: Lead[];
  onNewCust: () => void;
}) {
  const lead: Lead | null =
    state.leadId != null
      ? (leads.find((l) => l.id === state.leadId) ?? null)
      : null;

  if (lead) {
    return (
      <div className="sub">
        For <b>{lead.name}</b>
        {lead.phone && lead.phone !== "—" ? " · " + lead.phone : ""}
        {lead.job ? " — " + lead.job : ""}{" "}
        <span
          className="linklike"
          style={{ marginLeft: 6 }}
          onClick={() => onUpdate({ leadId: null, custQuery: "" })}
        >
          change
        </span>
      </div>
    );
  }

  const q = (state.custQuery ?? "").trim().toLowerCase();
  const matches = q
    ? leads
        .filter(
          (x) =>
            !x.book &&
            x.stage !== "Lost" &&
            ((x.name ?? "") + " " + (x.job ?? ""))
              .toLowerCase()
              .includes(q)
        )
        .slice(0, 6)
    : [];

  return (
    <div style={{ margin: "6px 0 16px", maxWidth: 520 }}>
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
        Customer
      </div>
      <input
        type="text"
        value={state.custQuery}
        placeholder="Type a name — pick an existing customer or add a new one"
        onChange={(e) =>
          onUpdate({ custQuery: e.target.value, custMatches: [] })
        }
        style={{
          width: "100%",
          border: "1.5px solid var(--line)",
          borderRadius: q ? "9px 9px 0 0" : 9,
          padding: "9px 11px",
          fontFamily: "inherit",
          fontSize: "13.5px",
        }}
      />
      {q && (
        <div
          style={{
            border: "1.5px solid var(--line)",
            borderTop: "none",
            borderRadius: "0 0 9px 9px",
            overflow: "hidden",
          }}
        >
          {matches.map((x) => (
            <div
              key={x.id}
              className="cmp-opt"
              onClick={() => onUpdate({ leadId: x.id, custQuery: "" })}
            >
              <b>{x.name}</b>
              {x.job ? (
                <span className="muted"> — {x.job}</span>
              ) : null}
            </div>
          ))}
          <div className="cmp-opt cmp-add" onClick={onNewCust}>
            + Add new customer: &quot;<b>{state.custQuery}</b>&quot;
          </div>
        </div>
      )}
    </div>
  );
}

// ---- GBB prompt mode --------------------------------------------------------

function GBBPromptMode({
  state,
  onUpdate,
  selectedLead,
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
  selectedLead: Lead | null;
}) {
  return (
    <div className="card">
      <h3>3 options — describe the job once</h3>
      <div className="field">
        <textarea
          rows={3}
          placeholder="e.g. 40-gal water heater is leaking — replace, haul away, bring to code"
          value={state.desc}
          onChange={(e) => onUpdate({ desc: e.target.value })}
        />
      </div>
      {state.desc && (
        <p className="muted" style={{ fontSize: "11.5px", margin: "-4px 0 8px" }}>
          Pre-filled from intake.
        </p>
      )}
      <button
        className="btn primary"
        onClick={() => {
          // Pick the GBB seed by job type; recommended tier's lines seed the builder.
          const type = jobTypeOf(state.desc + " " + (selectedLead?.job ?? ""));
          const gbb = gbbFor(type, state.lines);
          const rec = gbb.opts.find((o) => o.k === gbb.rec) ?? gbb.opts[0];
          onUpdate({
            mode: "gbb-review",
            gbb,
            gbbType: type,
            lines: (rec?.lines ?? []).map((l) => ({ ...l })),
          });
        }}
      >
        Build 3 options
      </button>
      <button
        className="btn"
        style={{ marginLeft: 8 }}
        onClick={() => {
          // deferred: no speech API — dictate is a no-op for now
        }}
        title="talk it instead of typing it"
      >
        🎤
      </button>
      <span className="muted" style={{ marginLeft: 10 }}>
        from your pricebook + trade seed knowledge — every line editable
      </span>
    </div>
  );
}

// ---- GBB review mode --------------------------------------------------------

function GBBReviewMode({
  state,
  onUpdate,
  onEditTier,
  onSendAll3,
  onPreview,
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
  onEditTier: (k: "good" | "better" | "best") => void;
  onSendAll3: () => void;
  onPreview: () => void;
}) {
  const g = state.gbb!;
  const lcN = g.opts.reduce(
    (s, o) => s + o.lines.filter((x) => (x as { lc?: boolean }).lc).length,
    0
  );

  return (
    <>
      <div className="deltabanner">
        <b>Three ways to say yes</b> —{" "}
        {lcN
          ? `⚠ marks the ${lcN} line${lcN === 1 ? "" : "s"} the AI is least sure of; everything else came from your pricebook & trade seeds.`
          : "Every line came from your pricebook & trade seeds."}{" "}
        Customers pick a tier, then tune it with toggles — never restart.
      </div>

      <div
        className="ops-grid"
        style={{ gridTemplateColumns: "repeat(3,1fr)", alignItems: "start" }}
      >
        {g.opts.map((o) => {
          const tot = gbbTierTotal(o);
          const isRec = g.rec === o.k;
          return (
            <div
              key={o.k}
              className="card"
              style={{
                margin: 0,
                border: isRec
                  ? "2px solid var(--green-600)"
                  : undefined,
              }}
            >
              {isRec && (
                <span
                  className="pill green"
                  style={{ float: "right" }}
                >
                  recommended
                </span>
              )}
              <h3 style={{ fontSize: 14, marginBottom: 0 }}>{o.name}</h3>
              <div className="muted" style={{ fontSize: 12 }}>
                {o.title}
              </div>
              <div
                style={{
                  fontWeight: 900,
                  fontSize: 19,
                  margin: "6px 0",
                }}
              >
                {fmt$(tot)}
              </div>
              {o.lines.map((x, xi) => (
                <div
                  key={xi}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 12,
                    padding: "2px 0",
                    gap: 8,
                  }}
                >
                  <span>
                    {(x as { lc?: boolean }).lc ? (
                      <span title="low confidence — generic estimate, worth a glance">
                        ⚠{" "}
                      </span>
                    ) : null}
                    {x.d}
                    {(x.q ?? 1) > 1 ? ` ×${x.q}` : ""}
                  </span>
                  <span className="muted">
                    {fmt$((x.q ?? 1) * (x.r ?? 0))}
                  </span>
                </div>
              ))}
              <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                {o.note}
              </p>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  marginTop: 8,
                  flexWrap: "wrap",
                }}
              >
                <button
                  className="btn sm ghost"
                  onClick={() => onEditTier(o.k)}
                >
                  Edit
                </button>
                {!isRec && (
                  <button
                    className="btn sm ghost"
                    onClick={() => onUpdate({ gbb: { ...g, rec: o.k } })}
                  >
                    ★ Recommend this
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 14,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <span
          className="linklike"
          onClick={() =>
            onUpdate({ mode: "builder", gbb: null, gbbType: undefined, gbbEdit: null })
          }
        >
          use a single quote instead
        </span>
        <span style={{ display: "flex", gap: 10 }}>
          <button className="btn ghost" onClick={onPreview}>
            Preview as customer
          </button>
          <button className="btn primary" onClick={onSendAll3}>
            Looks right — send all 3
          </button>
        </span>
      </div>
    </>
  );
}

// ---- Builder mode (standard single-quote) -----------------------------------

function BuilderMode({
  state,
  onUpdate,
  leads,
  onSaveDraft,
  onSend,
  onPreview,
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
  leads: Lead[];
  onSaveDraft: () => void;
  onSend: () => void;
  onPreview: () => void;
}) {
  const lead: Lead | null =
    state.leadId != null
      ? (leads.find((l) => l.id === state.leadId) ?? null)
      : null;

  // View-only: show/hide the owner "Your cost" column. Never touches the store
  // — hiding only omits cells; entered costs live on in state.lines.
  const [showCost, setShowCost] = useState(false);
  // "Started building" — sticky once the user picks manual entry. AI/template
  // seed real lines (isEmpty→false) which also shows the table; manual entry adds
  // a blank row that isEmpty can't see, so it needs this flag to reveal the table.
  const [manualStarted, setManualStarted] = useState(false);
  // No real line description yet → still at the "Start this quote" chooser.
  const isEmpty = !state.lines.some((l) => (l.d ?? "").trim());
  // Show the table once there's a real line OR the user chose manual entry.
  const showTable = !isEmpty || manualStarted;

  const m = calcQuote(
    state.lines.map((l) => ({
      d: l.d,
      q: l.q,
      r: l.r,
      opt: l.opt,
    })),
    state.pricing
  );

  function updateLine(i: number, patch: Partial<ComposerLine>) {
    onUpdate({
      lines: state.lines.map((l, idx) =>
        idx === i ? { ...l, ...patch } : l
      ),
    });
  }

  function removeLine(i: number) {
    onUpdate({
      lines: state.lines.filter((_, idx) => idx !== i),
    });
  }

  function addLine() {
    onUpdate({
      lines: [...state.lines, { d: "", q: 1, r: 0 }],
    });
  }

  function addPbLine(pb: { d: string; r: number }) {
    onUpdate({
      lines: [...state.lines, { d: pb.d, q: 1, r: pb.r }],
    });
  }

  // Return to the 3-option review: write current lines back into the edited
  // tier, then restore the builder to the recommended tier's lines.
  function backToAll3() {
    const g = state.gbb;
    const edited = state.gbbEdit;
    if (!g || !edited) {
      onUpdate({ mode: "gbb-review", gbbEdit: null });
      return;
    }
    const nextGbb: GBBDraft = {
      ...g,
      opts: g.opts.map((o) =>
        o.k === edited
          ? {
              ...o,
              lines: state.lines.map((l) => ({
                d: l.d,
                q: l.q,
                r: l.r,
                ...(l.c != null ? { c: l.c } : {}),
                ...(l.opt != null ? { opt: l.opt } : {}),
                ...(l.photo != null ? { photo: l.photo } : {}),
                ...(l.tune != null ? { tune: l.tune } : {}),
                ...(l.lc != null ? { lc: l.lc } : {}),
              })),
            }
          : o
      ),
    };
    const rec = nextGbb.opts.find((o) => o.k === nextGbb.rec) ?? nextGbb.opts[0];
    onUpdate({
      mode: "gbb-review",
      gbbEdit: null,
      gbb: nextGbb,
      lines: (rec?.lines ?? []).map((l) => ({ ...l })),
    });
  }

  const priceSum = pricingSummary(state.pricing);

  return (
    <>
      {state.gbbEdit && (
        <div className="banner">
          Editing the <b>{state.gbbEdit.toUpperCase()}</b> option — changes save
          into that tier.{" "}
          <span className="linklike" onClick={backToAll3}>
            ← back to all 3
          </span>
        </div>
      )}

      {/* Line items */}
      <div className="card" style={{ marginTop: 18 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <h3 style={{ margin: 0 }}>
            {showTable ? "Line items" : "What are you quoting?"}
            {state.aiDrafted && (
              <span
                className="pill"
                style={{ background: "var(--purple-bg)", color: "var(--purple)", marginLeft: 8 }}
              >
                AI draft — edit freely
              </span>
            )}
          </h3>
          {showTable && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn sm ghost"
                onClick={() => setShowCost((v) => !v)}
              >
                {showCost ? "Hide your cost" : "Show your cost"}
              </button>
              <button
                className={`btn sm ghost${state.aiOpen ? " primary" : ""}`}
                onClick={() => onUpdate({ aiOpen: !state.aiOpen, tmplOpen: false })}
              >
                ✦ Redraft with AI
              </button>
            </div>
          )}
        </div>

        {/* AI draft panel (in-flow, inside the card) */}
        {state.aiOpen && (
          <div className="card" style={{ padding: 14, margin: "14px 0" }}>
            <div className="field" style={{ marginBottom: 8 }}>
              <textarea
                rows={2}
                placeholder="Describe the job — e.g. replace 40-gal gas water heater, haul away, bring to code"
                value={state.desc}
                onChange={(e) => onUpdate({ desc: e.target.value })}
              />
            </div>
            <button
              className="btn sm primary"
              onClick={() => {
                if (!state.desc.trim()) return; // no-op on empty description
                onUpdate({
                  lines: draftLinesFor(state.desc),
                  aiOpen: false,
                  aiDrafted: true,
                });
              }}
            >
              Draft lines
            </button>{" "}
            <button
              className="btn sm ghost"
              onClick={() => {
                // deferred: no speech API — dictate is a no-op for now
              }}
              title="talk it instead of typing it"
            >
              Dictate
            </button>{" "}
            <button
              className="btn sm ghost"
              onClick={() => onUpdate({ aiOpen: false })}
            >
              Cancel
            </button>{" "}
            <span
              className="muted"
              style={{ fontSize: 11, marginLeft: 8 }}
            >
              Drafted from your pricebook &amp; rates — every line editable
            </span>
            {!isEmpty && (
              <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                Replaces current lines
              </div>
            )}
          </div>
        )}

        {/* Empty state — pick how to start (big, inviting soft cards) */}
        {!showTable && (
          <div style={{ padding: "12px 2px 2px" }}>
            <p className="muted" style={{ fontSize: 13, margin: "0 0 16px" }}>
              Pick how to start — you can change every line after.
            </p>
            <div className="addgrid">
              <button
                type="button"
                className="addtile"
                onClick={() => onUpdate({ aiOpen: !state.aiOpen, tmplOpen: false })}
              >
                <div className="addtile-ico">{ICO_AI}</div>
                <div className="addtile-t">Draft with AI</div>
                <div className="addtile-s">Describe the job — we build the lines</div>
              </button>
              <button
                type="button"
                className="addtile"
                onClick={() => onUpdate({ mode: "gbb-prompt", gbb: null })}
              >
                <div className="addtile-ico">{ICO_GBB}</div>
                <div className="addtile-t">Good, Better &amp; Best</div>
                <div className="addtile-s">Three priced options they pick from</div>
              </button>
              <button
                type="button"
                className="addtile"
                onClick={() => {
                  setManualStarted(true);
                  if (!state.lines.length) addLine();
                }}
              >
                <div className="addtile-ico">{ICO_PEN}</div>
                <div className="addtile-t">Add lines by hand</div>
                <div className="addtile-s">Type each item yourself</div>
              </button>
            </div>
          </div>
        )}

        {/* Populated state — line-items table + footer + pricebook */}
        {showTable && (
          <>
        <table className="lineitems">
          <thead>
            <tr>
              <th style={{ width: "44%" }}>Description</th>
              <th>Qty</th>
              <th>Price</th>
              {showCost && <th>Your cost</th>}
              <th style={{ textAlign: "right" }}>Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {state.lines.map((x, i) => {
              const amt = (x.q ?? 1) * (x.r ?? 0);
              const margin =
                x.c && x.c > 0 && x.r > 0
                  ? Math.round((100 * (x.r - x.c)) / x.r)
                  : null;
              return (
                <tr key={i}>
                  <td>
                    <input
                      value={x.d}
                      onChange={(e) =>
                        updateLine(i, { d: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={x.q}
                      style={{ width: 60 }}
                      onChange={(e) =>
                        updateLine(i, { q: +e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={x.r}
                      style={{ width: 84 }}
                      onChange={(e) =>
                        updateLine(i, { r: +e.target.value })
                      }
                    />
                  </td>
                  {showCost && (
                    <td>
                      <input
                        type="number"
                        value={x.c ?? ""}
                        placeholder="—"
                        title="What you paid (owner-only) — set it and we suggest a price at your markup; margin shows itself."
                        style={{ width: 78 }}
                        onChange={(e) =>
                          updateLine(i, { c: +e.target.value || undefined })
                        }
                      />
                    </td>
                  )}
                  <td style={{ textAlign: "right", fontWeight: 700 }}>
                    {fmt$(amt)}
                    {showCost && margin !== null && (
                      <div
                        className="muted"
                        style={{ fontWeight: 500, fontSize: "10.5px" }}
                      >
                        {margin}% margin
                      </div>
                    )}
                  </td>
                  <td style={{ whiteSpace: "normal" }}>
                    {x.d && x.d.trim() && (
                      <>
                        <button
                          className={`optchip${x.opt ? " on" : ""}`}
                          title="Optional add-on — the customer can add or skip this on their quote page"
                          onClick={() => updateLine(i, { opt: !x.opt })}
                        >
                          {x.opt ? "✓ Optional" : "Make optional"}
                        </button>{" "}
                        <button
                          className="btn sm ghost"
                          title="Attach a photo the customer sees beside this line"
                          onClick={() => updateLine(i, { photo: !x.photo })}
                        >
                          {x.photo ? "✓ Photo" : "+ Photo"}
                        </button>{" "}
                        <button
                          className="btn sm ghost"
                          title="Save this line to your pricebook so you can reuse it"
                          onClick={() => {
                            // deferred: needs a store pricebook — no-op for now
                          }}
                        >
                          Save to book
                        </button>{" "}
                      </>
                    )}
                    <button
                      className="btn sm ghost"
                      title="Remove this line"
                      onClick={() => removeLine(i)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <button
          className="btn sm ghost"
          style={{ marginTop: 8 }}
          onClick={addLine}
        >
          + Add line
        </button>
        <button
          className="btn sm ghost"
          style={{ marginTop: 8, marginLeft: 8 }}
          onClick={() => onUpdate({ pbOpen: !state.pbOpen })}
        >
          From pricebook
        </button>

        {state.pbOpen && (
          <div className="pbpanel">
            {PRICEBOOK.map((p, pi) => (
              <button
                key={pi}
                className="chip"
                onClick={() => addPbLine(p)}
              >
                {p.d} · <b>{fmt$(p.r)}</b>
              </button>
            ))}
          </div>
        )}
          </>
        )}

        {/* Totals — only once there's something to total */}
        {showTable && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 5,
            padding: "12px 8px",
          }}
        >
          {(state.pricing.disc || state.pricing.tax) ? (
            <div className="muted" style={{ fontSize: 13 }}>
              Subtotal &nbsp;{" "}
              <b style={{ color: "var(--ink)" }}>{fmt$(m.sub)}</b>
            </div>
          ) : null}
          {state.pricing.disc ? (
            <div className="muted" style={{ fontSize: 13 }}>
              Discount {state.pricing.disc}% &nbsp;{" "}
              <b style={{ color: "var(--red)" }}>−{fmt$(m.disc)}</b>
            </div>
          ) : null}
          {state.pricing.tax ? (
            <div className="muted" style={{ fontSize: 13 }}>
              Tax {state.pricing.tax}% &nbsp;{" "}
              <b style={{ color: "var(--ink)" }}>+{fmt$(m.taxed)}</b>
            </div>
          ) : null}
          <div style={{ fontWeight: 800, fontSize: "15.5px" }}>
            Total &nbsp; {fmt$(m.total)}
          </div>
          {state.pricing.dep ? (
            <span className="pill green" style={{ marginTop: 3 }}>
              Deposit due on acceptance: {fmt$(m.dep)} (
              {state.pricing.dep}%)
            </span>
          ) : null}
        </div>
        )}
      </div>

      {/* Pricing options reveal */}
      <div className={`reveal${state.priceOpen ? " open" : ""}`}>
        <div
          className="reveal-head"
          onClick={() => onUpdate({ priceOpen: !state.priceOpen })}
        >
          <span className="caret">▸</span> Pricing options{" "}
          <span className="muted" style={{ fontWeight: 500 }}>
            — {priceSum || "discount, deposit, tax"}
          </span>
        </div>
        <div className="reveal-body">
          <div style={{ display: "flex", gap: 14 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Discount %</label>
              <input
                type="number"
                min={0}
                value={state.pricing.disc || ""}
                placeholder="0"
                onChange={(e) =>
                  onUpdate({
                    pricing: {
                      ...state.pricing,
                      disc: Math.max(0, +e.target.value || 0),
                    },
                  })
                }
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Deposit required %</label>
              <input
                type="number"
                min={0}
                value={state.pricing.dep || ""}
                placeholder="0"
                onChange={(e) =>
                  onUpdate({
                    pricing: {
                      ...state.pricing,
                      dep: Math.max(0, +e.target.value || 0),
                    },
                  })
                }
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Tax %</label>
              <input
                type="number"
                min={0}
                step={0.25}
                value={state.pricing.tax || ""}
                placeholder="0"
                onChange={(e) =>
                  onUpdate({
                    pricing: {
                      ...state.pricing,
                      tax: Math.max(0, +e.target.value || 0),
                    },
                  })
                }
              />
            </div>
          </div>
        </div>
      </div>


      {/* Delivery card (only when a lead is selected) */}
      {lead && (
        <div className="card" style={{ borderColor: "#E6DCC4" }}>
          <b style={{ fontSize: 13 }}>
            Sends by text to {lead.phone ?? "their phone"}
          </b>
          <p
            className="muted"
            style={{
              fontSize: 12,
              margin: `3px 0 ${lead.email ? "0" : "8px"}`,
            }}
          >
            They tap the link, see it, approve it — no inbox to dig
            through, nothing blocks the send.
            {lead.email ? ` A copy also goes to ${lead.email}.` : ""}
          </p>
          {!lead.email && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label>
                Also email a copy{" "}
                <span className="muted">
                  (optional — saves to{" "}
                  {lead.name.split(" ")[0]}&apos;s record)
                </span>
              </label>
              <input
                type="email"
                inputMode="email"
                id="sendEmail"
                placeholder={`${((lead?.name ?? "").split(" ")[0] ?? "").toLowerCase()}@email.com`}
              />
            </div>
          )}
        </div>
      )}

      {/* Follow-up toggle */}
      <div className="fu-toggle">
        <div
          className={`switch${state.fuOn ? "" : " off"}`}
          onClick={() => onUpdate({ fuOn: !state.fuOn })}
        />
        <div>
          <b>
            Automatic follow-ups: {state.fuOn ? "on" : "off"}
          </b>{" "}
          <span className="muted" style={{ fontSize: 12 }}>
            {state.fuOn
              ? "— 2 reminders, then it flags you to call"
              : "— you'll remind them yourself"}
          </span>
        </div>
      </div>

      {/* Message & terms reveal */}
      <div className={`reveal${state.msgOpen ? " open" : ""}`}>
        <div
          className="reveal-head"
          onClick={() => onUpdate({ msgOpen: !state.msgOpen })}
        >
          <span className="caret">▸</span> Message &amp; terms{" "}
          <span className="muted" style={{ fontWeight: 500 }}>
            —{" "}
            {state.intro ? "custom intro" : "auto intro"}
            {state.terms != null ? " · terms attached" : ""} · valid{" "}
            {state.validDays}d
          </span>
        </div>
        <div className="reveal-body">
          <div className="field">
            <label>
              Intro message{" "}
              <span className="muted">
                (optional — the auto intro covers most sends)
              </span>
            </label>
            <textarea
              rows={2}
              placeholder={`auto: Hi ${lead ? lead.name.split(" ")[0] : "there"} — thanks for having us out…`}
              value={state.intro}
              onChange={(e) => onUpdate({ intro: e.target.value })}
            />
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            <div className="field" style={{ flex: 2, marginBottom: 0 }}>
              <label>
                Terms{" "}
                <span className="muted">(from your library)</span>
              </label>
              <select
                style={{
                  width: "100%",
                  border: "1.5px solid var(--line)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  fontFamily: "inherit",
                  fontSize: 13,
                }}
                value={state.terms ?? ""}
                onChange={(e) =>
                  onUpdate({
                    terms: e.target.value === "" ? null : +e.target.value,
                  })
                }
              >
                <option value="">None</option>
                {TERMS_LIB.map((t, i) => (
                  <option key={i} value={i}>
                    {t.t}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ flex: 1, marginBottom: 0 }}>
              <label>Price valid (days)</label>
              <input
                type="number"
                min={1}
                value={state.validDays}
                onChange={(e) =>
                  onUpdate({
                    validDays: Math.max(1, +e.target.value || 14),
                  })
                }
              />
            </div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 10,
          marginTop: 16,
        }}
      >
        <button className="btn ghost" onClick={onPreview}>
          Preview
        </button>
        <button className="btn ghost" onClick={onSaveDraft}>
          Save draft
        </button>
        <button className="btn primary" onClick={onSend}>
          Send quote
        </button>
      </div>
    </>
  );
}

// ---- Main page --------------------------------------------------------------

export default function ComposerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const leads = useLeads();
  const addEstimate = useAppStore((s) => s.addEstimate);
  const moveLeadStage = useAppStore((s) => s.moveLeadStage);
  const addLeadNote = useAppStore((s) => s.addLeadNote);
  const addLead = useAppStore((s) => s.addLead);

  // Seed leadId from ?lead= once (read-only initializer so state edits persist).
  const [cs, setCs] = useState<ComposerState>(() => {
    const raw = searchParams.get("lead");
    const parsed = raw != null ? Number(raw) : NaN;
    const leadId = Number.isFinite(parsed) ? parsed : null;
    return { ...INITIAL_STATE, leadId };
  });

  function update(patch: Partial<ComposerState>) {
    setCs((prev) => ({ ...prev, ...patch }));
  }

  const selectedLead: Lead | null =
    cs.leadId != null ? (leads.find((l) => l.id === cs.leadId) ?? null) : null;

  // --- persistence helpers --------------------------------------------------

  function hasRealLine(): boolean {
    return cs.lines.some((l) => (l.d ?? "").trim());
  }

  function saveDraftComposer() {
    if (!hasRealLine()) return; // nothing to save (no toast system — just return)
    // Draft requires a lead because addEstimate needs a numeric leadId.
    if (!selectedLead) return;
    addEstimate({
      leadId: selectedLead.id,
      title: selectedLead.job || "Quote draft",
      status: "draft",
      age: 0,
      viewed: false,
      fu: { on: cs.fuOn, stage: 0 },
      lines: toEstimateLines(cs.lines),
      pricing: { ...cs.pricing },
      validDays: cs.validDays,
    });
    router.push("/quotes");
  }

  function sendComposer() {
    if (!selectedLead) return; // send requires a lead
    const e: Estimate = addEstimate({
      leadId: selectedLead.id,
      title: selectedLead.job || "Quote",
      status: "sent",
      age: 0,
      viewed: false,
      fu: { on: cs.fuOn, stage: 0 },
      lines: toEstimateLines(cs.lines),
      pricing: { ...cs.pricing },
      validDays: cs.validDays,
    });
    addLeadNote(selectedLead.id, {
      type: "text",
      from: "auto",
      t: `Your quote ${e.num} is ready — view and approve.`,
      when: "Just now",
    });
    if (
      STAGE_ORDER.indexOf(selectedLead.stage as (typeof STAGE_ORDER)[number]) <
      STAGE_ORDER.indexOf("Quote Sent")
    ) {
      moveLeadStage(selectedLead.id, "Quote Sent");
    }
    router.push("/pipeline");
  }

  function previewComposer() {
    // deferred: customer preview page
  }

  function composerNewCust() {
    const name = cs.custQuery.trim();
    if (!name) return;
    const lead = addLead({
      name,
      phone: "—",
      source: "Added manually",
      stage: "New customer",
      job: "",
    });
    update({ leadId: lead.id, custQuery: "" });
  }

  function editTier(k: "good" | "better" | "best") {
    const tier = cs.gbb?.opts.find((o) => o.k === k);
    if (!tier) return;
    update({
      mode: "builder",
      gbbEdit: k,
      lines: tier.lines.map((l) => ({ ...l })),
    });
  }

  return (
    <div>
      <h1>New quote</h1>

      <CustomerSelector
        state={cs}
        onUpdate={update}
        leads={leads}
        onNewCust={composerNewCust}
      />

      {cs.mode === "gbb-prompt" && (
        <GBBPromptMode state={cs} onUpdate={update} selectedLead={selectedLead} />
      )}
      {cs.mode === "gbb-review" && cs.gbb && (
        <GBBReviewMode
          state={cs}
          onUpdate={update}
          onEditTier={editTier}
          onSendAll3={sendComposer}
          onPreview={previewComposer}
        />
      )}
      {cs.mode === "builder" && (
        <BuilderMode
          state={cs}
          onUpdate={update}
          leads={leads}
          onSaveDraft={saveDraftComposer}
          onSend={sendComposer}
          onPreview={previewComposer}
        />
      )}
    </div>
  );
}

// Make SAMPLE_ESTIMATES import not tree-shake (referenced for completeness)
void SAMPLE_ESTIMATES;
void SAMPLE_BRAND;
