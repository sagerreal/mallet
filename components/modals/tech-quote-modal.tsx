/**
 * components/modals/tech-quote-modal.tsx
 * Faithful port of the prototype tech on-site quote builder in its TECH mode
 * (openTechQuote / tqRender with !fromCreate / tqSign / tqSigInit, prototype
 * 7230-7345) — the field screen where the tech prices a diagnosed repair, builds
 * Good/Better/Best, presents on glass, and captures the customer's signature.
 *
 * It is the SAME edit surface as the office single-tier PriceBuilderModal PLUS
 * three things the office one omits:
 *   (a) Good/Better/Best tiers + a "Give the customer choices?" opt-in
 *   (b) a "Present — on glass" tier-picker step (tqPresent / tqChoose)
 *   (c) an "Approve & sign" step with a real on-glass signature canvas (tqSign /
 *       tqSigInit) — commits the chosen tier + approvedOnSite on accept.
 *
 * All builder state is LOCAL React state (the prototype's global state.tq). The
 * store is read via raw selectors (jobs / leads / services / laborRates, never
 * derived in the selector); the only commit is updateJob at sign time.
 */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore, useActiveModal, useCloseModal, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { JobLine, Service } from "@/lib/store/types";
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
} from "./pricing/build-line";
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

type Mode = "edit" | "present" | "sign";

/** Label for a tier (prototype TQ_TIERS lookup). */
function tierLabel(t: Tier): string {
  const found = TQ_TIERS.find(([k]) => k === t);
  return found ? found[1] : t;
}

// ---- signature pad (prototype tqSigInit / tqSigHint / tqSigClear) -----------
// A <canvas> the customer signs on glass. A once-on-mount effect draws the hint
// (baseline + "✕ Sign here"), tracks a signedRef, and wires mouse + touch draw
// handlers (client coords → canvas coords via getBoundingClientRect scale, like
// the prototype pos()). On the first stroke it clears the hint. clear() redraws
// the hint and resets signed. Listeners are cleaned up on unmount.

const SIG_W = 560;
const SIG_H = 150;

interface SignaturePadProps {
  onClearRef: (clear: () => void) => void;
}

function SignaturePad({ onClearRef }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const signedRef = useRef(false);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const W = c.width;
    const H = c.height;

    // hint — a light baseline near the bottom + "✕" + "Sign here" (tqSigHint).
    const drawHint = () => {
      ctx.clearRect(0, 0, W, H);
      signedRef.current = false;
      ctx.strokeStyle = "#D9CEB8";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(34, H - 30);
      ctx.lineTo(W - 34, H - 30);
      ctx.stroke();
      ctx.fillStyle = "#B9AE93";
      ctx.font = '600 15px "Space Mono",monospace';
      ctx.fillText("✕", 34, H - 37);
      ctx.fillStyle = "#C4B99E";
      ctx.font = "13px Inter,system-ui,sans-serif";
      ctx.fillText("Sign here", 56, H - 36);
    };

    drawHint();
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    let drawing = false;

    // map a mouse/touch event to canvas coordinates (prototype pos()).
    const pos = (e: MouseEvent | TouchEvent) => {
      const r = c.getBoundingClientRect();
      const t = "touches" in e && e.touches.length ? e.touches[0]! : (e as MouseEvent);
      return {
        x: (t.clientX - r.left) * (W / (r.width || W)),
        y: (t.clientY - r.top) * (H / (r.height || H)),
      };
    };

    const start = (e: MouseEvent | TouchEvent) => {
      if (!signedRef.current) {
        ctx.clearRect(0, 0, W, H);
        signedRef.current = true;
      }
      drawing = true;
      ctx.strokeStyle = "#2B2720";
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      if (e.cancelable) e.preventDefault();
    };

    const move = (e: MouseEvent | TouchEvent) => {
      if (!drawing) return;
      const p = pos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      if (e.cancelable) e.preventDefault();
    };

    const end = () => {
      drawing = false;
    };

    c.addEventListener("mousedown", start);
    c.addEventListener("mousemove", move);
    c.addEventListener("mouseup", end);
    c.addEventListener("mouseleave", end);
    c.addEventListener("touchstart", start, { passive: false });
    c.addEventListener("touchmove", move, { passive: false });
    c.addEventListener("touchend", end);

    // expose clear() to the parent so the "Clear" link can reset the pad.
    onClearRef(drawHint);

    return () => {
      c.removeEventListener("mousedown", start);
      c.removeEventListener("mousemove", move);
      c.removeEventListener("mouseup", end);
      c.removeEventListener("mouseleave", end);
      c.removeEventListener("touchstart", start);
      c.removeEventListener("touchmove", move);
      c.removeEventListener("touchend", end);
    };
  }, [onClearRef]);

  return (
    <canvas
      ref={canvasRef}
      width={SIG_W}
      height={SIG_H}
      style={{
        display: "block",
        width: "100%",
        border: "1.5px solid var(--line)",
        borderRadius: "var(--radius)",
        background: "#fff",
        touchAction: "none",
        cursor: "crosshair",
      }}
    />
  );
}

