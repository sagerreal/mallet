/**
 * components/modals/price-builder-modal.tsx
 * Faithful port of the prototype tech-quote builder (openTechQuote / tqRender /
 * tqSavePrice, prototype 7230-7339) in its OFFICE single-tier mode — the same
 * builder the crew uses, opened from the job's "Build the price" / "Edit" via
 * jobBuildPrice(id) which sets state.tq.fromCreate=true (prototype 4511).
 *
 * OFFICE single-tier mode (fromCreate=true) renders:
 *   - the eyebrow "PRICE THE JOB · <customer>" + <h2>Build the price</h2>
 *   - the built line list (.card) with per-line editable rows + a per-tier Total
 *   - the "+ Add a line" builder: a 2×2 .addgrid of .addtile tiles
 *       Pricebook (browse saved items) · Custom item (one-off price)
 *       Labor    (browse your rates $/hr) · Custom labor (one-off $/hr)
 *     browsing a sublist stays open while building (adding does NOT collapse it)
 *   - the footer "Save price →" (tqSavePrice) → updateJob(jobId, { lines })
 *
 * OUT OF SCOPE — correctly, for office single-tier mode (fromCreate=true):
 *   - the Good/Better/Best tier selector + the "Give the customer choices?"
 *     opt-in (prototype gates both on !tq.fromCreate) — office pricing is
 *     single-tier, so no tier chips and no per-tier tabs.
 *   - the "Present → / on glass" flow and the customer signature / sign sheet
 *     (tqPresent / tqSign / tqSigInit) — that is the crew's customer-facing
 *     path, never the office save path.
 */

"use client";

import { useState } from "react";
import { useAppStore, useActiveModal, useCloseModal } from "@/lib/store/app-store";
import type { Job, JobLine, Lead } from "@/lib/store/types";

// ---- local reference data (prototype state.pricebook / state.laborRates) ----
// PRICEBOOK mirrors the composer page's local const shape { d, r }; the office
// keeps margin via cost, so pricebook picks carry a cost `c` when present.

interface PricebookItem {
  d: string;
  r: number;
  c?: number;
}

const PRICEBOOK: ReadonlyArray<PricebookItem> = [
  { d: "40-gal gas water heater (Rheem Performance)", r: 1650 },
  { d: "Remove & haul away existing unit", r: 150 },
  { d: "Expansion tank + seismic straps (code)", r: 385 },
  { d: "Hydro-jet kitchen drain line", r: 450 },
  { d: "Camera inspection w/ locate", r: 285 },
  { d: "Toilet — Toto Drake, supplied & installed", r: 460 },
  { d: "City permit", r: 110 },
];

interface LaborRate {
  name: string;
  rate: number;
}

const LABOR_RATES: ReadonlyArray<LaborRate> = [
  { name: "Journeyman", rate: 125 },
  { name: "Apprentice", rate: 85 },
  { name: "Master", rate: 165 },
];

// ---- builder line model (prototype state.tq[tier].lines) --------------------
// A line is one of: 'book' (pricebook pick, fixed amt + carried cost),
// 'custom' (one-off fixed amt), or 'tm' (time-&-material — hours × rate).

type BuildKind = "book" | "custom" | "tm";

interface BuildLine {
  kind: BuildKind;
  d: string;
  amt?: number; // book / custom
  h?: number; // tm hours
  rate?: number; // tm $/hr
  c?: number; // carried cost (book) — office keeps margin
}

/** Amount for a line (prototype tqLineAmt): tm → h×rate, else the fixed amt. */
function lineAmt(l: BuildLine): number {
  return l.kind === "tm"
    ? Math.round((l.h ?? 0) * (l.rate ?? 0))
    : Math.round(l.amt ?? 0);
}

/** Sum of the built lines (prototype tqTierTotal for the single tier). */
function linesTotal(lines: ReadonlyArray<BuildLine>): number {
  return lines.reduce((s, l) => s + lineAmt(l), 0);
}

