"use client";

/**
 * Composer page — pixel-faithful port of the prototype's vComposer().
 * Renders the "New quote" Good · Better · Best composer.
 * Uses SAMPLE_LEADS / SAMPLE_ESTIMATES from lib/prototype-sample.ts.
 * No live hooks. All sample values baked in.
 *
 * Prototype reference: elas-crm-prototype.html lines 7031–7139.
 *
 * STUBS (visual / no-op):
 *   - composerPickCust(id)   — pick an existing lead from the search dropdown
 *   - composerNewCust(name)  — create a new customer on the fly
 *   - composerClearCust()    — change the selected customer
 *   - composerAccel('gbb')   — switch to 3-option GBB mode
 *   - composerAccel('ai')    — toggle AI draft panel
 *   - composerAccel('tmpl')  — toggle template panel
 *   - useTmpl(key)           — apply a template
 *   - aiDraft()              — AI drafts line items (simulated)
 *   - gbbDraft()             — AI builds Good/Better/Best (simulated)
 *   - gbbMakeRec(k)          — change recommended GBB tier
 *   - gbbEditTier(k)         — edit an individual GBB tier
 *   - gbbSingleInstead()     — revert GBB to single quote
 *   - setLineCost(i, val)    — update cost on a line
 *   - addLine()              — add a blank line
 *   - removeLine(i)          — remove a line
 *   - savePbLine(i)          — save line to pricebook
 *   - toggleOptLine(i)       — mark line optional
 *   - togglePhotoLine(i)     — attach photo to line
 *   - addPbToQuote(i)        — add pricebook item
 *   - setPricing(k, v)       — change disc/dep/tax
 *   - saveDraftComposer()    — save as draft
 *   - previewComposer()      — preview as customer
 *   - sendComposer()         — send the quote
 *   - descMic()              — dictate job description
 *   - sendComposerAll3()     — send all 3 GBB options
 */

import { useState } from "react";
import {
  SAMPLE_LEADS,
  SAMPLE_ESTIMATES,
  calcQuote,
  SAMPLE_BRAND,
  type SampleLead,
  type SampleEstimateLine,
} from "@/lib/prototype-sample";

// ---- helpers ----------------------------------------------------------------

