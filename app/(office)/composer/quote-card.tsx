"use client";

/**
 * The quote card — line items + totals + pricebook chips + the in-flow AI
 * draft panel + the empty-state "how do you start" chooser. Extracted from
 * the composer page; behavior unchanged.
 *
 * Deferred (intentional no-op — tracked punch-list item):
 *   - Dictate 🎤 — no speech API in the app yet
 */

import { useState } from "react";
import { calcQuote } from "@/lib/prototype-sample";
import { fmt$ } from "@/lib/format";
import { PRICEBOOK, type ComposerLine, type ComposerState } from "./composer-state";
import { LineTable } from "./line-table";

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

export function QuoteCard({
  state,
  onUpdate,
  onAiDraft,
  isDrafting,
  aiDraftError,
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
  onAiDraft: () => void;
  isDrafting: boolean;
  aiDraftError: string | null;
}) {
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

  return (
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
              onClick={() => onUpdate({ aiOpen: !state.aiOpen })}
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
          <span
            className="muted"
            style={{ fontSize: 11, marginLeft: 8 }}
          >
            Drafted from your pricebook &amp; rates — every line editable
          </span>
          {aiDraftError && (
            <div style={{ fontSize: 12, color: "var(--red, #c0392b)", marginTop: 8 }}>
              {aiDraftError}
            </div>
          )}
          {!aiDraftError && !isEmpty && (
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
              onClick={() => onUpdate({ aiOpen: !state.aiOpen })}
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
          <LineTable
            lines={state.lines}
            showCost={showCost}
            onUpdateLine={updateLine}
            onRemoveLine={removeLine}
          />

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
  );
}