/** Seed the builder from the job's existing lines (prototype openTechQuote). */
function seedLines(job: Job): BuildLine[] {
  return (job.lines ?? []).map((l) => ({
    kind: "book" as const,
    d: l.d,
    amt: (l.q ?? 1) * (l.r ?? 0),
    c: l.c ?? 0,
  }));
}

/** Customer/job label (prototype custName). */
function custLabel(job: Job, lead: Lead | undefined): string {
  if (lead) return lead.name;
  const parts = (job.title ?? "").split("—");
  if (parts.length > 1 && parts[1]) return parts[1].trim();
  return job.title || "Customer";
}

function fmt$(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

// ---- add-a-line builder menu (prototype tq.picking / tq.add) ---------------

type AddSub = null | "pb" | "labor";

const SEC_LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: ".05em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};

interface SvgProps {
  children: React.ReactNode;
}

function Ico({ children }: SvgProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="19"
      height="19"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const IcoBook = (
  <Ico>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </Ico>
);

const IcoPen = (
  <Ico>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
  </Ico>
);

const IcoClock = (
  <Ico>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3 1.8" />
  </Ico>
);

interface AddTileProps {
  ico: React.ReactNode;
  title: string;
  sub: string;
  arrow: boolean;
  onClick: () => void;
}

/** One .addtile action tile (prototype tile()). */
function AddTile({ ico, title, sub, arrow, onClick }: AddTileProps) {
  return (
    <button type="button" className="addtile" onClick={onClick}>
      <div className="addtile-ico">{ico}</div>
      <div className="addtile-t">
        {title}
        {arrow ? <span className="arr">→</span> : null}
      </div>
      <div className="addtile-s">{sub}</div>
    </button>
  );
}

interface BrowseRowProps {
  label: string;
  right: React.ReactNode;
  onClick: () => void;
}

/** A clickable browse row in a sublist (prototype row()). */
function BrowseRow({ label, right, onClick }: BrowseRowProps) {
  return (
    <div
      className="stage-row clickable"
      style={{ cursor: "pointer", borderBottom: "1px solid var(--line-2)", padding: "11px 0" }}
      onClick={onClick}
    >
      <span style={{ flex: 1, fontSize: 14.5, fontWeight: 600, color: "var(--ink)" }}>{label}</span>
      {right}
    </div>
  );
}

interface AddMenuProps {
  sub: AddSub;
  hasLines: boolean;
  onSetSub: (sub: AddSub) => void;
  onPickBook: (item: PricebookItem) => void;
  onAddCustom: () => void;
  onPickRate: (rate: LaborRate) => void;
  onAddCustomLabor: () => void;
  onDone: () => void;
}

/** The "+ Add a line" builder: sublists (pb / labor) or the 2×2 tile grid. */
function AddMenu({
  sub,
  hasLines,
  onSetSub,
  onPickBook,
  onAddCustom,
  onPickRate,
  onAddCustomLabor,
  onDone,
}: AddMenuProps) {
  if (sub === "pb") {
    return (
      <div className="card" style={{ marginBottom: 2 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={SEC_LABEL}>Pricebook</span>
          <span className="linklike" style={{ fontSize: 12.5 }} onClick={() => onSetSub(null)}>
            ← back
          </span>
        </div>
        {PRICEBOOK.length ? (
          PRICEBOOK.map((p, i) => (
            <BrowseRow
              key={i}
              label={p.d}
              right={<b className="fig">{fmt$(p.r)}</b>}
              onClick={() => onPickBook(p)}
            />
          ))
        ) : (
          <div className="muted" style={{ fontSize: 12.5, padding: "4px 0" }}>
            No saved items yet — use a custom item.
          </div>
        )}
      </div>
    );
  }

  if (sub === "labor") {
    return (
      <div className="card" style={{ marginBottom: 2 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span style={SEC_LABEL}>Labor rates</span>
          <span className="linklike" style={{ fontSize: 12.5 }} onClick={() => onSetSub(null)}>
            ← back
          </span>
        </div>
        {LABOR_RATES.map((r, i) => (
          <BrowseRow
            key={i}
            label={r.name}
            right={<b className="fig">{fmt$(r.rate)}/hr</b>}
            onClick={() => onPickRate(r)}
          />
        ))}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 2 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 12px" }}>
        <span style={SEC_LABEL}>Add a line</span>
        {hasLines ? (
          <span className="linklike" style={{ fontSize: 12.5 }} onClick={onDone}>
            done
          </span>
        ) : null}
      </div>
      <div className="addgrid">
        <AddTile ico={IcoBook} title="Pricebook" sub="browse saved items" arrow onClick={() => onSetSub("pb")} />
        <AddTile ico={IcoPen} title="Custom item" sub="one-off price" arrow={false} onClick={onAddCustom} />
        <AddTile ico={IcoClock} title="Labor" sub="browse your rates · $/hr" arrow onClick={() => onSetSub("labor")} />
        <AddTile ico={IcoPen} title="Custom labor" sub="one-off $/hr" arrow={false} onClick={onAddCustomLabor} />
      </div>
    </div>
  );
}

// ---- line rows (prototype lineRow) -----------------------------------------

const INP: React.CSSProperties = {
  border: "1.5px solid var(--line)",
  borderRadius: 7,
  padding: 6,
  fontFamily: "inherit",
};

interface LineRowProps {
  line: BuildLine;
  onSet: (patch: Partial<BuildLine>) => void;
  onRemove: () => void;
}

/** One editable builder row — 'tm' (h × rate) or fixed (book/custom, $). */
function LineRow({ line, onSet, onRemove }: LineRowProps) {
  if (line.kind === "tm") {
    return (
      <div className="stage-row" style={{ gap: 6, flexWrap: "wrap", border: "none", padding: "5px 0" }}>
        <input
          value={line.d}
          onChange={(e) => onSet({ d: e.target.value })}
          style={{ flex: 1, minWidth: 120, ...INP, padding: "6px 8px", fontSize: 13 }}
        />
        <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <input
            type="number"
            min={0}
            step={0.25}
            value={line.h ?? 0}
            onChange={(e) =>
              onSet({ h: Math.max(0, Math.round((Number(e.target.value) || 0) * 4) / 4) })
            }
            style={{ width: 52, ...INP }}
          />
          <span className="muted" style={{ fontSize: 11 }}>
            h × $
          </span>
          <input
            type="number"
            min={0}
            value={line.rate || ""}
            placeholder="rate"
            onChange={(e) => onSet({ rate: Math.max(0, Number(e.target.value) || 0) })}
            style={{ width: 60, ...INP }}
          />
        </span>
        <b style={{ marginLeft: "auto" }}>{fmt$(lineAmt(line))}</b>
        <button type="button" className="btn sm ghost" onClick={onRemove}>
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="stage-row" style={{ gap: 6, flexWrap: "wrap", border: "none", padding: "5px 0" }}>
      <input
        value={line.d}
        placeholder={line.kind === "custom" ? "part, material, or flat fee" : ""}
        onChange={(e) => onSet({ d: e.target.value })}
        style={{ flex: 1, minWidth: 140, ...INP, padding: "6px 8px", fontSize: 13 }}
      />
      <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
        <span className="muted">$</span>
        <input
          type="number"
          min={0}
          value={line.amt ?? 0}
          onChange={(e) => onSet({ amt: Math.max(0, Number(e.target.value) || 0) })}
          style={{ width: 78, ...INP }}
        />
      </span>
      <button type="button" className="btn sm ghost" onClick={onRemove}>
        ✕
      </button>
    </div>
  );
}

// ---- the modal body --------------------------------------------------------

export function PriceBuilderModalContent() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const jobs = useAppStore((s) => s.jobs);
  const leads = useAppStore((s) => s.leads);
  const updateJob = useAppStore((s) => s.updateJob);

  const jobId = activeModal?.params?.jobId as number | undefined;
  const job = jobs.find((j) => j.id === jobId);

  // builder line set — seeded once from the job's existing lines so re-opening
  // ("Edit") builds on top of the current price, never loses it.
  const [lines, setLines] = useState<BuildLine[]>(() => (job ? seedLines(job) : []));
  // add-a-line menu: open (picking) once there are no lines to seed from, plus
  // which sublist (pb / labor) is showing.
  const [picking, setPicking] = useState<boolean>(() => !job || seedLines(job).length === 0);
  const [add, setAdd] = useState<AddSub>(null);

  if (!job) return null;

  const lead = leads.find((l) => l.id === job.leadId);
  const total = linesTotal(lines);
  const anyPriced = total > 0;

  // ---- immutable line ops (never mutate a line object) ----------------------

  function appendLine(l: BuildLine) {
    setLines((prev) => [...prev, l]);
  }

  function pickBook(item: PricebookItem) {
    appendLine({ kind: "book", d: item.d, amt: item.r, c: item.c ?? 0 });
    // pricebook pick keeps the sublist open (prototype tqPickBook leaves add).
  }

  function addCustom() {
    appendLine({ kind: "custom", d: "", amt: 0 });
    setAdd(null); // back to the tile menu, still picking (prototype tqAddCustom).
  }

  function pickRate(r: LaborRate) {
    appendLine({ kind: "tm", d: "Labor", h: 1, rate: r.rate });
    // labor pick keeps the sublist open (prototype tqPickRate leaves add).
  }

  function addCustomLabor() {
    appendLine({ kind: "tm", d: "Labor", h: 1, rate: 0 });
    setAdd(null); // back to the tile menu (prototype tqAddCustomLabor).
  }

  function setLine(index: number, patch: Partial<BuildLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
  }

  // ---- save (prototype tqSavePrice) -----------------------------------------
  // Commit the built lines straight to the job — no signature, no on-site
  // approval (the office set the price). Map to JobLine[] and drop zero lines.

  function savePrice() {
    if (!job) return;
    const jobLines: JobLine[] = lines
      .map((l) => ({ d: l.d || "Line item", q: 1, r: lineAmt(l), c: l.c ?? 0 }))
      .filter((l) => l.r > 0);
    updateJob(job.id, { lines: jobLines });
    close();
  }

  return (
    <div>
      {/* Header — eyebrow + title (office single-tier: "Price the job") */}
      <button className="x" onClick={close}>
        ✕
      </button>
      <div
        className="muted"
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: ".05em",
          textTransform: "uppercase",
          color: "var(--green-700)",
        }}
      >
        Price the job · {custLabel(job, lead)}
      </div>
      <h2 style={{ marginBottom: 14 }}>Build the price</h2>

      {/* Built line list + single-tier Total */}
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
              marginTop: 8,
              paddingTop: 9,
            }}
          >
            <span>Total</span>
            <span className="fig">{fmt$(total)}</span>
          </div>
        </div>
      ) : null}

      {/* "+ Add a line" — open menu (picking) or the collapsed entry button */}
      {picking ? (
        <AddMenu
          sub={add}
          hasLines={lines.length > 0}
          onSetSub={setAdd}
          onPickBook={pickBook}
          onAddCustom={addCustom}
          onPickRate={pickRate}
          onAddCustomLabor={addCustomLabor}
          onDone={() => setPicking(false)}
        />
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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

      {/* Footer — office single-tier save (prototype tqSavePrice) */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
        <button
          className="btn primary"
          onClick={savePrice}
          disabled={!anyPriced}
          style={anyPriced ? undefined : { opacity: 0.45 }}
        >
          Save price →
        </button>
      </div>
    </div>
  );
}
