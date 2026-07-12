"use client";

/**
 * The quote card — format toggle (Single quote | Good, Better & Best), the
 * authoring tools row, the in-flow AI draft panel, and the format body:
 * single = the shared line table + pricebook chips; GBB = the three tier
 * panels (gbb-tiers.tsx). Totals always reflect what would send right now —
 * in GBB that is the recommended tier (linesForSend).
 *
 * Deferred (intentional no-op — tracked punch-list item):
 *   - Dictate 🎤 — no speech API in the app yet
 */

import { useState } from "react";
import { calcQuote } from "@/lib/prototype-sample";
import { fmt$ } from "@/lib/format";
import {
  PRICEBOOK,
  hasRealLine,
  linesForSend,
  recommendedTier,
  switchToGbb,
  switchToSingle,
  type ComposerLine,
  type ComposerState,
} from "./composer-state";
import { LineTable } from "./line-table";
import { GbbTiers } from "./gbb-tiers";

export function QuoteCard({
  state,
  onUpdate,
  onAiDraft,
  onSuggestBetterBest,
  isDrafting,
  aiDraftError,
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
  onAiDraft: () => void;
  onSuggestBetterBest: () => void;
  isDrafting: boolean;
  aiDraftError: string | null;
}) {
  // View-only: show/hide the owner "Your cost" column (single table + tier
  // panels alike). Never touches the store — hiding only omits cells; entered
  // costs live on in the lines.
  const [showCost, setShowCost] = useState(false);

  const isGbb = state.format === "gbb";
  const rec = recommendedTier(state);
  // What would send right now — recommended tier in GBB, the table in single.
  const sendLines = linesForSend(state);
  const m = calcQuote(
    sendLines.map((l) => ({ d: l.d, q: l.q, r: l.r, opt: l.opt })),
    state.pricing
  );
  // Where an AI draft would land: the Good tier in GBB, else the table.
  const aiTargetLines = isGbb
    ? (state.gbb?.opts.find((o) => o.k === "good")?.lines ?? [])
    : state.lines;

  function updateLine(i: number, patch: Partial<ComposerLine>) {
    onUpdate({
      lines: state.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)),
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

  return (
    <div className="card" style={{ marginTop: 18 }}>
      {/* Header row — title + the format toggle */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <h3 style={{ margin: 0 }}>
          The quote
          {state.aiDrafted && (
            <span
              className="pill"
              style={{ background: "var(--purple-bg)", color: "var(--purple)", marginLeft: 8 }}
            >
              {isGbb ? "AI drafted Good — edit freely" : "AI draft — edit freely"}
            </span>
          )}
        </h3>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            className={`btn sm${!isGbb ? " primary" : " ghost"}`}
            onClick={() => onUpdate(switchToSingle(state))}
            aria-pressed={!isGbb}
          >
            Single quote
          </button>
          <button
            type="button"
            className={`btn sm${isGbb ? " primary" : " ghost"}`}
            onClick={() => onUpdate(switchToGbb(state))}
            aria-pressed={isGbb}
          >
            Good, Better &amp; Best
          </button>
        </div>
      </div>

      {/* One-line note describing what the last format switch did */}
      {state.switchNote && (
        <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
          {state.switchNote}
        </p>
      )}

      {/* Authoring tools row — always visible, both formats */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
          marginTop: 12,
        }}
      >
        <button
          className={`btn sm ghost${state.aiOpen ? " primary" : ""}`}
          onClick={() => onUpdate({ aiOpen: !state.aiOpen })}
        >
          ✦ Draft with AI
        </button>
        {!isGbb && (
          <>
            <button className="btn sm ghost" onClick={addLine}>
              + Add line
            </button>
            <button
              className="btn sm ghost"
              onClick={() => onUpdate({ pbOpen: !state.pbOpen })}
            >
              From pricebook
            </button>
          </>
        )}
        {isGbb && (
          <>
            <button className="btn sm ghost" onClick={onSuggestBetterBest}>
              Suggest Better &amp; Best from Good
            </button>
            <span className="muted" style={{ fontSize: 11 }}>
              Starts Better &amp; Best from Good — edit freely
            </span>
          </>
        )}
        <button className="btn sm ghost" onClick={() => setShowCost((v) => !v)}>
          {showCost ? "Hide your cost" : "Show your cost"}
        </button>
      </div>

      {/* AI draft panel (in-flow, inside the card) */}
      {state.aiOpen && (
        <div className="card" style={{ padding: 14, margin: "14px 0 0" }}>
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
            disabled={isDrafting || !state.desc.trim()}
            onClick={onAiDraft}
          >
            {isDrafting ? "Drafting…" : "Draft lines"}
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
            disabled={isDrafting}
            onClick={() => onUpdate({ aiOpen: false })}
          >
            Cancel
          </button>{" "}
          <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
            {isGbb
              ? "Drafts into the Good option — every line editable"
              : "Drafted from your pricebook & rates — every line editable"}
          </span>
          {aiDraftError && (
            <div style={{ fontSize: 12, color: "var(--red, #c0392b)", marginTop: 8 }}>
              {aiDraftError}
            </div>
          )}
          {!aiDraftError && hasRealLine(aiTargetLines) && (
            <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
              {isGbb ? "Replaces the Good option's lines" : "Replaces current lines"}
            </div>
          )}
        </div>
      )}

      {/* Format body */}
      {isGbb ? (
        <GbbTiers state={state} onUpdate={onUpdate} showCost={showCost} />
      ) : (
        <>
          <LineTable
            lines={state.lines}
            showCost={showCost}
            onUpdateLine={updateLine}
            onRemoveLine={removeLine}
          />
          {state.pbOpen && (
            <div className="pbpanel">
              {PRICEBOOK.map((p, pi) => (
                <button key={pi} className="chip" onClick={() => addPbLine(p)}>
                  {p.d} · <b>{fmt$(p.r)}</b>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Totals — what the customer receives (recommended tier in GBB) */}
      {hasRealLine(sendLines) && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 5,
            padding: "12px 8px",
          }}
        >
          {isGbb && rec && (
            <div className="muted" style={{ fontSize: 12 }}>
              {rec.name} option — what the customer receives
            </div>
          )}
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
              Deposit due on acceptance: {fmt$(m.dep)} ({state.pricing.dep}%)
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
