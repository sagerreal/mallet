/**
 * components/modals/cust-quote-modal.tsx
 * Faithful port of the prototype's openCust (7898) / renderCust (8027) /
 * renderCustGbb (7951) — the CUSTOMER-facing quote page, i.e. what the customer
 * sees when they open a quote link to review, tune, and approve/decline it.
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
 * Two render paths, mirroring renderCust's branch:
 *   • GBB tier path (renderCustGbb) — only when the estimate carries a `gbb`
 *     tier draft. The store's Estimate type has NO `gbb` field (tiers aren't
 *     persisted), so this is gated on an optional cast and will NOT render for
 *     our sample data — expected. Built and ready for when tiers are modeled.
 *   • Line-items path (the primary path for our data) — `.custline` rows, opt
 *     lines as toggleable `.addonrow` add-ons, running total via calcQuote.
 *
 * DEFERRED (see `// deferred` markers): on-glass signature pad, financing
 * "from $X/mo", join-a-plan add-on, and the "request a change" card.
 */

"use client";

import { useEffect, useState } from "react";
import { useActiveModal, useAppStore } from "@/lib/store/app-store";
import { calcQuote } from "@/lib/prototype-sample";
import type { Brand, Estimate, EstimateLine } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";
import { clockNow } from "@/features/home/send";

// ---- money helper (ported 1:1 from prototype fmt$) --------------------------


// ---- GBB tier shape (prototype e.gbb — not persisted in the store) ----------
//
// The store's Estimate has no `gbb` field; a quote that carries tiers would
// shape like this. We read it through an optional cast so the tier path is
// ready without forcing the store type to grow a field it never fills today.

interface GbbTierLine {
  d: string;
  q?: number;
  r?: number;
  tune?: boolean;
}

interface GbbTier {
  k: "good" | "better" | "best";
  name: string;
  title: string;
  lines: GbbTierLine[];
}

interface GbbDraft {
  rec: "good" | "better" | "best";
  opts: GbbTier[];
}

/** Read the optional, non-persisted `gbb` tier draft off an estimate. */
function readGbb(estimate: Estimate): GbbDraft | undefined {
  return (estimate as Estimate & { gbb?: GbbDraft }).gbb;
}

/** gbbTierTotal — sum of a tier's line amounts (prototype gbbTierTotal). */
function gbbTierTotal(tier: GbbTier): number {
  return tier.lines.reduce((s, x) => s + (x.q ?? 1) * (x.r ?? 0), 0);
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
        <div style={{ fontWeight: 800, fontSize: 16 }}>{brand.name}</div>
        <div style={{ fontSize: 11.5, opacity: 0.8 }}>{brand.tagline}</div>
      </div>
      {/* ModalHost provides close — no duplicate custCloseBtn() ✕ here. */}
    </div>
  );
}

// ===========================================================================
//  FOOTER (prototype §"Powered by Mallet")
// ===========================================================================

function CustFooter() {
  return (
    <p className="muted" style={{ fontSize: 10.5, textAlign: "center", marginTop: 12 }}>
      Powered by Mallet — licensed &amp; insured
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
    <div style={{ textAlign: "center", marginTop: 10 }}>
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
//  LINE-ITEMS PATH (prototype renderCust — the primary path for our data)
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
 * so the total reacts.
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
        gap: 4,
        padding: "14px 0 4px",
      }}
    >
      {pricing.disc || pricing.tax ? (
        <div className="muted" style={{ fontSize: 12.5 }}>
          Subtotal {fmt$(m.sub)}
        </div>
      ) : null}
      {pricing.disc ? (
        <div className="muted" style={{ fontSize: 12.5 }}>
          Discount {pricing.disc}% −{fmt$(m.disc)}
        </div>
      ) : null}
      {pricing.tax ? (
        <div className="muted" style={{ fontSize: 12.5 }}>
          Tax {pricing.tax}% +{fmt$(m.taxed)}
        </div>
      ) : null}
      <div style={{ fontWeight: 900, fontSize: 19 }}>Total {fmt$(m.total)}</div>
      {pricing.dep ? (
        <div className="muted" style={{ fontSize: 12 }}>
          {fmt$(m.dep)} deposit due today · the rest when the job&rsquo;s done
        </div>
      ) : null}
    </div>
  );
}

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
      <p style={{ fontSize: 13.5, lineHeight: 1.55, marginBottom: 6 }}>
        Here&rsquo;s your quote from <b>{brand.name}</b> — take a look.
      </p>
      <p className="muted" style={{ marginBottom: 8 }}>
        Quote {estimate.num}
      </p>

      {/* fixed line rows */}
      <CustLines lines={estimate.lines} />

      {/* optional add-ons the customer can toggle on */}
      <CustAddons lines={estimate.lines} selected={selected} onToggle={toggle} />

      {/* deferred: join-a-plan add-on row (needs plans model) */}

      {/* totals rollup */}
      <CustTotals m={m} pricing={pricing} />

      {/* Approve — prominent primary button. deferred: on-glass signature. */}
      <button
        className="btn primary"
        style={{ width: "100%", padding: 13, fontSize: 14.5, marginTop: 6 }}
        onClick={() => onApprove(m.total, selectedOptLines)}
      >
        Approve — {fmt$(m.total)}
      </button>

      {/* deferred: "Request a change" ghost button + card */}

      {/* Not right now → reason picker */}
      <DeclineBlock onDecline={onDecline} />
    </>
  );
}