function fmt$(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

// ---- stubs ------------------------------------------------------------------

function stub(action: string, ...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log(`[stub] ${action}`, ...args);
}

// ---- GBB seed data (mirrors prototype's GBB_SEEDS for "water heater") ------

interface GBBTier {
  k: "good" | "better" | "best";
  name: string;
  title: string;
  note: string;
  lines: SampleEstimateLine[];
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
}

type ComposerMode = "builder" | "gbb-prompt" | "gbb-review";

interface ComposerState {
  leadId: number | null;
  custQuery: string;
  custMatches: SampleLead[];
  mode: ComposerMode;
  lines: ComposerLine[];
  desc: string;
  aiOpen: boolean;
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
}

const INITIAL_STATE: ComposerState = {
  leadId: 5, // pre-select Sandy Whitfield for demo richness
  custQuery: "",
  custMatches: [],
  mode: "builder",
  lines: [{ d: "", q: 1, r: 0 }],
  desc: "",
  aiOpen: false,
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

// ---- Customer selector component -------------------------------------------

function CustomerSelector({
  state,
  onUpdate,
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
}) {
  const lead: SampleLead | null =
    state.leadId != null
      ? (SAMPLE_LEADS.find((l) => l.id === state.leadId) ?? null)
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
          onClick={() => {
            onUpdate({ leadId: null, custQuery: "" });
            stub("composerClearCust");
          }}
        >
          change
        </span>
      </div>
    );
  }

  const q = (state.custQuery ?? "").trim().toLowerCase();
  const matches = q
    ? SAMPLE_LEADS.filter(
        (x) =>
          !x.book &&
          x.stage !== "Lost" &&
          ((x.name ?? "") + " " + (x.job ?? ""))
            .toLowerCase()
            .includes(q)
      ).slice(0, 6)
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
              onClick={() => {
                onUpdate({ leadId: x.id, custQuery: "" });
                stub("composerPickCust", x.id);
              }}
            >
              <b>{x.name}</b>
              {x.job ? (
                <span className="muted"> — {x.job}</span>
              ) : null}
            </div>
          ))}
          <div
            className="cmp-opt cmp-add"
            onClick={() => {
              onUpdate({ leadId: null, custQuery: state.custQuery });
              stub("composerNewCust", state.custQuery);
            }}
          >
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
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
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
          // STUB: in real app, AI calls gbbDraft() then sets c.gbb
          onUpdate({ mode: "gbb-review", gbb: WATER_HEATER_GBB });
          stub("gbbDraft");
        }}
      >
        Build 3 options
      </button>
      <button
        className="btn"
        style={{ marginLeft: 8 }}
        onClick={() => stub("descMic")}
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
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
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
                  onClick={() => stub("gbbEditTier", o.k)}
                >
                  Edit
                </button>
                {!isRec && (
                  <button
                    className="btn sm ghost"
                    onClick={() => {
                      onUpdate({ gbb: { ...g, rec: o.k } });
                      stub("gbbMakeRec", o.k);
                    }}
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
          onClick={() => {
            onUpdate({ mode: "builder", gbb: null });
            stub("gbbSingleInstead");
          }}
        >
          use a single quote instead
        </span>
        <span style={{ display: "flex", gap: 10 }}>
          <button
            className="btn ghost"
            onClick={() => stub("previewComposer")}
          >
            Preview as customer
          </button>
          <button
            className="btn primary"
            onClick={() => stub("sendComposerAll3")}
          >
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
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
}) {
  const lead: SampleLead | null =
    state.leadId != null
      ? (SAMPLE_LEADS.find((l) => l.id === state.leadId) ?? null)
      : null;

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
    stub("addPbToQuote", pb.d);
  }

  const priceSum = pricingSummary(state.pricing);

  return (
    <>
      {/* Accelerators */}
      <div style={{ fontWeight: 700, fontSize: 13, margin: "2px 0 7px" }}>
        Build it
      </div>
      <div
        style={{ display: "flex", gap: 9, flexWrap: "wrap", margin: "0 0 16px" }}
      >
        <button
          className="btn qstart"
          onClick={() => {
            onUpdate({ mode: "gbb-prompt", gbb: null });
            stub("composerAccel", "gbb");
          }}
        >
          3 options · Good · Better · Best
        </button>
        <button
          className={`btn qstart${state.aiOpen ? " primary" : ""}`}
          onClick={() => {
            onUpdate({ aiOpen: !state.aiOpen, tmplOpen: false });
            stub("composerAccel", "ai");
          }}
        >
          ✦ Draft with AI
        </button>
        <button
          className={`btn qstart${state.tmplOpen ? " primary" : ""}`}
          onClick={() => {
            onUpdate({ tmplOpen: !state.tmplOpen, aiOpen: false });
            stub("composerAccel", "tmpl");
          }}
        >
          From a template
        </button>
      </div>

      {/* AI draft panel */}
      {state.aiOpen && (
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
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
            onClick={() => stub("aiDraft")}
          >
            Draft lines
          </button>{" "}
          <button
            className="btn sm ghost"
            onClick={() => stub("descMic")}
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
        </div>
      )}

      {/* Template panel */}
      {state.tmplOpen && (
        <div className="card" style={{ padding: 14, marginBottom: 14 }}>
          <div
            className="tmpl-grid"
            style={{ marginTop: 0 }}
          >
            {TEMPLATES.map((t) => (
              <button
                key={t.k}
                className="tmpl"
                onClick={() => {
                  onUpdate({
                    lines: t.lines.map((l) => ({ ...l })),
                    tmplOpen: false,
                  });
                  stub("useTmpl", t.k);
                }}
              >
                {t.t}
                <small>{t.sub}</small>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Line items */}
      <div className="card">
        <h3>Line items</h3>
        <table className="lineitems">
          <thead>
            <tr>
              <th style={{ width: "44%" }}>Description</th>
              <th>Qty</th>
              <th>Price</th>
              <th>
                Cost <span className="muted" style={{ fontWeight: 500 }}>· you</span>
              </th>
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
                  <td>
                    <input
                      type="number"
                      value={x.c ?? ""}
                      placeholder="—"
                      title="What you paid (owner-only) — set it and we suggest a price at your markup; margin shows itself."
                      style={{ width: 78 }}
                      onChange={(e) => {
                        updateLine(i, { c: +e.target.value || undefined });
                        stub("setLineCost", i, e.target.value);
                      }}
                    />
                  </td>
                  <td style={{ textAlign: "right", fontWeight: 700 }}>
                    {fmt$(amt)}
                    {margin !== null && (
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
                          onClick={() => {
                            updateLine(i, { opt: !x.opt });
                            stub("toggleOptLine", i);
                          }}
                        >
                          {x.opt ? "✓ Optional" : "Make optional"}
                        </button>{" "}
                        <button
                          className="btn sm ghost"
                          title="Attach a photo the customer sees beside this line"
                          onClick={() => {
                            updateLine(i, { photo: !x.photo });
                            stub("togglePhotoLine", i);
                          }}
                        >
                          {x.photo ? "✓ Photo" : "+ Photo"}
                        </button>{" "}
                        <button
                          className="btn sm ghost"
                          title="Save this line to your pricebook so you can reuse it"
                          onClick={() => stub("savePbLine", i)}
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

        {/* Totals */}
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
                onChange={(e) => {
                  onUpdate({
                    pricing: {
                      ...state.pricing,
                      disc: Math.max(0, +e.target.value || 0),
                    },
                  });
                  stub("setPricing", "disc", e.target.value);
                }}
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Deposit required %</label>
              <input
                type="number"
                min={0}
                value={state.pricing.dep || ""}
                placeholder="0"
                onChange={(e) => {
                  onUpdate({
                    pricing: {
                      ...state.pricing,
                      dep: Math.max(0, +e.target.value || 0),
                    },
                  });
                  stub("setPricing", "dep", e.target.value);
                }}
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
                onChange={(e) => {
                  onUpdate({
                    pricing: {
                      ...state.pricing,
                      tax: Math.max(0, +e.target.value || 0),
                    },
                  });
                  stub("setPricing", "tax", e.target.value);
                }}
              />
            </div>
          </div>
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
        <button
          className="btn ghost"
          onClick={() => stub("previewComposer")}
        >
          Preview
        </button>
        <button
          className="btn ghost"
          onClick={() => stub("saveDraftComposer")}
        >
          Save draft
        </button>
        <button
          className="btn primary"
          onClick={() => stub("sendComposer")}
        >
          Send quote
        </button>
      </div>
    </>
  );
}

// ---- Main page --------------------------------------------------------------

export default function ComposerPage() {
  const [cs, setCs] = useState<ComposerState>(INITIAL_STATE);

  function update(patch: Partial<ComposerState>) {
    setCs((prev) => ({ ...prev, ...patch }));
  }

  return (
    <div>
      <h1>New quote</h1>

      <CustomerSelector state={cs} onUpdate={update} />

      {cs.mode === "gbb-prompt" && (
        <GBBPromptMode state={cs} onUpdate={update} />
      )}
      {cs.mode === "gbb-review" && cs.gbb && (
        <GBBReviewMode state={cs} onUpdate={update} />
      )}
      {cs.mode === "builder" && (
        <BuilderMode state={cs} onUpdate={update} />
      )}
    </div>
  );
}

// Make SAMPLE_ESTIMATES import not tree-shake (referenced for completeness)
void SAMPLE_ESTIMATES;
void SAMPLE_BRAND;
