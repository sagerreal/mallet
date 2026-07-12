/**
 * components/modals/pricing/build-line.tsx
 * Shared line-building primitives for BOTH price builders — the office
 * single-tier PriceBuilderModal and the tech on-site TechQuoteModal (GBB + sign).
 *
 * These are a faithful port of the prototype tqRender's EDIT-mode building
 * blocks (prototype 7304-7334): the line model + amount math (tqLineAmt), the
 * seed-from-job helper (openTechQuote), the money/label formatters (fmt$ /
 * custName), and the render primitives — the add-a-line menu (Ico / AddTile /
 * BrowseRow / AddMenu, prototype tile()/row()) and the editable LineRow
 * (prototype lineRow()).
 *
 * AddMenu takes the pricebook + labor rates as PROPS (both builders read them
 * from the store and adapt to the PricebookItem / LaborRate shape here) rather
 * than closing over module consts, so the same menu serves both surfaces.
 */

"use client";

import { fmt$ } from "@/lib/format";

// ---- builder line model (prototype state.tq[tier].lines) --------------------
// A line is one of: 'book' (pricebook pick, fixed amt + carried cost),
// 'custom' (one-off fixed amt), or 'tm' (time-&-material — hours × rate).

export type BuildKind = "book" | "custom" | "tm";

export interface BuildLine {
  kind: BuildKind;
  d: string;
  amt?: number; // book / custom
  h?: number; // tm hours
  rate?: number; // tm $/hr
  c?: number; // carried cost (book) — office keeps margin
}

// ---- reference data (adapted from the store's pricebook / labor rates) ------
// PricebookItem mirrors the composer page's local const shape { d, r }; the
// office keeps margin via cost, so pricebook picks carry a cost `c` when present.

export interface PricebookItem {
  d: string;
  r: number;
  c?: number;
}

export interface LaborRate {
  name: string;
  rate: number;
}

// ---- add-a-line sublist selector (prototype tq.add) ------------------------

export type AddSub = null | "pb" | "labor";

// ---- amount / total math (prototype tqLineAmt / tqTierTotal) ----------------

/** Amount for a line (prototype tqLineAmt): tm → h×rate, else the fixed amt. */
export function lineAmt(l: BuildLine): number {
  return l.kind === "tm"
    ? Math.round((l.h ?? 0) * (l.rate ?? 0))
    : Math.round(l.amt ?? 0);
}

/** Sum of a set of built lines (prototype tqTierTotal). */
export function linesTotal(lines: ReadonlyArray<BuildLine>): number {
  return lines.reduce((s, l) => s + lineAmt(l), 0);
}

// ---- seed / labels / money -------------------------------------------------

// A job's existing priced lines, kept loosely shaped so this module needn't
// depend on the store's Job type.
interface SeedJobLine {
  d: string;
  q?: number;
  /** null = server-redacted rate (tech device) — seeded as 0 like an unpriced line. */
  r?: number | null;
  c?: number;
}

interface SeedJob {
  lines?: SeedJobLine[];
}

/** Seed the builder from the job's existing lines (prototype openTechQuote). */
export function seedLines(job: SeedJob): BuildLine[] {
  return (job.lines ?? []).map((l) => ({
    kind: "book" as const,
    d: l.d,
    amt: (l.q ?? 1) * (l.r ?? 0),
    c: l.c ?? 0,
  }));
}

interface CustLabelLead {
  name: string;
}

interface CustLabelJob {
  title?: string;
}

/** Customer/job label (prototype custName). */
export function custLabel(
  job: CustLabelJob,
  lead: CustLabelLead | undefined,
): string {
  if (lead) return lead.name;
  const parts = (job.title ?? "").split("—");
  if (parts.length > 1 && parts[1]) return parts[1].trim();
  return job.title || "Customer";
}


// ---- add-a-line builder menu (prototype tq.picking / tq.add) ---------------

export const SEC_LABEL: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: ".05em",
  textTransform: "uppercase",
  color: "var(--ink-3)",
};

interface SvgProps {
  children: React.ReactNode;
}

export function Ico({ children }: SvgProps) {
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
export function AddTile({ ico, title, sub, arrow, onClick }: AddTileProps) {
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
export function BrowseRow({ label, right, onClick }: BrowseRowProps) {
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
  pricebook: ReadonlyArray<PricebookItem>;
  laborRates: ReadonlyArray<LaborRate>;
  onSetSub: (sub: AddSub) => void;
  onPickBook: (item: PricebookItem) => void;
  onAddCustom: () => void;
  onPickRate: (rate: LaborRate) => void;
  onAddCustomLabor: () => void;
  onDone: () => void;
}

/** The "+ Add a line" builder: sublists (pb / labor) or the 2×2 tile grid. */
export function AddMenu({
  sub,
  hasLines,
  pricebook,
  laborRates,
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
        {pricebook.length ? (
          pricebook.map((p, i) => (
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
        {laborRates.map((r, i) => (
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
export function LineRow({ line, onSet, onRemove }: LineRowProps) {
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