// ---- eyebrow (prototype tqRender head, TECH mode) --------------------------

interface EyebrowProps {
  custName: string;
}

function Eyebrow({ custName }: EyebrowProps) {
  return (
    <>
      <div
        className="muted"
        style={{
          fontSize: "var(--type-xs)",
          fontWeight: 800,
          letterSpacing: ".05em",
          textTransform: "uppercase",
          color: "var(--green-700)",
        }}
      >
        Price the repair · {custName}
      </div>
    </>
  );
}

// ---- the modal body --------------------------------------------------------

export function TechQuoteModalContent() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const openModal = useOpenModal();
  const jobs = useAppStore((s) => s.jobs);
  const leads = useAppStore((s) => s.leads);
  const setJobLines = useAppStore((s) => s.setJobLines);
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

  const jobId = activeModal?.params?.jobId as string | undefined;
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
  const [mode, setMode] = useState<Mode>("edit");
  const [chosen, setChosen] = useState<Tier | null>(null);
  const [picking, setPicking] = useState<boolean>(() => seed.length === 0);
  const [add, setAdd] = useState<AddSub>(null);
  // Surfaced when the on-site price fails to persist — the sign view stays open
  // so the tech can retry rather than closing on a lost price (no silent fail).
  const [signError, setSignError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  // clear() handle from the signature pad — wired to the "Clear" link.
  const sigClearRef = useRef<() => void>(() => {});
  const setSigClear = (fn: () => void) => {
    sigClearRef.current = fn;
  };

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
  // Commit the chosen tier's lines to the job + approvedOnSite, then close.

  const chosenTier: Tier = chosen ?? "better";

  // Close back to the tech job view it was opened from (prototype tqClose → openJob).
  function returnToJob() {
    if (job) openModal(MODAL.TECH_JOB, { jobId: job.id });
    else close();
  }

  // Persist the chosen tier's lines to the job (v1.jobs.setLines) BEFORE closing.
  // The lines are the on-site price; they must survive the post-"Mark done"
  // refetch, so we await the write and only return to the job on success —
  // "approved on site" is derived from the job carrying lines (no DB flag).
  async function sign() {
    if (!job || signing) return;
    const jobLines: JobLine[] = tiers[chosenTier]
      .map((l) => ({ d: l.d || "Repair", q: 1, r: lineAmt(l) }))
      .filter((l) => (l.r ?? 0) > 0);
    setSigning(true);
    setSignError(null);
    const { ok } = await setJobLines(job.id, jobLines);
    setSigning(false);
    if (!ok) {
      setSignError("Couldn't save the price — check your connection and try again.");
      return;
    }
    returnToJob();
  }

  const anyPriced = tierTotal("better") > 0 || tierTotal("good") > 0 || tierTotal("best") > 0;

  // ---- SIGN mode ------------------------------------------------------------
  if (mode === "sign") {
    const signLines = tiers[chosenTier];
    const total = tierTotal(chosenTier);
    return (
      <div>
        <Eyebrow custName={custName} />
        <h2>Approve &amp; sign</h2>

        <div className="card" style={{ background: "var(--manila)" }}>
          {signLines.map((l, i) => (
            <div
              key={i}
              style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--type-base)", padding: "3px 0" }}
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
              marginTop: 6,
              paddingTop: 6,
            }}
          >
            <span>Total</span>
            <span className="fig">{fmt$(total)}</span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            margin: "15px 0 5px",
          }}
        >
          <span style={{ fontSize: "var(--type-sm)", fontWeight: 700 }}>Customer signature</span>
          <span className="linklike" style={{ fontSize: "var(--type-sm)" }} onClick={() => sigClearRef.current()}>
            Clear
          </span>
        </div>

        <SignaturePad onClearRef={setSigClear} />

        <div className="muted" style={{ fontSize: 11.5, marginTop: "var(--space-2)", lineHeight: 1.5 }}>
          <b>{custName}</b> — by signing, you approve the work above and authorize{" "}
          <b className="fig">{fmt$(total)}</b> on this visit. A copy is texted to you on the spot.
        </div>

        {signError ? (
          <p style={{ color: "var(--red)", fontSize: 12.5, margin: "10px 0 0" }}>{signError}</p>
        ) : null}

        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginTop: 14, gap: "var(--space-2)" }}>
          <button className="btn" onClick={() => setMode(offered.length > 1 ? "present" : "edit")} disabled={signing}>
            ← Back
          </button>
          <button className="btn primary" onClick={sign} disabled={signing}>
            {signing ? "Saving…" : `Accept & sign — ${fmt$(total)}`}
          </button>
        </div>
      </div>
    );
  }

  // ---- PRESENT mode ---------------------------------------------------------
  if (mode === "present") {
    const firstName = custName.split(" ")[0] ?? custName;
    return (
      <div>
        <Eyebrow custName={custName} />
        <h2>Present — on glass</h2>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
          Hand {firstName} the tablet — they pick:
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
              <div className="muted" style={{ fontSize: "var(--type-sm)", marginTop: 2 }}>
                {tiers[k].map((l) => l.d || "Repair").join(" · ") || "—"}
              </div>
            </div>
          ))
        ) : (
          <div className="muted">Nothing priced yet.</div>
        )}

        <div style={{ textAlign: "right", marginTop: 6 }}>
          <button className="btn" onClick={() => setMode("edit")}>
            ← Back to edit
          </button>
        </div>
      </div>
    );
  }

  // ---- EDIT mode ------------------------------------------------------------
  const lines = tiers[tier];

  const tierChips = TQ_TIERS.filter(([k]) => k === "better" || use[k]);
  const showGoodOpt = !use.good;
  const showBestOpt = !use.best;

  return (
    <div>
      <Eyebrow custName={custName} />
      <h2 style={{ marginBottom: 14 }}>Build the price</h2>

      {/* tier chips (only better + opted-in tiers; each shows label · $total) */}
      {multi ? (
        <div className="chips" style={{ marginBottom: 10 }}>
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
        <div className="card" style={{ marginBottom: 14 }}>
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
              fontSize: 16,
              borderTop: "1px solid var(--line)",
              marginTop: "var(--space-2)",
              paddingTop: 9,
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
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginTop: "var(--space-4)", flexWrap: "wrap" }}>
          <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
            Give the customer choices?
          </span>
          {showGoodOpt ? (
            <button className="chip ghost" onClick={() => toggleTier("good")}>
              + Add a cheaper option
            </button>
          ) : null}
          {showBestOpt ? (
            <button className="chip ghost" onClick={() => toggleTier("best")}>
              + Add a premium option
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Footer — present to customer (single) / present options (multi) */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
        <button
          className="btn primary"
          onClick={present}
          disabled={!anyPriced}
          style={anyPriced ? undefined : { opacity: 0.45 }}
        >
          {multi ? "Present options →" : "Present to customer →"}
        </button>
      </div>
    </div>
  );
}
