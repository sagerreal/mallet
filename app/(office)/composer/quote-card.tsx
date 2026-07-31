"use client";

/**
 * The quote card — format toggle (Single quote | Good, Better & Best), the
 * command bar (the ONE AI surface — build/refine/rebuild by state), and the
 * format body:
 * single = the shared line table + pricebook chips; GBB = the three tier
 * panels (gbb-tiers.tsx). Totals always reflect what would send right now —
 * in GBB that is the recommended tier (linesForSend).
 *
 * Deferred (intentional no-op — tracked punch-list item):
 *   - Dictate 🎤 — no speech API in the app yet
 */

import { useState, useEffect } from "react";
import Link from "next/link";
import { calcQuote } from "@/lib/prototype-sample";
import { fmt$ } from "@/lib/format";
import type { Service, Material } from "@/lib/store/types";
import {
  hasRealLine,
  linesForSend,
  recommendedTier,
  matchServiceByName,
  switchToGbb,
  switchToSingle,
  tierDisplayName,
  type ComposerLine,
  type ComposerState,
  type ProposalChip,
} from "./composer-state";
import { LineTable } from "./line-table";
import { lineProvenance } from "./line-provenance";
import { DraftRun, type DraftRunGather, type DraftRunResult } from "./draft-run";

interface DraftRunProps2 {
  hasLead: boolean;
  gather: DraftRunGather | null;
  pricebook: { services: number; laborRates: number };
  result: DraftRunResult | null;
}
import { GbbTiers } from "./gbb-tiers";