// ===========================================================================
//  GBB TIER PATH (prototype renderCustGbb) — gated; won't render for our data
// ===========================================================================

interface GbbPathProps {
  gbb: GbbDraft;
  brand: Brand;
  estimate: Estimate;
  onApprove: (total: number) => void;
  onDecline: (reason: string) => void;
}

function GbbPath({ gbb, brand, estimate, onApprove, onDecline }: GbbPathProps) {
  // Selected tier (defaults to recommended) + tunable lines toggled OFF + adds
  // pulled from the tier above (prototype custSel.gbbSel / gbbOff / gbbAdd).
  const [sel, setSel] = useState<GbbDraft["rec"]>(gbb.rec);
  const [offs, setOffs] = useState<Record<string, boolean>>({});
  const [adds, setAdds] = useState<Record<string, boolean>>({});

  const order: readonly GbbDraft["rec"][] = ["good", "better", "best"];
  const idx = order.indexOf(sel);
  const selOpt = gbb.opts.find((o) => o.k === sel);
  const above = idx >= 0 && idx < 2 ? gbb.opts.find((o) => o.k === order[idx + 1]) : undefined;

  if (!selOpt) return null;

  const selKeys = new Set(selOpt.lines.map((x) => x.d));
  const addable: GbbTierLine[] = above
    ? above.lines.filter((x) => !selKeys.has(x.d) && x.tune)
    : [];

  let total = selOpt.lines.reduce(
    (s, x) => s + (offs[x.d] ? 0 : (x.q ?? 1) * (x.r ?? 0)),
    0
  );
  addable.forEach((x) => {
    if (adds[x.d]) total += (x.q ?? 1) * (x.r ?? 0);
  });

  function pickTier(k: GbbDraft["rec"]) {
    setSel(k);
    setOffs({});
    setAdds({});
  }

  return (
    <>
      <p style={{ fontSize: 13.5, lineHeight: 1.55, marginBottom: 6 }}>
        Here&rsquo;s your quote from <b>{brand.name}</b> — here are{" "}
        <b>three ways to do this</b>. Pick one, tweak it, approve right here.
      </p>
      <p className="muted" style={{ marginBottom: 10 }}>
        Quote {estimate.num}
      </p>

      {/* tier cards — Good / Better / Best, "most popular" on the recommended */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {gbb.opts.map((o) => {
          const isSel = o.k === sel;
          const isRec = gbb.rec === o.k;
          return (
            <div
              key={o.k}
              onClick={() => pickTier(o.k)}
              style={{
                flex: 1,
                minWidth: 110,
                cursor: "pointer",
                border: `2px solid ${isSel ? brand.color : "var(--line)"}`,
                borderRadius: 12,
                padding: 11,
                textAlign: "center",
                ...(isSel ? { background: "var(--green-50)" } : {}),
              }}
            >
              {isRec ? (
                <div
                  style={{
                    fontSize: 9.5,
                    fontWeight: 800,
                    letterSpacing: 0.6,
                    color: brand.color,
                    textTransform: "uppercase",
                  }}
                >
                  most popular
                </div>
              ) : null}
              <div style={{ fontWeight: 800, fontSize: 14 }}>{o.name}</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {o.title}
              </div>
              <div style={{ fontWeight: 900, fontSize: 16.5, marginTop: 3 }}>
                {fmt$(gbbTierTotal(o))}
              </div>
              {/* deferred: financing "from $X/mo" hint */}
            </div>
          );
        })}
      </div>

      {/* selected tier's lines — tunable ones as toggles, rest as custline rows */}
      {selOpt.lines.map((x, i) =>
        x.tune ? (
          <label key={i} className="addonrow">
            <input
              type="checkbox"
              checked={!offs[x.d]}
              onChange={(e) =>
                setOffs((prev) => ({ ...prev, [x.d]: !e.target.checked }))
              }
            />
            <span style={{ flex: 1 }}>{x.d}</span>
            <b>{fmt$((x.q ?? 1) * (x.r ?? 0))}</b>
          </label>
        ) : (
          <div key={i} className="custline">
            <span>
              {x.d}
              {(x.q ?? 1) !== 1 ? ` × ${x.q}` : ""}
            </span>
            <b>{fmt$((x.q ?? 1) * (x.r ?? 0))}</b>
          </div>
        )
      )}

      {/* add-ons pulled down from the tier above */}
      {addable.map((x, i) => (
        <label
          key={i}
          className="addonrow"
          style={{ borderColor: "var(--manila-line)", background: "#FFFBEF" }}
        >
          <input
            type="checkbox"
            checked={!!adds[x.d]}
            onChange={(e) => setAdds((prev) => ({ ...prev, [x.d]: e.target.checked }))}
          />
          <span style={{ flex: 1 }}>
            <b>Add from {above ? above.name : ""}:</b> {x.d}
          </span>
          <b>+{fmt$((x.q ?? 1) * (x.r ?? 0))}</b>
        </label>
      ))}

      {/* running total for the tuned tier */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 4,
          padding: "14px 0 4px",
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 19 }}>Total {fmt$(total)}</div>
        <div className="muted" style={{ fontSize: 11.5 }}>
          {selOpt.name} — {selOpt.title}
          {Object.values(offs).some(Boolean) || Object.values(adds).some(Boolean)
            ? " · tuned by you"
            : ""}
        </div>
      </div>

      {/* Approve the selected tier. deferred: on-glass signature. */}
      <button
        className="btn primary"
        style={{ width: "100%", padding: 13, fontSize: 14.5, marginTop: 6 }}
        onClick={() => onApprove(total)}
      >
        ✓ Approve {selOpt.name} — {fmt$(total)}
      </button>

      {/* deferred: "Request a change" card */}

      {/* Not right now → reason picker */}
      <DeclineBlock onDecline={onDecline} />
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
  const declineEstimate = useAppStore((s) => s.declineEstimate);
  const moveLeadStage = useAppStore((s) => s.moveLeadStage);
  const updateLead = useAppStore((s) => s.updateLead);

  const estId = activeModal?.params?.estId as string | undefined;
  const estimate = estimates.find((x) => x.id === estId);

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

  if (!estimate) return null;

  const lead = leads.find((l) => l.id === estimate.leadId);
  const gbb = readGbb(estimate);
  const isDone = estimate.status === "accepted" || estimate.status === "declined";

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
      <CustHead brand={brand} />
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
        ) : gbb && !isDone ? (
          // GBB tier path — only when the estimate carries a `gbb` tier draft.
          // The store never persists this, so it won't render for sample data.
          <>
            <GbbPath
              gbb={gbb}
              brand={brand}
              estimate={estimate}
              onApprove={(total) => approve(total)}
              onDecline={decline}
            />
            <CustFooter />
          </>
        ) : (
          // Line-items path — the primary path for our data.
          <>
            <LineItemsPath
              estimate={estimate}
              brand={brand}
              onApprove={(total, selectedOptLines) => approve(total, selectedOptLines)}
              onDecline={decline}
            />
            <CustFooter />
          </>
        )}
      </div>
    </div>
  );
}
