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

import { useState, useEffect } from "react";
import { calcQuote } from "@/lib/prototype-sample";
import { fmt$ } from "@/lib/format";
import type { Service } from "@/lib/store/types";
import type { AddResult } from "@/lib/store/slices/pricebook-slice";
import {
  hasRealLine,
  linesForSend,
  recommendedTier,
  switchToGbb,
  switchToSingle,
  tierDisplayName,
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
  services,
  onSaveToBook,
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
  onAiDraft: () => void;
  onSuggestBetterBest: () => void;
  isDrafting: boolean;
  aiDraftError: string | null;
  /** The real pricebook catalog — read direction for "From pricebook". */
  services: Service[];
  /** Write direction for each line's "Save to book" chip. */
  onSaveToBook: (line: ComposerLine) => Promise<AddResult>;
}) {
  // View-only: show/hide the owner "Your cost" column (single table + tier
  // panels alike). Never touches the store — hiding only omits cells; entered
  // costs live on in the lines.
  const [showCost, setShowCost] = useState(false);
  // "From pricebook" search — the catalog can run to dozens of services.
  const [pbQuery, setPbQuery] = useState("");

  const isGbb = state.format === "gbb";
  const rec = recommendedTier(state);

  // "Suggest Better & Best" replaces those tiers — when either holds real
  // lines, the button swaps to an in-flow confirm state before running.
  const suggestReplacesTypedTiers =
    state.gbb?.opts.some((o) => o.k !== "good" && hasRealLine(o.lines)) ?? false;
  const [confirmSuggest, setConfirmSuggest] = useState(false);
  useEffect(() => {
    // The confirm state is only meaningful while there is something to lose.
    if (!isGbb || !suggestReplacesTypedTiers) setConfirmSuggest(false);
  }, [isGbb, suggestReplacesTypedTiers]);
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

  // Appends a snapshot of the service — later edits to the pricebook entry
  // never retroactively change a quote already built from it.
  function addPbLine(svc: Service) {
    onUpdate({
      lines: [...state.lines, { d: svc.name, q: 1, r: svc.unitPrice, c: svc.cost }],
    });
  }

  const pbMatches = pbQuery.trim()
    ? services.filter((svc) =>
        svc.name.toLowerCase().includes(pbQuery.trim().toLowerCase())
      )
    : services;

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
              {isGbb
                ? rec?.k === "good"
                  ? "AI drafted Good — now the recommended option"
                  : "AI drafted Good — edit freely"
                : "AI draft — edit freely"}
            </span>
          )}
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            className={`btn sm${state.aiOpen ? " primary" : " ghost"}`}
            onClick={() => onUpdate({ aiOpen: !state.aiOpen })}
            aria-pressed={state.aiOpen}
          >
            ✦ Draft with AI
          </button>
          <div className="seg" role="group" aria-label="Quote format">
            <button
              type="button"
              onClick={() => onUpdate(switchToSingle(state))}
              aria-pressed={!isGbb}
            >
              Single quote
            </button>
            <button
              type="button"
              onClick={() => onUpdate(switchToGbb(state))}
              aria-pressed={isGbb}
            >
              Good, Better &amp; Best
            </button>
          </div>
        </div>
      </div>

      {/* One-line note describing what the last format switch did */}
      {state.switchNote && (
        <p className="muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
          {state.switchNote}
        </p>
      )}

      {/* GBB-only toolbar — Suggest lives at card level (it spans all tiers).
          Same quiet .lineedit-tool style as the table footers for uniformity. */}
      {isGbb && (
        <div className="lineedit-bar" style={{ padding: "8px 0 0" }}>
          {!confirmSuggest ? (
            <button
              className="lineedit-tool"
              title="Builds Better & Best from Good — replaces what's there"
              onClick={() => {
                // Typed Better/Best lines would be overwritten — confirm
                // in place first. Empty tiers have nothing to lose: run.
                if (suggestReplacesTypedTiers) setConfirmSuggest(true);
                else onSuggestBetterBest();
              }}
            >
              Suggest Better &amp; Best from Good
            </button>
          ) : (
            <>
              <span style={{ fontSize: 12, fontWeight: 600 }}>
                Replaces Better &amp; Best — sure?
              </span>
              <button
                className="btn sm primary"
                onClick={() => {
                  setConfirmSuggest(false);
                  onSuggestBetterBest();
                }}
              >
                Replace
              </button>
              <button className="btn sm ghost" onClick={() => setConfirmSuggest(false)}>
                Cancel
              </button>
            </>
          )}
          <button
            type="button"
            className="lineedit-tool lineedit-spring"
            title="Owner-only cost column with margin — never shown to the customer"
            aria-pressed={showCost}
            onClick={() => setShowCost((v) => !v)}
          >
            {showCost ? "Hide your cost" : "Show your cost"}
          </button>
        </div>
      )}

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
              ? "Drafts all three options from your pricebook, rates & won quotes"
              : "Drafted from your pricebook, rates & won quotes — every line editable"}
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
        <GbbTiers
          state={state}
          onUpdate={onUpdate}
          showCost={showCost}
          onSaveToBook={onSaveToBook}
        />
      ) : (
        <>
          <LineTable
            lines={state.lines}
            showCost={showCost}
            onUpdateLine={updateLine}
            onRemoveLine={removeLine}
            onSaveToBook={onSaveToBook}
            onAddLine={addLine}
            footerTools={
              <>
                <button
                  className="lineedit-tool"
                  onClick={() => onUpdate({ pbOpen: !state.pbOpen })}
                  aria-pressed={state.pbOpen}
                >
                  From pricebook
                </button>
                <button
                  type="button"
                  className="lineedit-tool lineedit-spring"
                  title="Owner-only cost column with margin — never shown to the customer"
                  aria-pressed={showCost}
                  onClick={() => setShowCost((v) => !v)}
                >
                  {showCost ? "Hide your cost" : "Show your cost"}
                </button>
              </>
            }
          />
          {state.pbOpen && (
            <div className="pbpanel">
              <input
                type="text"
                value={pbQuery}
                onChange={(e) => setPbQuery(e.target.value)}
                placeholder="Search your pricebook…"
                style={{
                  flexBasis: "100%",
                  border: "1.5px solid var(--line)",
                  borderRadius: 9,
                  padding: "7px 10px",
                  fontFamily: "inherit",
                  fontSize: 13,
                }}
              />
              {pbMatches.length === 0 ? (
                <span className="muted" style={{ fontSize: 12 }}>
                  {services.length === 0
                    ? "Your pricebook is empty — add services in Settings → Pricebook."
                    : "No matches — try a different search."}
                </span>
              ) : (
                pbMatches.map((svc) => (
                  <button
                    key={svc.id}
                    className="chip"
                    onClick={() => addPbLine(svc)}
                  >
                    {svc.name} · <b>{fmt$(svc.unitPrice)}</b>
                  </button>
                ))
              )}
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
              {tierDisplayName(rec)} option — what the customer receives
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
