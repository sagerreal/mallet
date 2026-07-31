/**
 * components/modals/cust-quote-modal.tsx
 * Port of the prototype's openCust (7898) / renderCust (8027) — the CUSTOMER-
 * facing quote view, i.e. what the customer sees when they open a quote link
 * to review, tune, and approve/decline it. The office reaches it via
 * "Preview as customer" on the estimate modal.
 *
 * This is a BRANDED customer surface (brand-colored header, "here's your quote",
 * line-by-line with tunable optional add-ons, one fat Approve button), distinct
 * from the office estimate modal (estimate-modal.tsx) which shows cost/margin.
 * Totals math (custCalc → calcQuote) is ported 1:1 from prototype-sample.
 *
 * ModalHost provides the outer shell + close affordance, so the `.custhead` is
 * rendered faithfully but WITHOUT a duplicate ✕ (the prototype's custCloseBtn()),
 * matching cust-invoice-modal.tsx.
 *
 * Sheet frame (#253 grammar): the brand block is the identity, so it stays as-is
 * and is WRAPPED in a sticky .sheet-head — the shop's name never scrolls away
 * while the customer reads the lines. On the live (approvable) paths the one
 * terminal action, Approve, docks as THE .sheet-pri in a sticky .sheet-foot;
 * decline stays the quiet in-body "Not right now" affordance. Confirmation and
 * error states have no terminal action, so they render no foot.
 *
 * Two render paths, keyed off the REAL store estimate:
 *   • Tiered path — pre-accept Good/Better/Best (recommendedTier set, not yet
 *     resolved). Tiers derive from the tier-tagged lines + tierNames; the user
 *     picks one, toggles its add-ons, and Approve commits THAT tier only
 *     (chosenTier + its line set), mirroring the public page's accept.
 *   • Line-items path — single quotes and resolved (accepted) tiered quotes:
 *     `.custline` rows, opt lines as toggleable `.addonrow` add-ons, running
 *     total via calcQuote.
 *
 * DEFERRED (see `// deferred` markers): on-glass signature pad, financing
 * "from $X/mo", join-a-plan add-on, and the "request a change" card.
 */

"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/trpc/client";
import { useActiveModal, useAppStore } from "@/lib/store/app-store";
import { calcQuote } from "@/lib/prototype-sample";
import type { Brand, Estimate, EstimateLine, QuoteTierKey } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";
import { estTierName } from "@/lib/estimates";
import { clockNow } from "@/features/home/send";

// ---- Real GBB tier views (from the tier-tagged lines + tierNames) -----------

interface TierView {
  k: QuoteTierKey;
  name: string;
  /** All of this tier's lines — fixed rows + optional add-ons. */
  lines: EstimateLine[];
}

const TIER_ORDER: readonly QuoteTierKey[] = ["good", "better", "best"];

/**
 * The tier picker structure from the REAL store estimate: lines grouped by
 * their tier tag, display names via estTierName, recommended from
 * recommendedTier. Pre-accept tiered estimates only (post-accept the lines are
 * already resolved to one quote). Tiers with no fixed line are dropped — the
 * server refuses them at accept, so they are not options. Null when nothing
 * renderable remains (e.g. the full line set hasn't loaded).
 */
function tierViewsFromEstimate(
  e: Estimate
): { rec: QuoteTierKey; tiers: TierView[] } | null {
  if (!e.recommendedTier || e.acceptedTier) return null;
  const tiers = TIER_ORDER.map((k) => ({
    k,
    name: estTierName(e, k),
    lines: e.lines.filter((l) => l.tier === k),
  })).filter((t) => t.lines.some((l) => !l.opt));
  if (tiers.length === 0) return null;
  const rec = tiers.some((t) => t.k === e.recommendedTier)
    ? e.recommendedTier
    : tiers[0]!.k;
  return { rec, tiers };
}

