/**
 * components/modals/pricing/tech-quote-builder.tsx
 * The field on-site quote builder — extracted 1:1 from tech-quote-modal.tsx so
 * the SAME edit → present → sign machine renders in two homes:
 *   - the TECH_QUOTE modal (office "Price it on site →" — unchanged), and
 *   - the tech job view's Quote tab (estimating part 3), embedded in-flow.
 *
 * Faithful port of the prototype tech on-site quote builder in its TECH mode
 * (openTechQuote / tqRender with !fromCreate / tqSign / tqSigInit, prototype
 * 7230-7345) — the field screen where the tech prices a diagnosed repair, builds
 * Good/Better/Best, presents on glass, and captures the customer's signature.
 *
 * It is the SAME edit surface as the office single-tier PriceBuilderModal PLUS
 * three things the office one omits:
 *   (a) Good/Better/Best tiers + a "Give the customer choices?" opt-in
 *   (b) a "Present — on glass" tier-picker step (tqPresent / tqChoose)
 *   (c) an "Approve & sign" step with a real on-glass signature pad — commits
 *       the chosen tier via ONE v1.field.signQuote call (price + signature in
 *       the same transaction; part 1 records it as a real accepted estimate).
 *
 * Sheet grammar (#253): in the MODAL home every mode renders under a sticky
 * .sheet-head and docks its terminal action in a sticky .sheet-foot. EMBEDDED
 * (Quote tab), the host sheet already has its head (the customer), so the mode
 * headings render as in-flow .fsec-h lines instead — two stacked sticky heads
 * would fight for the same edge. The .sheet-foot stays: the host suppresses its
 * own foot while this builder is on screen, so there is still exactly ONE.
 *
 * All builder state is LOCAL React state (the prototype's global state.tq). The
 * store is read via raw selectors (jobs / leads / services / laborRates, never
 * derived in the selector); the only commit is signJobQuote at sign time.
 */

"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { SignaturePad } from "@/components/shared/signature-pad";
import { authorizationText } from "@/modules/quoting/domain/authorization-text";
import { useAppStore } from "@/lib/store/app-store";
import type { Service } from "@/lib/store/types";
import type { LaborRate as StoreLaborRate } from "@/lib/store/slices/settings-slice";
import {
  type AddSub,
  type BuildLine,
  type LaborRate,
  type PricebookItem,
  AddMenu,
  LineRow,
  custLabel,
  lineAmt,
  linesTotal,
  seedLines,
} from "./build-line";
import { fmt$ } from "@/lib/format";

// ---- tier model (prototype TQ_TIERS / state.tq) ----------------------------

type Tier = "good" | "better" | "best";

const TQ_TIERS: ReadonlyArray<readonly [Tier, string]> = [
  ["good", "Good"],
  ["better", "Better"],
  ["best", "Best"],
];

type TierLines = Record<Tier, BuildLine[]>;
type TierUse = Record<Tier, boolean>;

export type TechQuoteMode = "edit" | "present" | "sign";

/** Label for a tier (prototype TQ_TIERS lookup). */
function tierLabel(t: Tier): string {
  const found = TQ_TIERS.find(([k]) => k === t);
  return found ? found[1] : t;
}

/**
 * Mode heading. Modal home: the sticky .sheet-head frame. Embedded: an in-flow
 * section heading — the host sheet already owns the sticky head.
 */
function ModeHead({
  title,
  custName,
  embedded,
}: {
  title: string;
  custName: string;
  embedded: boolean;
}) {
  if (embedded) {
    return (
      <div className="fsec-h" style={{ marginTop: "var(--space-2)" }}>
        <span>{title}</span>
        <span className="muted" style={{ fontWeight: 500 }}>
          {custName}
        </span>
      </div>
    );
  }
  return (
    <div className="sheet-head">
      <h2>{title}</h2>
      <div className="sheet-meta">
        <span>Price the repair · {custName}</span>
      </div>
    </div>
  );
}

interface ChoicesRowProps {
  /** The cheaper tier is not yet opted into — offer it. */
  showGood: boolean;
  /** The premium tier is not yet opted into — offer it. */
  showBest: boolean;
  onAddGood: () => void;
  onAddBest: () => void;
}

