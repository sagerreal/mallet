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
import { fmt$, fmt$rate } from "@/lib/format";
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
import { linesFromSavedAssembly, type SavedComponent } from "./line-math";
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
  savedAssemblies,
  onSaveAssembly,
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
  /**
   * The parts of every saved assembly in the book, keyed by entry — what the editor's
   * in-pricebook state is compared against. Derived from `services` by the page, so the
   * comparison has one source and the table does not have to know about the store.
   */
  savedAssemblies?: ReadonlyMap<string, readonly SavedComponent[]>;
  onSaveAssembly?: (parentIndex: number, itemId: string | null) => void;
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
  // Initialized FROM state.desc so a seeded description (the composer's ?desc=
  // handoff from the new-customer modal) lands visibly in the bar; later seeds
  // (?job=/?revise=, which set desc post-mount) don't retro-fill it.
  const [barText, setBarText] = useState(state.desc);
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
  /**
   * Untouched: no rows, no sections, single format. The mock's empty header is BARE — just
   * "Line items" — because a format toggle and a price-visibility chip on a quote with nothing
   * on it are controls that decide nothing yet.
   */
  const untouched = !isGbb && state.lines.length === 0 && state.sections.length === 0;

  // The upgrade options, for the totals corner: what the customer can ADD, never in the total.
  // Components are excluded here and below for the same reason calcQuote excludes them: their
  // money is already inside their parent's rolled-up rate, and counting both is the exact
  // "$1,158 assembly charged as $2,316" defect the domain names in Estimate.contributesMoney.
  const optionalLines = sendLines.filter(
    (l) => l.opt && l.parentIndex == null && (l.d ?? "").trim() !== "",
  );
  const optionalCount = optionalLines.length;
  const optionalTotal =
    optionalLines.reduce((cents, l) => cents + Math.round((l.q ?? 0) * (l.r ?? 0) * 100), 0) / 100;

  /**
   * What the tax sentence names as taxable: the NON-No-tax billed lines, after the discount.
   * `m.sub − m.disc` is wrong the moment a line is No-tax — it would name a base the rate was
   * never charged on, in the corner the estimator reads to sanity-check exactly that. And a
   * component is not billed at all: its parent carries the money AND the notax flag, so the
   * parent alone decides whether that money is taxable.
   */
  const taxableAfterDiscount =
    (sendLines
      .filter((l) => !l.opt && !l.notax && l.parentIndex == null && (l.d ?? "").trim() !== "")
      .reduce((cents, l) => cents + Math.round((l.q ?? 0) * (l.r ?? 0) * 100), 0) /
      100) *
    (1 - (state.pricing.disc ?? 0) / 100);

  // The whole line, not a hand-picked four fields: re-listing them here is what kept `notax`
  // out of the office's tax base (a No-tax line was still taxed in this number, though never on
  // the customer's document) and would have kept `parentIndex` out of the subtotal the same way.
  const m = calcQuote(sendLines, state.pricing);
  // Where an AI draft would land: the Good tier in GBB, else the table.
  const aiTargetLines = isGbb
    ? (state.gbb?.opts.find((o) => o.k === "good")?.lines ?? [])
    : state.lines;

  // Appends a snapshot of the service — later edits to the pricebook entry
  // never retroactively change a quote already built from it.
  function addPbLine(svc: Service) {
    // A saved ASSEMBLY brings its parts with it — the parent line plus a component per part,
    // each already carrying the expression it counts by.
    if (svc.components && svc.components.length > 0) {
      onUpdate({
        lines: linesFromSavedAssembly(state.lines, {
          id: svc.id,
          name: svc.name,
          unit: svc.unit ?? null,
          unitPrice: svc.unitPrice,
          quantity: svc.defaultQuantity ?? null,
          cost: svc.cost,
          taxable: svc.taxable,
          components: svc.components.map((c) => ({
            d: c.d,
            unit: c.unit,
            qtyExpr: c.qtyExpr,
            roundUp: c.roundUp,
            cost: c.cost,
            rate: c.rate,
            markupBps: c.markupBps,
          })),
        }),
      });
      return;
    }
    // Hourly service: quantity = the service's typical hours (editable on the line);
    // rate = the hourly rate. "4 hrs × $150" lands exactly as the trade says it.
    const q = svc.measuredBy === "hour" ? (svc.laborHours ?? 1) || 1 : 1;
    onUpdate({
      lines: [
        ...state.lines,
        // Taxability is seeded from the book entry and stays editable on the line — the model
        // Housecall Pro and Jobber both use. Only the exception is recorded.
        {
          d: svc.name,
          q,
          r: svc.unitPrice,
          c: svc.cost,
          pricebookItemId: svc.id,
          ...(svc.unit ? { unit: svc.unit } : {}),
          ...(svc.taxable ? {} : { notax: true }),
        },
      ],
    });
  }

  // Materials are sellable lines too (the $1k-cost/$3k-sell AC-unit model): snapshot the
  // CURRENT sell/cost and carry the materialId as provenance — never a live link.
  function addPbMaterial(m: Material) {
    onUpdate({
      lines: [
        ...state.lines,
        {
          d: m.name,
          q: 1,
          r: m.unitPrice,
          c: m.unitCost,
          materialId: m.id,
          ...(m.taxable ? {} : { notax: true }),
        },
      ],
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
          Line items
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
        {!untouched && (
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
        )}
        {!untouched && (
        <button
          type="button"
          className={`pricevis${state.priceDisplay === "total" ? " on" : ""}`}
          title="Which numbers the customer sees. One total = scope prose + a single price at the bottom; your rates stay in the data either way. Optional add-on prices always show."
          onClick={() =>
            onUpdate({ priceDisplay: state.priceDisplay === "total" ? "lines" : "total" })
          }
        >
          {state.priceDisplay === "total"
            ? "$ Customer sees one total"
            : "$ Customer sees every price"}
        </button>
        )}
        {!untouched && (
          <div className="seg" role="group" aria-label="View">
            {/* The mock's header control. One state, two names: Pricing is the customer's
                numbers, Costing adds your cost, markup and margin — never shown to them. */}
            <button type="button" aria-pressed={!showCost} onClick={() => setShowCost(false)}>
              Pricing
            </button>
            <button type="button" aria-pressed={showCost} onClick={() => setShowCost(true)}>
              Costing
            </button>
          </div>
        )}
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
            priceMode={state.priceDisplay}
            sections={state.sections}
            onLines={(next) => onUpdate({ lines: next })}
            onSections={(next) => onUpdate({ sections: next.sections, lines: next.lines })}
            savedAssemblies={savedAssemblies}
            onSaveAssembly={onSaveAssembly}
            materialize={materialize}
            taxed={(state.pricing.tax ?? 0) > 0}
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
              </>
            }
            emptyTools={
              <button
                className="lineedit-tool"
                onClick={() => onUpdate({ pbOpen: !state.pbOpen })}
                aria-pressed={state.pbOpen}
              >
                From pricebook
              </button>
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
                      {svc.name} · <b>{fmt$rate(svc.unitPrice)}</b>
                      {svc.components && svc.components.length > 0 ? (
                        <span className="muted">
                          {" "}
                          · {svc.components.length} part{svc.components.length === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </button>
                  ))}
                  {pbMaterialMatches.map((m) => (
                    <button
                      key={m.id}
                      className="chip"
                      onClick={() => addPbMaterial(m)}
                      title={`Material · ${m.unitOfMeasure}`}
                    >
                      {m.name} · <b>{fmt$rate(m.unitPrice)}</b>
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
          {/* The mock's voice: one headline number, then plain sentences under it. "Quote total"
              rather than a Subtotal/Tax/Total ladder — the ladder is the customer's document;
              this corner tells the ESTIMATOR what will be asked and when. */}
          {state.pricing.disc ? (
            <div className="muted" style={{ fontSize: "var(--type-sm)" }}>
              {fmt$(m.sub)} − {state.pricing.disc}% discount ({fmt$(m.disc)})
            </div>
          ) : null}
          <div style={{ fontWeight: 800, fontSize: "var(--type-md)" }}>
            Quote total &nbsp; {fmt$(m.total)}
          </div>
          {state.pricing.dep ? (
            <div className="muted" style={{ fontSize: "var(--type-sm)" }}>
              {state.pricing.dep}% deposit due on signing — {fmt$(m.dep)}.
            </div>
          ) : null}
          {optionalCount > 0 && (
            <div className="muted" style={{ fontSize: "var(--type-sm)" }}>
              {optionalCount} upgrade option{optionalCount === 1 ? "" : "s"} if accepted
              &nbsp;<b style={{ color: "var(--ink)" }}>+{fmt$(optionalTotal)}</b>
            </div>
          )}
          {state.pricing.tax ? (
            <div className="muted" style={{ fontSize: "var(--type-sm)" }}>
              Includes sales tax {state.pricing.tax}% — {fmt$(m.taxed)} on{" "}
              {fmt$(taxableAfterDiscount)} taxable.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