export function QuoteCard({
  state,
  onUpdate,
  onAiDraft,
  onRefine,
  proposals,
  onAcceptProposal,
  onDismissProposal,
  proposalError,
  onSuggestBetterBest,
  isDrafting,
  aiDraftError,
  services,
  materials,
  run,
  onRunDone,
  materialize,
}: {
  state: ComposerState;
  onUpdate: (patch: Partial<ComposerState>) => void;
  onAiDraft: () => void;
  /** Re-run the drafter with the on-screen lines + this correction. */
  onRefine: (feedback: string) => void;
  /** Refine-extracted durable facts — one-tap chips (id-keyed), never auto-written. */
  proposals: ProposalChip[];
  onAcceptProposal: (id: string) => void;
  onDismissProposal: (id: string) => void;
  proposalError: string | null;
  onSuggestBetterBest: () => void;
  isDrafting: boolean;
  aiDraftError: string | null;
  /** The real pricebook catalog — read direction for "From pricebook". */
  services: Service[];
  /** Sellable materials/equipment — the picker offers them beside services. */
  materials: Material[];
  /** The staged run reveal — non-null while a draft is in flight/revealing. */
  run: DraftRunProps2 | null;
  onRunDone: () => void;
  /** Brief window after a reveal: rows animate in (CSS, reduced-motion safe). */
  materialize: boolean;
}) {
  // Command-bar text — local to the card; mirrored into state.desc in build/
  // rebuild modes (the drafter reads it there), cleared after a refine.
  const [barText, setBarText] = useState("");
  const [confirmRebuild, setConfirmRebuild] = useState(false);
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

  // Drives the command bar's mode only (build vs refine vs rebuild). It does NOT
  // gate the line table — see the body below for why that was a bug.
  const quoteIsEmpty = isGbb
    ? !(state.gbb?.opts.some((o) => hasRealLine(o.lines)) ?? false)
    : !hasRealLine(state.lines);

  // The bar's mode follows the quote's state.
  const barMode: "build" | "refine" | "rebuild" = quoteIsEmpty
    ? "build"
    : state.aiDrafted
      ? "refine"
      : "rebuild";

  function runBar() {
    setConfirmRebuild(false);
    if (barMode === "refine") {
      onRefine(barText);
      setBarText("");
    } else {
      onAiDraft();
    }
  }

  function submitBar() {
    // Hand-typed lines are never replaced without an in-flow confirm.
    if (barMode === "rebuild" && !confirmRebuild) {
      setConfirmRebuild(true);
      return;
    }
    runBar();
  }

  // Entering refine mode (a draft just landed) clears the bar — the build
  // text served its purpose; the field now awaits corrections.
  useEffect(() => {
    if (barMode === "refine") setBarText("");
  }, [barMode]);

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

  // Materials are sellable lines too (the $1k-cost/$3k-sell AC-unit model): snapshot the
  // CURRENT sell/cost and carry the materialId as provenance — never a live link.
  function addPbMaterial(m: Material) {
    onUpdate({
      lines: [...state.lines, { d: m.name, q: 1, r: m.unitPrice, c: m.unitCost, materialId: m.id }],
    });
  }

  const pbMatches = pbQuery.trim()
    ? services.filter((svc) =>
        svc.name.toLowerCase().includes(pbQuery.trim().toLowerCase())
      )
    : services;
  const pbMaterialMatches = pbQuery.trim()
    ? materials.filter((m) => m.active && m.name.toLowerCase().includes(pbQuery.trim().toLowerCase()))
    : materials.filter((m) => m.active);

  return (
    <div className="card" style={{ marginTop: "var(--space-5)" }}>
      {/* Header row — title + the format toggle */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "var(--space-3)",
          flexWrap: "wrap",
        }}
      >
        <h3 style={{ margin: "0" }}>
          The quote
          {state.aiDrafted && (
            <span
              className="pill"
              style={{ background: "var(--purple-bg)", color: "var(--purple)", marginLeft: "var(--space-2)" }}
            >
              {isGbb
                ? rec?.k === "good"
                  ? "AI drafted Good — now the recommended option"
                  : "AI drafted Good — edit freely"
                : "AI draft — edit freely"}
            </span>
          )}
        </h3>
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

      {/* One-line note describing what the last format switch did */}
      {state.switchNote && (
        <p className="muted" style={{ fontSize: "var(--type-sm)", margin: "var(--space-2) 0 0" }}>
          {state.switchNote}
        </p>
      )}

      {/* GBB-only toolbar — Suggest lives at card level (it spans all tiers).
          Same quiet .lineedit-tool style as the table footers for uniformity. */}
      {isGbb && (
        <div className="lineedit-bar" style={{ padding: "var(--space-2) 0 0" }}>
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
              <span style={{ fontSize: "var(--type-sm)", fontWeight: 600 }}>
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

      {/* Staged run reveal — replaces the body while the estimator works. The
          drafted lines apply to state the moment the mutation resolves; this
          checklist is presentational on top (see draft-run.tsx). */}
      {run && (
        <DraftRun
          hasLead={run.hasLead}
          gather={run.gather}
          pricebook={run.pricebook}
          result={run.result}
          onDone={onRunDone}
        />
      )}

      {/* The line editor is ALWAYS the body. It used to be hidden behind a
          "What's the job?" hero until a line had a description, which made
          "+ Add line" look broken: the click appended a blank line, but a blank
          line is not a "real" line, so quoteIsEmpty stayed true and the hero kept
          rendering. You could click it five times and see nothing — then opening
          the pricebook flipped the body on and five blank rows appeared at once.
          The table is the honest empty state; the command bar below still builds
          the quote for you. */}
      {!run && (isGbb ? (
        <GbbTiers
          state={state}
          onUpdate={onUpdate}
          showCost={showCost}
          materialize={materialize}
        />
      ) : (
        <>
          <LineTable
            lines={state.lines}
            showCost={showCost}
            onUpdateLine={updateLine}
            onRemoveLine={removeLine}
              onAddLine={addLine}
            materialize={materialize}
            provenanceFor={(d) => lineProvenance(d, services)}
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
                enterKeyHint="search"
                style={{
                  flexBasis: "100%",
                  border: "1.5px solid var(--line)",
                  borderRadius: "var(--radius-sm)",
                  padding: "var(--space-2) var(--space-3)",
                  fontFamily: "inherit",
                  fontSize: "var(--type-base)",
                }}
              />
              {pbMatches.length === 0 && pbMaterialMatches.length === 0 ? (
                services.length === 0 ? (
                  // A dead end otherwise: this used to say "Settings → Pricebook", but the
                  // pricebook moved onto the Office page — Settings has no Pricebook to find.
                  // Link straight to it rather than describing a route.
                  <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
                    Your pricebook is empty.{" "}
                    <Link href="/dashboard?tab=pricebook">Add your services</Link> and they show up
                    here.
                  </span>
                ) : (
                  <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
                    No matches — try a different search.
                  </span>
                )
              ) : (
                <>
                  {pbMatches.map((svc) => (
                    <button
                      key={svc.id}
                      className="chip"
                      onClick={() => addPbLine(svc)}
                    >
                      {svc.name} · <b>{fmt$(svc.unitPrice)}</b>
                    </button>
                  ))}
                  {pbMaterialMatches.map((m) => (
                    <button
                      key={m.id}
                      className="chip"
                      onClick={() => addPbMaterial(m)}
                      title={`Material · ${m.unitOfMeasure}`}
                    >
                      {m.name} · <b>{fmt$(m.unitPrice)}</b>
                      <span className="muted" style={{ marginLeft: "var(--space-1)" }}>part</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </>
      ))}

      {/* The command bar — the ONE AI surface, BELOW the quote so manual entry
          reads as the default (the table above is untouched, nothing autofocuses).
          Mode follows the quote: empty → build; AI-drafted → refine; hand-typed
          lines → rebuild behind an in-flow confirm (never silently replaced). */}
      {!run && (
        <div style={{ marginBottom: "var(--space-2xs)" }}>
          <div className="aibar">
            <input
              type="text"
              value={barText}
              aria-label={
                barMode === "refine"
                  ? "Tell it what to change"
                  : "Describe the job"
              }
              placeholder={
                barMode === "refine"
                  ? "What should change?"
                  : barMode === "rebuild"
                    ? "Rebuild the quote…"
                    : "Describe the job…"
              }
              disabled={isDrafting}
              onChange={(e) => {
                setBarText(e.target.value);
                setConfirmRebuild(false);
                if (barMode !== "refine") onUpdate({ desc: e.target.value });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && barText.trim() && !isDrafting) submitBar();
              }}
            />
            <button
              type="button"
              className="aibar-go"
              disabled={isDrafting || !barText.trim()}
              onClick={submitBar}
            >
              {isDrafting ? "Working…" : barMode === "refine" ? "Update it" : "Build it"}
            </button>
          </div>
          {confirmRebuild && (
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
              <span style={{ fontSize: "var(--type-base)", fontWeight: 600 }}>
                Replaces the lines you typed — sure?
              </span>
              <button className="btn sm primary" onClick={runBar}>
                Build it
              </button>
              <button className="btn sm ghost" onClick={() => setConfirmRebuild(false)}>
                Keep mine
              </button>
            </div>
          )}
          {!confirmRebuild && barMode === "refine" && (
            <p className="aibar-hint">
              Corrections it should keep come back as one-tap saves below.
            </p>
          )}
          {aiDraftError && (
            <div style={{ fontSize: "var(--type-sm)", color: "var(--red, #c0392b)", marginTop: "var(--space-2)" }}>
              {aiDraftError}
            </div>
          )}
        </div>
      )}

      {/* One-tap proposals — under the quote they refine (the bar above is the
          input; these are its answers). */}
      {!run && proposals.length > 0 && (
        <div style={{ padding: "var(--space-3) var(--space-2) 0" }}>
          {/* One-tap proposals — visible, explicit, never written silently. A
              labor_hours proposal without a pricebook match saves as a shop
              rule instead; the label says which (same matcher as the handler).
              Chips are id-keyed and BOTH buttons disable while that chip's
              save is in flight — dismissing a sibling mid-save must never
              retarget the pending chip (duplicate-rule race). */}
          {proposals.map((p) => {
            const inBook = p.kind === "labor_hours" && matchServiceByName(services, p.serviceName);
            const label =
              p.kind === "rule"
                ? `Add to your shop's rules: “${p.rule}”?`
                : inBook
                  ? `Update “${p.serviceName}” labor to ${p.hours}h in your pricebook?`
                  : `Remember “${p.serviceName} takes ${p.hours}h of labor” as a shop rule?`;
            return (
              <div
                key={p.id}
                style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap", marginTop: "var(--space-2)" }}
              >
                <span style={{ fontSize: "var(--type-base)" }}>{label}</span>
                <button
                  className="btn sm primary"
                  disabled={p.saving}
                  onClick={() => onAcceptProposal(p.id)}
                >
                  {p.saving ? "Saving…" : inBook ? "Update" : "Save rule"}
                </button>
                <button
                  className="btn sm ghost"
                  disabled={p.saving}
                  onClick={() => onDismissProposal(p.id)}
                >
                  Just this quote
                </button>
              </div>
            );
          })}
          {proposalError && (
            <div style={{ fontSize: "var(--type-sm)", color: "var(--red, #c0392b)", marginTop: "var(--space-2)" }}>{proposalError}</div>
          )}
        </div>
      )}

      {/* Totals — what the customer receives (recommended tier in GBB) */}
      {!run && hasRealLine(sendLines) && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "var(--space-1)",
            padding: "var(--space-3) var(--space-2)",
          }}
        >
          {isGbb && rec && (
            <div className="muted" style={{ fontSize: "var(--type-sm)" }}>
              {tierDisplayName(rec)} option — what the customer receives
            </div>
          )}
          {(state.pricing.disc || state.pricing.tax) ? (
            <div className="muted" style={{ fontSize: "var(--type-base)" }}>
              Subtotal &nbsp;{" "}
              <b style={{ color: "var(--ink)" }}>{fmt$(m.sub)}</b>
            </div>
          ) : null}
          {state.pricing.disc ? (
            <div className="muted" style={{ fontSize: "var(--type-base)" }}>
              Discount {state.pricing.disc}% &nbsp;{" "}
              <b style={{ color: "var(--red)" }}>−{fmt$(m.disc)}</b>
            </div>
          ) : null}
          {state.pricing.tax ? (
            <div className="muted" style={{ fontSize: "var(--type-base)" }}>
              Tax {state.pricing.tax}% &nbsp;{" "}
              <b style={{ color: "var(--ink)" }}>+{fmt$(m.taxed)}</b>
            </div>
          ) : null}
          <div style={{ fontWeight: 800, fontSize: "var(--type-md)" }}>
            Total &nbsp; {fmt$(m.total)}
          </div>
          {state.pricing.dep ? (
            <span className="pill green" style={{ marginTop: "var(--space-1)" }}>
              Deposit due on acceptance: {fmt$(m.dep)} ({state.pricing.dep}%)
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