/**
 * The committed line set for a tier choice: the tier's fixed lines plus the
 * toggled add-ons flipped non-optional; unselected add-ons drop off and tier
 * tags clear (the accepted quote is a resolved single quote) — the exact
 * semantics of the public page's accept (buildAcceptLinesForTier).
 */
function resolvedTierLines(
  tier: TierView,
  selected: Readonly<Record<number, boolean>>
): EstimateLine[] {
  return tier.lines
    .map((l, i): EstimateLine | null => {
      if (!l.opt) return l;
      return selected[i] ? { ...l, opt: false } : null;
    })
    .filter((l): l is EstimateLine => l !== null)
    .map(({ tier: _tier, ...rest }) => rest);
}

// ---- decline reasons (prototype declineQuote chips) -------------------------
//
// Prompt's canonical set: Price / Timing / Going with someone else.

const DECLINE_REASONS: readonly string[] = ["Price", "Timing", "Going with someone else"];

// ===========================================================================
//  BRANDED HEADER (prototype renderCust §.custhead)
// ===========================================================================

function CustHead({ brand }: { brand: Brand }) {
  return (
    <div className="custhead" style={{ background: brand.color }}>
      <div className="custlogo" style={{ color: brand.color }}>
        {brand.initials}
      </div>
      <div style={{ flex: 1 }}>
        {/* A heading, not a styled div — see cust-invoice-modal. Same type/weight. */}
        <h2 style={{ fontWeight: 800, fontSize: "var(--type-lg)", margin: 0, letterSpacing: "inherit", fontFamily: "inherit" }}>{brand.name}</h2>
        <div style={{ fontSize: "var(--type-sm)", opacity: 0.8 }}>{brand.tagline}</div>
      </div>
      {/* ModalHost provides close — no duplicate custCloseBtn() ✕ here. */}
    </div>
  );
}

// ===========================================================================
//  FOOTER (prototype §"Powered by Elas")
// ===========================================================================

function CustFooter() {
  return (
    <p className="muted" style={{ fontSize: "var(--type-xs)", textAlign: "center", marginTop: "var(--space-3)" }}>
      Powered by Elas — licensed &amp; insured
    </p>
  );
}

// ===========================================================================
//  CONFIRMATION STATES (prototype renderCust accepted / declined branches)
// ===========================================================================

/** ✓ Approved — thank you! (prototype's accepted "deltabanner"). */
function ApprovedState() {
  return (
    <div className="deltabanner" style={{ textAlign: "center" }}>
      ✓ Approved — thank you!
    </div>
  );
}

/** Declined confirmation (prototype's declined "reqcard"). */
function DeclinedState() {
  return (
    <div className="reqcard" style={{ textAlign: "center" }}>
      You passed on this one — no hard feelings.
    </div>
  );
}

// ===========================================================================
//  DECLINE AFFORDANCE — "No thanks" → reason chips (prototype §declineOpen)
// ===========================================================================

function DeclineBlock({ onDecline }: { onDecline: (reason: string) => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ textAlign: "center", marginTop: "var(--space-3)" }}>
      {open ? (
        <div className="chips" style={{ justifyContent: "center" }}>
          {DECLINE_REASONS.map((r) => (
            <button key={r} className="chip" onClick={() => onDecline(r)}>
              {r}
            </button>
          ))}
        </div>
      ) : (
        <span
          className="linklike"
          style={{ color: "var(--ink-3)" }}
          onClick={() => setOpen(true)}
        >
          Not right now
        </span>
      )}
    </div>
  );
}

// ===========================================================================
//  SHARED LINE RENDERING (prototype renderCust)
// ===========================================================================

/** Fixed (non-opt) line rows — `.custline` (prototype §e.lines.filter(!opt)). */
function CustLines({ lines }: { lines: EstimateLine[] }) {
  return (
    <>
      {lines
        .filter((x) => !x.opt)
        .map((x, i) => (
          <div key={i} className="custline">
            <span>
              {x.d}
              {x.q !== 1 ? ` × ${x.q}` : ""}
            </span>
            <b>{fmt$(x.q * x.r)}</b>
          </div>
        ))}
    </>
  );
}

