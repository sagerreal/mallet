"use client";

/**
 * Shared presentational chrome for the two CSV import modals (customers, price
 * book). From the user's side both flows are identical — drop a CSV, map columns,
 * watch it import, see a summary — so the chrome lives here once. The per-domain
 * map table + chunked import loop stay in each modal (different targets,
 * mutations, and dedupe semantics), which is where the real logic differs.
 */

import type { ReactNode } from "react";

const PILL_TONES: Record<string, React.CSSProperties> = {
  ready: { background: "var(--green-100)", color: "var(--ink)" },
  skipped: { background: "var(--manila-2)", color: "var(--ink-2)" },
  warn: { background: "var(--amber-bg)", color: "var(--amber)" },
};

/** Summary count chip shown above the mapping table (N ready / skipped / warn). */
export function ImportPill({ tone, label }: { tone: "ready" | "skipped" | "warn"; label: string }) {
  return (
    <span style={{ ...PILL_TONES[tone], borderRadius: "var(--radius-pill)", padding: "var(--space-1) var(--space-3)", fontSize: "var(--type-sm)", fontWeight: 700 }}>
      {label}
    </span>
  );
}

/** Column-mapping <select>/<input> styling, shared by both modals' map tables. */
export const IMPORT_SELECT_STYLE: React.CSSProperties = {
  flex: 1, minWidth: 0, border: "1.5px solid var(--line)", borderRadius: "var(--radius-sm)",
  padding: "var(--space-2) var(--space-3)", fontFamily: "inherit", fontSize: "var(--type-base)", background: "var(--card)", color: "var(--ink)",
};

/** Drag-or-click CSV upload zone. Owns the drop label, icon, copy, and the
 *  visually-hidden file input. Drag state is lifted so the parent can react. */
export function CsvDropzone({
  dragging, setDragging, onDrop, onFile,
}: {
  dragging: boolean;
  setDragging: (v: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-2)",
        padding: "var(--space-8) var(--space-5)", textAlign: "center", cursor: "pointer",
        border: `2px dashed ${dragging ? "var(--ink)" : "var(--manila-line)"}`,
        borderRadius: "var(--radius-lg)", background: dragging ? "var(--green-100)" : "var(--manila)",
        transition: "border-color .12s, background .12s",
      }}
    >
      <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="var(--ink-3)"
        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <div style={{ fontWeight: 700, fontSize: "var(--type-md)", color: "var(--ink)" }}>
        Drag a CSV here, or click to browse
      </div>
      <div className="muted" style={{ fontSize: "var(--type-sm)" }}>.csv files only · up to a few thousand rows</div>
      <input type="file" accept=".csv,text/csv" onChange={onFile} aria-label="Upload a CSV file"
        style={{ position: "absolute", width: 1, height: 1, padding: "0", margin: -1, overflow: "hidden", clip: "rect(0 0 0 0)", border: 0 }} />
    </label>
  );
}

/** "Importing… N of M" line shown while chunks are in flight. */
export function ImportingLine({ done, total }: { done: number; total: number }) {
  return (
    <p className="muted" style={{ fontSize: "var(--type-md)", padding: "var(--space-6) 0" }}>
      Importing… {done > 0 ? `${done} of ${total}` : "hang tight"}
    </p>
  );
}

/** Success card: green check circle, headline, optional secondary line, Done. */
export function ImportDoneCard({
  headline, sub, onClose,
}: {
  headline: ReactNode;
  sub?: ReactNode;
  onClose: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "var(--space-4) 0 var(--space-1)" }}>
      <div style={{
        width: 46, height: 46, borderRadius: "var(--radius-pill)", background: "var(--green-100)",
        display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "var(--space-3)",
      }}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="var(--ink)"
          strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>
      <div style={{ fontWeight: 800, fontSize: "var(--type-lg)" }}>{headline}</div>
      {sub && (
        <div className="muted" style={{ fontSize: "var(--type-base)", marginTop: "var(--space-1)" }}>{sub}</div>
      )}
      <button type="button" className="btn primary" style={{ marginTop: "var(--space-5)" }} onClick={onClose}>Done</button>
    </div>
  );
}