/**
 * The good/better/best opt-in, drawn as ONE bordered row: the question and what it
 * buys on the left, "Set up →" on the right. It was a muted caption with two ghost
 * chips loose underneath it, which read as a stray fragment of the price block rather
 * than as a control.
 *
 * The AFFORDANCE is unchanged — the same two independent opt-ins, the same handlers,
 * the same place in the flow (under "+ Add a line", above the sticky primary). They
 * are one tap further in, expanded IN FLOW under the row (no floating UI) and rendered
 * OUTSIDE the head button so a button never nests inside a button — the same shape the
 * tech clock's expander uses.
 */
function ChoicesRow({ showGood, showBest, onAddGood, onAddBest }: ChoicesRowProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  return (
    <div className="tqchoice">
      <button
        type="button"
        className="jaddr"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        onClick={() => setOpen(!open)}
      >
        <span className="jaddr-t">
          Give the customer choices?
          <span className="jaddr-s">Add cheaper or premium options</span>
        </span>
        <span className="nav">Set up →</span>
      </button>
      {open ? (
        <div className="tqchoice-b" id={bodyId}>
          {showGood ? (
            <button className="chip ghost" onClick={onAddGood}>
              + Add a cheaper option
            </button>
          ) : null}
          {showBest ? (
            <button className="chip ghost" onClick={onAddBest}>
              + Add a premium option
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export interface TechQuoteBuilderProps {
  jobId: string | undefined;
  /** Called after a successful sign (and by nothing else) — the host decides where to land. */
  onSigned: () => void;
  /** In-flow inside another sheet (the Quote tab) — mode headings render in-flow, not sticky. */
  embedded?: boolean;
  /** Fires on every edit ⇄ present ⇄ sign transition so an embedding host can hide its
   *  surrounding sections while the phone is handed to the customer. */
  onModeChange?: (mode: TechQuoteMode) => void;
}

// ---- the builder ------------------------------------------------------------

export function TechQuoteBuilder({ jobId, onSigned, embedded = false, onModeChange }: TechQuoteBuilderProps) {
  const jobs = useAppStore((s) => s.jobs);
  const leads = useAppStore((s) => s.leads);
  const signJobQuote = useAppStore((s) => s.signJobQuote);
  const brand = useAppStore((s) => s.brand);
  const servicesRaw = useAppStore((s) => s.services);
  const laborRatesRaw = useAppStore((s) => s.laborRates);

  const pricebook: PricebookItem[] = useMemo(
    () =>
      [...servicesRaw]
        .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
        .map((svc: Service) => ({ d: svc.name, r: svc.unitPrice, c: svc.cost })),
    [servicesRaw],
  );
  const laborRates: LaborRate[] = useMemo(
    () => laborRatesRaw.map((r: StoreLaborRate) => ({ name: r.name, rate: r.rate, kind: r.kind })),
    [laborRatesRaw],
  );

  const job = jobs.find((j) => j.id === jobId);

  // ---- LOCAL builder state (prototype state.tq) -----------------------------
  // better is seeded from the job's existing lines; good/best start empty and
  // opt-in. `use.better` is always on. `picking` opens the add menu when better
  // has no seed lines. `mode` drives edit → present → sign.
  const seed = useMemo(() => (job ? seedLines(job) : []), [job]);

  const [tiers, setTiers] = useState<TierLines>(() => ({
    good: [],
    better: seed.map((l) => ({ ...l })),
    best: [],
  }));
  const [use, setUse] = useState<TierUse>({ good: false, better: true, best: false });
  const [tier, setTier] = useState<Tier>("better");
  const [mode, setMode] = useState<TechQuoteMode>("edit");
  const [chosen, setChosen] = useState<Tier | null>(null);
  const [picking, setPicking] = useState<boolean>(() => seed.length === 0);
  const [add, setAdd] = useState<AddSub>(null);
  // Surfaced when the on-site price fails to persist — the sign view stays open
  // so the tech can retry rather than closing on a lost price (no silent fail).
  const [signError, setSignError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  const [signerName, setSignerName] = useState("");
  const [signatureSvg, setSignatureSvg] = useState("");

  // Mode transitions notify the host (effect, not in-setter, so a re-render
  // during another component's render never fires a parent state update).
  useEffect(() => {
    onModeChange?.(mode);
  }, [mode, onModeChange]);

  if (!job) return null;

  const lead = leads.find((l) => l.id === job.leadId);
  const custName = custLabel(job, lead);

  const tierTotal = (t: Tier): number => linesTotal(tiers[t]);
  const multi = use.good || use.best; // tier chips appear once they opt into choices

  // ---- immutable tier-line ops (never mutate a line or tier array) ----------

  function setTierLines(t: Tier, next: (prev: BuildLine[]) => BuildLine[]) {
    setTiers((prev) => ({ ...prev, [t]: next(prev[t]) }));
  }

  function appendLine(l: BuildLine) {
    setTierLines(tier, (prev) => [...prev, l]);
  }

  function pickBook(item: PricebookItem) {
    appendLine({ kind: "book", d: item.d, amt: item.r, c: item.c ?? 0 });
  }

  function addCustom() {
    appendLine({ kind: "custom", d: "", amt: 0 });
    setAdd(null);
  }

  function pickRate(r: LaborRate) {
    if (r.kind === "flat_fee") {
      appendLine({ kind: "custom", d: r.name, amt: r.rate });
    } else {
      appendLine({ kind: "tm", d: "Labor", h: 1, rate: r.rate });
    }
  }

  function addCustomLabor() {
    appendLine({ kind: "tm", d: "Labor", h: 1, rate: 0 });
    setAdd(null);
  }

  function setLine(index: number, patch: Partial<BuildLine>) {
    setTierLines(tier, (prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeLine(index: number) {
    setTierLines(tier, (prev) => prev.filter((_, i) => i !== index));
  }

  // ---- tier ops (prototype tqTier / tqToggle) -------------------------------

  function selectTier(t: Tier) {
    setTier(t);
    setPicking(false);
  }

  // tqToggle — turning a tier on copies the current better lines into it (only
  // when empty) and switches to it; turning the active tier off reverts to better.
  function toggleTier(t: Tier) {
    if (t === "better") return;
    const turningOn = !use[t];
    setUse((prev) => ({ ...prev, [t]: turningOn }));
    if (turningOn) {
      setTiers((prev) => ({
        ...prev,
        [t]: prev[t].length ? prev[t] : prev.better.map((l) => ({ ...l })),
      }));
      setTier(t);
    } else if (tier === t) {
      setTier("better");
    }
  }

  // ---- present / choose (prototype tqPresent / tqChoose) --------------------

  const offered = TQ_TIERS.filter(([k]) => use[k] && tiers[k].length);

  function present() {
    if (offered.length <= 1) {
      const only = offered[0]?.[0] ?? "better";
      setChosen(only);
      setMode("sign");
    } else {
      setMode("present");
    }
    setPicking(false);
  }

  function choose(t: Tier) {
    setChosen(t);
    setMode("sign");
  }

  // ---- sign (prototype tqSign) ----------------------------------------------
  // Commit the chosen tier's lines + the signature via ONE v1.field.signQuote
  // call (same tx server-side; recorded as an accepted estimate by part 1).

  const chosenTier: Tier = chosen ?? "better";

  async function sign() {
    if (!job || signing) return;
    const name = signerName.trim();
    if (!name) {
      setSignError("Type the customer's name to sign.");
      return;
    }
    const jobLines = tiers[chosenTier]
      .map((l) => ({ d: l.d || "Repair", q: 1, r: lineAmt(l) }))
      .filter((l) => (l.r ?? 0) > 0);
    if (jobLines.length === 0) {
      setSignError("Add a price before signing.");
      return;
    }
    setSigning(true);
    setSignError(null);
    const { ok, error } = await signJobQuote(job.id, {
      lines: jobLines.map((l) => ({
        description: l.d,
        quantity: l.q ?? 1,
        rateCents: Math.round((l.r ?? 0) * 100),
        costCents: 0,
      })),
      signerName: name,
      // Omitted when nothing was drawn: the typed name IS the signature, and "" would be a
      // different, emptier record than "they signed without drawing".
      ...(signatureSvg ? { signatureSvg } : {}),
    });
    setSigning(false);
    if (!ok) {
      setSignError(error ?? "Couldn't save the signature — check your connection and try again.");
      return;
    }
    onSigned();
  }

  const anyPriced = tierTotal("better") > 0 || tierTotal("good") > 0 || tierTotal("best") > 0;

  // ---- SIGN mode ------------------------------------------------------------
  if (mode === "sign") {
    const signLines = tiers[chosenTier];
    const total = tierTotal(chosenTier);
    return (
      <>
        <ModeHead title="Approve & sign" custName={custName} embedded={embedded} />

        <div className="card" style={{ background: "var(--manila)" }}>
          {signLines.map((l, i) => (
            <div
              key={i}
              style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--type-base)", padding: "var(--space-1) 0" }}
            >
              <span>{l.d || "Repair"}</span>
              <b className="fig">{fmt$(lineAmt(l))}</b>
            </div>
          ))}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontWeight: 800,
              fontSize: "var(--type-lg)",
              borderTop: "1px solid var(--manila-line)",
              marginTop: "var(--space-2)",
              paddingTop: "var(--space-2)",
            }}
          >
            <span>Total</span>
            <span className="fig">{fmt$(total)}</span>
          </div>
        </div>

        {/* The sentence the customer is agreeing to — rendered from the SAME function the server
            stores, so the words on the tablet and the words in the record cannot diverge. */}
        <div
          className="muted"
          style={{ fontSize: "var(--type-sm)", margin: "var(--space-4) 0 var(--space-3)", lineHeight: 1.55 }}
        >
          {authorizationText({ totalCents: Math.round(total * 100), orgName: brand.name })}
        </div>

        <label
          htmlFor="tq-signer-name"
          style={{ display: "block", fontSize: "var(--type-sm)", fontWeight: 700, marginBottom: "var(--space-1)" }}
        >
          Customer&rsquo;s full name
        </label>
        <input
          id="tq-signer-name"
          type="text"
          value={signerName}
          maxLength={120}
          autoComplete="off"
          disabled={signing}
          onChange={(ev) => {
            setSignerName(ev.target.value);
            if (signError) setSignError(null);
          }}
          style={{
            width: "100%",
            border: "1.5px solid var(--line)",
            borderRadius: "var(--radius-sm)",
            padding: "var(--space-2) var(--space-3)",
            fontFamily: "inherit",
            fontSize: "var(--type-base)",
            background: "var(--card)",
            color: "var(--ink)",
            boxSizing: "border-box",
            marginBottom: "var(--space-3)",
          }}
        />

        <span style={{ display: "block", fontSize: "var(--type-sm)", fontWeight: 700, marginBottom: "var(--space-1)" }}>
          Customer signature
        </span>
        {/* The same pad the web quote page uses, so one stored format renders in one viewer. */}
        <SignaturePad
          value={signatureSvg}
          disabled={signing}
          aria-label="Customer signature"
          onChange={(svg) => {
            setSignatureSvg(svg);
            if (signError) setSignError(null);
          }}
        />

        {signError ? (
          <p style={{ color: "var(--red)", fontSize: "var(--type-base)", margin: "var(--space-3) 0 0" }}>{signError}</p>
        ) : null}

        {/* Sticky foot — ONE filled primary (the on-glass accept, the flow's
            terminal confirm); Back stays a quiet ghost beside it. */}
        <div className="sheet-foot" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <button
            className="btn ghost"
            onClick={() => setMode(offered.length > 1 ? "present" : "edit")}
            disabled={signing}
            style={{ flexShrink: 0 }}
          >
            ← Back
          </button>
          <button
            className="sheet-pri"
            onClick={sign}
            disabled={signing}
            style={{ flex: 1, opacity: signing ? 0.45 : undefined }}
          >
            {signing ? "Saving…" : `Accept & sign — ${fmt$(total)}`}
          </button>
        </div>
      </>
    );
  }

  // ---- PRESENT mode ---------------------------------------------------------
  if (mode === "present") {
    const firstName = custName.split(" ")[0] ?? custName;
    return (
      <>
        <ModeHead title="Present — on glass" custName={custName} embedded={embedded} />
        <div className="muted" style={{ fontSize: "var(--type-base)", marginBottom: "var(--space-3)" }}>
          Hand {firstName} the {embedded ? "phone" : "tablet"} — they pick:
        </div>

        {offered.length ? (
          offered.map(([k, lbl]) => (
            <div
              key={k}
              className="card clickable"
              onClick={() => choose(k)}
              style={{
                marginBottom: "var(--space-2)",
                cursor: "pointer",
                ...(k === "better" ? { borderColor: "var(--green-600)" } : {}),
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <b>
                  {lbl}
                  {k === "better" ? " · recommended" : ""}
                </b>
                <b>{fmt$(tierTotal(k))}</b>
              </div>
              <div className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-2xs)" }}>
                {tiers[k].map((l) => l.d || "Repair").join(" · ")}
              </div>
            </div>
          ))
        ) : (
          <div className="muted">Nothing priced yet.</div>
        )}

        {/* No .sheet-foot here on purpose: the tier cards above are equal peer
            choices — there is no single terminal action to promote. */}
        <div style={{ textAlign: "right", marginTop: "var(--space-2)" }}>
          <button className="btn" onClick={() => setMode("edit")}>
            ← Back to edit
          </button>
        </div>
      </>
    );
  }

  // ---- EDIT mode ------------------------------------------------------------
  const lines = tiers[tier];

  const tierChips = TQ_TIERS.filter(([k]) => k === "better" || use[k]);
  const showGoodOpt = !use.good;
  const showBestOpt = !use.best;

  return (
    <>
      {/* Embedded, the Quote tab's own "The price" section header frames the edit
          surface — a second "Build the price" heading would say it twice. */}
      {!embedded && <ModeHead title="Build the price" custName={custName} embedded={false} />}

      {/* tier chips (only better + opted-in tiers; each shows label · $total) */}
      {multi ? (
        <div className="chips" style={{ marginBottom: "var(--space-3)" }}>
          {tierChips.map(([k, lbl]) => {
            const t = tierTotal(k);
            return (
              <button
                key={k}
                className={`chip ${tier === k ? "sel" : ""}`}
                onClick={() => selectTier(k)}
              >
                {lbl}
                {t ? ` · ${fmt$(t)}` : ""}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* the current tier's line list + a per-tier Total */}
      {lines.length ? (
        <div className="card" style={{ marginBottom: "var(--space-4)" }}>
          {lines.map((l, i) => (
            <LineRow
              key={i}
              line={l}
              onSet={(patch) => setLine(i, patch)}
              onRemove={() => removeLine(i)}
            />
          ))}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontWeight: 800,
              fontSize: "var(--type-lg)",
              borderTop: "1px solid var(--line)",
              marginTop: "var(--space-2)",
              paddingTop: "var(--space-2)",
            }}
          >
            <span>{multi ? `${tierLabel(tier)} total` : "Total"}</span>
            <span className="fig">{fmt$(tierTotal(tier))}</span>
          </div>
        </div>
      ) : null}

      {/* "+ Add a line" — open menu (picking) or the collapsed entry button */}
      {picking ? (
        <AddMenu
          sub={add}
          hasLines={lines.length > 0}
          pricebook={pricebook}
          laborRates={laborRates}
          onSetSub={setAdd}
          onPickBook={pickBook}
          onAddCustom={addCustom}
          onPickRate={pickRate}
          onAddCustomLabor={addCustomLabor}
          onDone={() => setPicking(false)}
        />
      ) : (
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <button
            className="btn"
            onClick={() => {
              setAdd(null);
              setPicking(true);
            }}
          >
            + Add a line
          </button>
        </div>
      )}

      {/* "Give the customer choices?" — once anything is priced and not all opted */}
      {anyPriced && (showGoodOpt || showBestOpt) ? (
        <ChoicesRow
          showGood={showGoodOpt}
          showBest={showBestOpt}
          onAddGood={() => toggleTier("good")}
          onAddBest={() => toggleTier("best")}
        />
      ) : null}

      {/* Sticky foot — ONE filled primary docked where the thumb is: present to
          customer (single) / present options (multi). */}
      <div className="sheet-foot">
        <button
          className="sheet-pri"
          onClick={present}
          disabled={!anyPriced}
          style={anyPriced ? undefined : { opacity: 0.45 }}
        >
          {multi ? "Present options →" : "Present to customer →"}
        </button>
      </div>
    </>
  );
}