/**
 * Optional add-on rows — `.addonrow` with a checkbox the customer can toggle
 * to add the line (prototype §optIdx.map). Selection state lives in the parent
 * so the total reacts. Keyed by the line's index within `lines`.
 */
function CustAddons({
  lines,
  selected,
  onToggle,
}: {
  lines: EstimateLine[];
  selected: Readonly<Record<number, boolean>>;
  onToggle: (index: number, on: boolean) => void;
}) {
  return (
    <>
      {lines.map((x, i) => {
        if (!x.opt) return null;
        return (
          <label key={i} className="addonrow">
            <input
              type="checkbox"
              checked={!!selected[i]}
              onChange={(e) => onToggle(i, e.target.checked)}
            />
            <span style={{ flex: 1 }}>
              <b>Add:</b> {x.d}
            </span>
            <b>+{fmt$(x.q * x.r)}</b>
          </label>
        );
      })}
    </>
  );
}

/** Right-aligned totals column (prototype §Subtotal / Discount / Tax / Total / deposit). */
function CustTotals({
  m,
  pricing,
}: {
  m: ReturnType<typeof calcQuote>;
  pricing: { disc: number; dep: number; tax: number };
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: "var(--space-1)",
        padding: "var(--space-4) 0 var(--space-1)",
      }}
    >
      {pricing.disc || pricing.tax ? (
        <div className="muted" style={{ fontSize: "var(--type-base)" }}>
          Subtotal {fmt$(m.sub)}
        </div>
      ) : null}
      {pricing.disc ? (
        <div className="muted" style={{ fontSize: "var(--type-base)" }}>
          Discount {pricing.disc}% −{fmt$(m.disc)}
        </div>
      ) : null}
      {pricing.tax ? (
        <div className="muted" style={{ fontSize: "var(--type-base)" }}>
          Tax {pricing.tax}% +{fmt$(m.taxed)}
        </div>
      ) : null}
      <div style={{ fontWeight: 900, fontSize: "var(--type-xl)" }}>Total {fmt$(m.total)}</div>
      {pricing.dep ? (
        <div className="muted" style={{ fontSize: "var(--type-sm)" }}>
          {fmt$(m.dep)} deposit due today · the rest when the job&rsquo;s done
        </div>
      ) : null}
    </div>
  );
}

// ===========================================================================
//  LINE-ITEMS PATH (single quotes + resolved tiered quotes)
// ===========================================================================

interface LineItemsPathProps {
  estimate: Estimate;
  brand: Brand;
  onApprove: (total: number, selectedOptLines: EstimateLine[]) => void;
  onDecline: (reason: string) => void;
}

function LineItemsPath({ estimate, brand, onApprove, onDecline }: LineItemsPathProps) {
  // Local selection of optional add-ons, keyed by line index (prototype custSel.sel).
  const [selected, setSelected] = useState<Record<number, boolean>>({});

  function toggle(index: number, on: boolean) {
    setSelected((prev) => ({ ...prev, [index]: on }));
  }

  // custCalc: non-opt lines + selected opt lines (flipped to non-opt), via calcQuote.
  const selectedOptLines: EstimateLine[] = estimate.lines
    .map((x, i): EstimateLine | null =>
      x.opt && selected[i] ? { ...x, opt: false } : null
    )
    .filter((x): x is EstimateLine => x !== null);
  const calcLines: EstimateLine[] = estimate.lines
    .filter((x) => !x.opt)
    .concat(selectedOptLines);
  const pricing = estimate.pricing ?? { disc: 0, dep: 0, tax: 0 };
  const m = calcQuote(calcLines, pricing);

  return (
    <>
      <p style={{ fontSize: "var(--type-base)", lineHeight: 1.55, marginBottom: "var(--space-2)" }}>
        Here&rsquo;s your quote from <b>{brand.name}</b> — take a look.
      </p>
      <p className="muted" style={{ marginBottom: "var(--space-2)" }}>
        Quote {estimate.num}
      </p>

      {/* fixed line rows */}
      <CustLines lines={estimate.lines} />

      {/* optional add-ons the customer can toggle on */}
      <CustAddons lines={estimate.lines} selected={selected} onToggle={toggle} />

      {/* deferred: join-a-plan add-on row (needs plans model) */}

      {/* totals rollup */}
      <CustTotals m={m} pricing={pricing} />

      {/* deferred: "Request a change" ghost button + card */}

      {/* Not right now → reason picker (quiet, in-body — never in the foot) */}
      <DeclineBlock onDecline={onDecline} />

      <CustFooter />

      {/* Approve — THE terminal action, docked where the thumb is.
          deferred: on-glass signature. */}
      <div className="sheet-foot">
        <button className="sheet-pri" onClick={() => onApprove(m.total, selectedOptLines)}>
          Approve — {fmt$(m.total)}
        </button>
      </div>
    </>
  );
}

// ===========================================================================
//  TIERED PATH — pre-accept Good/Better/Best from the REAL store fields
// ===========================================================================

interface TieredPathProps {
  estimate: Estimate;
  brand: Brand;
  rec: QuoteTierKey;
  tiers: TierView[];
  /** Approve commits ONE tier: its key + its resolved line set. */
  onApprove: (tier: QuoteTierKey, lines: EstimateLine[]) => void;
  onDecline: (reason: string) => void;
}

function TieredPath({ estimate, brand, rec, tiers, onApprove, onDecline }: TieredPathProps) {
  // Selected tier (defaults to recommended) + this tier's toggled add-ons.
  // Add-on selection is tier-scoped: switching tiers resets it, so the total
  // can never mix lines across tiers.
  const [sel, setSel] = useState<QuoteTierKey>(rec);
  const [selected, setSelected] = useState<Record<number, boolean>>({});

  const pricing = estimate.pricing ?? { disc: 0, dep: 0, tax: 0 };
  const selTier = tiers.find((t) => t.k === sel) ?? tiers[0]!;

  function pickTier(k: QuoteTierKey) {
    setSel(k);
    setSelected({});
  }

  function toggle(index: number, on: boolean) {
    setSelected((prev) => ({ ...prev, [index]: on }));
  }

  // What Approve commits: the selected tier's fixed lines + toggled add-ons.
  const finalLines = resolvedTierLines(selTier, selected);
  const m = calcQuote(finalLines, pricing);

  return (
    <>
      <p style={{ fontSize: "var(--type-base)", lineHeight: 1.55, marginBottom: "var(--space-2)" }}>
        Here&rsquo;s your quote from <b>{brand.name}</b>
        {tiers.length > 1 ? (
          <>
            {" "}
            — pick an option, tweak it, approve right here.
          </>
        ) : (
          <> — take a look.</>
        )}
      </p>
      <p className="muted" style={{ marginBottom: "var(--space-3)" }}>
        Quote {estimate.num}
      </p>

      {/* tier cards — hidden when only one real option remains */}
      {tiers.length > 1 && (
        <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
          {tiers.map((t) => {
            const isSel = t.k === sel;
            const isRec = t.k === rec;
            return (
              <button
                key={t.k}
                type="button"
                onClick={() => pickTier(t.k)}
                aria-pressed={isSel}
                style={{
                  flex: 1,
                  minWidth: 110,
                  cursor: "pointer",
                  border: `2px solid ${isSel ? brand.color : "var(--line)"}`,
                  borderRadius: "var(--radius)",
                  padding: "var(--space-3)",
                  textAlign: "center",
                  background: isSel ? "var(--green-50)" : "var(--card)",
                  color: "var(--ink)",
                  fontFamily: "inherit",
                }}
              >
                {isRec ? (
                  <div
                    style={{
                      fontSize: "var(--type-xs)",
                      fontWeight: 800,
                      letterSpacing: 0.6,
                      color: brand.color,
                      textTransform: "uppercase",
                    }}
                  >
                    recommended
                  </div>
                ) : null}
                <div style={{ fontWeight: 800, fontSize: "var(--type-md)" }}>{t.name}</div>
                <div style={{ fontWeight: 900, fontSize: "var(--type-lg)", marginTop: "var(--space-1)" }}>
                  {fmt$(calcQuote(t.lines, pricing).total)}
                </div>
                {/* deferred: financing "from $X/mo" hint */}
              </button>
            );
          })}
        </div>
      )}

      {/* the selected tier's fixed lines + its optional add-ons */}
      <CustLines lines={selTier.lines} />
      <CustAddons lines={selTier.lines} selected={selected} onToggle={toggle} />

      {/* totals for the selected tier (+ toggled add-ons) */}
      <CustTotals m={m} pricing={pricing} />
      {tiers.length > 1 && (
        <div className="muted" style={{ fontSize: "var(--type-sm)", textAlign: "right" }}>
          {selTier.name} option
        </div>
      )}

      {/* deferred: "Request a change" card */}

      {/* Not right now → reason picker (quiet, in-body — never in the foot) */}
      <DeclineBlock onDecline={onDecline} />

      <CustFooter />

      {/* Approve THE SELECTED TIER — THE terminal action, docked.
          deferred: on-glass signature. */}
      <div className="sheet-foot">
        <button className="sheet-pri" onClick={() => onApprove(selTier.k, finalLines)}>
          ✓ Approve {selTier.name} — {fmt$(m.total)}
        </button>
      </div>
    </>
  );
}

// ===========================================================================
//  THE MODAL BODY (prototype renderCust)
// ===========================================================================

export function CustQuoteModalContent() {
  const activeModal = useActiveModal();

  const estimates = useAppStore((s) => s.estimates);
  const leads = useAppStore((s) => s.leads);
  const brand = useAppStore((s) => s.brand);
  const updateEstimate = useAppStore((s) => s.updateEstimate);
  const adoptEstimate = useAppStore((s) => s.adoptEstimate);
  const declineEstimate = useAppStore((s) => s.declineEstimate);
  const moveLeadStage = useAppStore((s) => s.moveLeadStage);
  const updateLead = useAppStore((s) => s.updateLead);

  const estId = activeModal?.params?.estId as string | undefined;
  const estimate = estimates.find((x) => x.id === estId);

  // FETCH-ON-MISS. Estimates hydrate one page like everything else, and this sheet is opened from
  // the Pipeline rail and from links a customer follows — an empty render here is a quote that
  // "disappeared". adoptEstimate takes the DTO without firing a write.
  const missing = Boolean(estId) && !estimate;
  const estQ = api.v1.quoting.get.useQuery(
    { estimateId: estId ?? "" },
    { enabled: missing, staleTime: 30_000, refetchOnWindowFocus: false },
  );
  useEffect(() => {
    // fu is client-local follow-up state; a freshly fetched estimate has none yet.
    if (missing && estQ.data) adoptEstimate(estQ.data, { on: false, stage: 0 });
  }, [missing, estQ.data, adoptEstimate]);

  // This surface IS the customer's phone in the sample world. Opening it records
  // a read (live while the session is open — the Rail's breathing dot); closing
  // ends it. The customer's own view changes by zero pixels — they are never
  // told they were watched.
  useEffect(() => {
    if (estId == null) return;
    const s = useAppStore.getState();
    s.recordRead(estId, { when: clockNow(), daysAgo: 0, live: true });
    return () => useAppStore.getState().endRead(estId);
  }, [estId]);

  if (!estimate) {
    if (missing && estQ.isLoading) return <p className="muted">Loading…</p>;
    if (missing && estQ.isError) {
      return <p className="muted">Couldn&apos;t load this quote. Close and try again.</p>;
    }
    return null;
  }

  const lead = leads.find((l) => l.id === estimate.leadId);
  // Pre-accept GBB: the picker structure from the real tier-tagged lines.
  const tierViews = tierViewsFromEstimate(estimate);
  const isTieredUnresolved = Boolean(estimate.recommendedTier) && !estimate.acceptedTier;

  // approveQuote(id, fromCust): mark accepted, move the lead to Won.
  // The store update re-renders this view into the accepted confirmation state.
  // deferred: on-glass signature pad — the approval gesture is the signature.
  function approve(_total: number, selectedOptLines?: EstimateLine[]) {
    if (!estimate) return;
    // Fold any customer-selected optional add-ons into the accepted quote so the
    // accepted total reflects what they chose (prototype approveCust).
    // When selectedOptLines is non-empty, pass the full final line set (fixed +
    // selected add-ons) to updateEstimate. The slice converts store dollars to
    // cents and forwards them as the optional `lines` payload to v1.quoting.accept,
    // which commits them before marking the estimate accepted. The reconcile
    // callback then overwrites the optimistic state with the backend's canonical
    // accepted lines + computed total.
    if (selectedOptLines && selectedOptLines.length > 0) {
      const nextLines: EstimateLine[] = estimate.lines
        .filter((x) => !x.opt)
        .concat(selectedOptLines);
      updateEstimate(estimate.id, { status: "accepted", lines: nextLines });
    } else {
      updateEstimate(estimate.id, { status: "accepted" });
    }
    if (lead) moveLeadStage(lead.id, "Won");
  }

  // Tiered approve: commit ONE tier — its key + its resolved line set (fixed
  // lines + toggled add-ons, tags cleared). The slice forwards acceptedTier as
  // chosenTier to v1.quoting.accept, mirroring the public page's semantics.
  function approveTier(tier: QuoteTierKey, lines: EstimateLine[]) {
    if (!estimate) return;
    updateEstimate(estimate.id, { status: "accepted", acceptedTier: tier, lines });
    if (lead) moveLeadStage(lead.id, "Won");
  }

  // declineQuote(reason): mark declined, move the lead to Lost, record the reason.
  // Uses declineEstimate (not updateEstimate) — the dedicated action wired to
  // v1.quoting.decline, which requires an explicit reason string for persistence.
  function decline(reason: string) {
    if (!estimate) return;
    declineEstimate(estimate.id, reason);
    if (lead) {
      moveLeadStage(lead.id, "Lost");
      updateLead(lead.id, { lossReason: reason });
    }
  }

  return (
    <div>
      {/* Sticky sheet header — the brand block itself is untouched (it IS the
          identity); the .sheet-head wrapper only makes it stick. The shell
          renders the ✕. */}
      <div className="sheet-head">
        <CustHead brand={brand} />
      </div>
      <div className="custbody">
        {estimate.status === "accepted" ? (
          <>
            <ApprovedState />
            <CustFooter />
          </>
        ) : estimate.status === "declined" ? (
          <>
            <DeclinedState />
            <CustFooter />
          </>
        ) : tierViews ? (
          // Tiered path — pre-accept Good/Better/Best from the real store fields.
          // The path renders its own CustFooter + docked Approve foot.
          <TieredPath
            estimate={estimate}
            brand={brand}
            rec={tierViews.rec}
            tiers={tierViews.tiers}
            onApprove={approveTier}
            onDecline={decline}
          />
        ) : isTieredUnresolved ? (
          // Tiered estimate whose lines aren't loaded (or hold no fixed line):
          // rendering it flat would show a wrong total and Approve couldn't
          // carry a valid tier — say so instead of faking a quote.
          <>
            <div className="reqcard">
              Couldn&rsquo;t load the quote options — close this preview and
              reopen it from the quote.
            </div>
            <CustFooter />
          </>
        ) : (
          // Line-items path — single quotes + resolved tiered quotes.
          // The path renders its own CustFooter + docked Approve foot.
          <LineItemsPath
            estimate={estimate}
            brand={brand}
            onApprove={(total, selectedOptLines) => approve(total, selectedOptLines)}
            onDecline={decline}
          />
        )}
      </div>
    </div>
  );
}
