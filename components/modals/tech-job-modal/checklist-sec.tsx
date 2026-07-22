/**
 * components/modals/tech-job-modal/checklist-sec.tsx
 * Attached checklist, INTERACTIVE (prototype verifySection, 4876-4897) — the
 * field "Before you leave" capture. Derives jobVerifyState(job) in the body
 * (never inside a selector): each item pairs the checklist item with its answer;
 * gaps = required + unanswered. Progress bar fills done/total (amber if gaps).
 * One row, one primary action: tap to pass / Photo to capture. N/A + declined
 * live behind a ⋯ kebab that expands in place (LOCAL expandedId state).
 */

"use client";

import { memo, useState } from "react";
import type { CSSProperties } from "react";
import type { ChecklistItem, Job, VerifyAns } from "@/lib/store/types";

interface VerifyRow {
  it: ChecklistItem;
  a: VerifyAns | undefined;
}

interface VerifyState {
  items: VerifyRow[];
  gaps: VerifyRow[];
  done: number;
  total: number;
}

/** jobVerifyState (prototype 4826) — derive in the component body, not a selector. */
function jobVerifyState(job: Job): VerifyState | null {
  const cl = job.checklist;
  if (!cl) return null;
  const ans = job.verify?.ans ?? {};
  const items: VerifyRow[] = (cl.items ?? [])
    .filter((it) => (it.text ?? "").trim())
    .map((it) => ({ it, a: ans[it.id] }));
  if (!items.length) return null;
  const gaps = items.filter((x) => !x.a && x.it.required);
  return { items, gaps, done: items.filter((x) => x.a).length, total: items.length };
}

const OVERRIDE_REASONS = ["N/A", "Customer declined"] as const;

const VROW_BASE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-3)",
  padding: "var(--space-3) 0",
  borderTop: "1px solid var(--line)",
  fontSize: "var(--type-base)",
};

interface ChecklistItemRowProps {
  jobId: string;
  row: VerifyRow;
  expanded: boolean;
  onCheck: () => void;
  onPhoto: () => void;
  onOverride: (reason: string) => void;
  onUndo: () => void;
  onToggleExpand: () => void;
}

// One verify row — answered (✓/⊘ + how + undo), or unanswered (tappable / Photo
// + ⋯ override). Ported 1:1 from verifySection's `row(x)`.
function ChecklistItemRow({
  row,
  expanded,
  onCheck,
  onPhoto,
  onOverride,
  onUndo,
  onToggleExpand,
}: ChecklistItemRowProps) {
  const { it, a } = row;

  if (a) {
    const ov = a.st === "override";
    const how = ov ? a.reason ?? "" : a.via === "photo" ? "photo" : "done";
    return (
      <div style={VROW_BASE}>
        <span
          style={{
            width: 16,
            flex: "none",
            textAlign: "center",
            fontWeight: 700,
            color: ov ? "var(--ink-3)" : "var(--green-700)",
          }}
        >
          {ov ? "⊘" : "✓"}
        </span>
        <span style={{ flex: 1, minWidth: 0, color: "var(--ink-2)" }}>{it.text}</span>
        <span className="muted" style={{ fontSize: "var(--type-sm)", flex: "none" }}>
          {how}
        </span>
        <span
          className="linklike"
          style={{ fontSize: "var(--type-xs)", flex: "none", color: "var(--ink-3)" }}
          onClick={onUndo}
        >
          undo
        </span>
      </div>
    );
  }

  const glyph = (
    <span
      style={{
        width: 16,
        flex: "none",
        textAlign: "center",
        fontWeight: 700,
        color: it.required ? "var(--amber)" : "var(--ink-3)",
      }}
    >
      ○
    </span>
  );

  const label = (
    <span style={{ flex: 1, minWidth: 0 }}>
      {it.text}
      {!it.required && (
        <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
          {" "}
          · optional
        </span>
      )}
    </span>
  );

  const ctrl =
    it.type === "photo" ? (
      <button
        className="btn sm ghost"
        style={{ flex: "none", padding: "var(--space-1) var(--space-4)" }}
        onClick={(e) => {
          e.stopPropagation();
          onPhoto();
        }}
      >
        Photo
      </button>
    ) : null;

  const kebab = (
    <span
      className="linklike"
      style={{ flex: "none", color: "var(--ink-3)", fontSize: "var(--type-lg)", lineHeight: 1, padding: "0 var(--space-1)", fontWeight: 800 }}
      title="N/A or customer declined"
      onClick={(e) => {
        e.stopPropagation();
        onToggleExpand();
      }}
    >
      ⋯
    </span>
  );

  const expRow = expanded ? (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "0 0 var(--space-3) var(--space-6)" }}>
      {OVERRIDE_REASONS.map((r) => (
        <button
          key={r}
          className="chip"
          style={{ padding: "var(--space-1) var(--space-3)", fontSize: "var(--type-sm)" }}
          onClick={() => onOverride(r)}
        >
          {r}
        </button>
      ))}
    </div>
  ) : null;

  // photo items keep the whole row un-tappable (the Photo button captures);
  // check items make the whole row a tap target.
  return (
    <>
      {it.type === "photo" ? (
        <div style={VROW_BASE}>
          {glyph}
          {label}
          {ctrl}
          {kebab}
        </div>
      ) : (
        <div style={{ ...VROW_BASE, cursor: "pointer" }} onClick={onCheck}>
          {glyph}
          {label}
          {ctrl}
          {kebab}
        </div>
      )}
      {expRow}
    </>
  );
}

export interface ChecklistSecProps {
  job: Job;
  checkItem: (jobId: string, itemId: string) => void;
  overrideItem: (jobId: string, itemId: string, reason: string) => void;
  uncheckItem: (jobId: string, itemId: string) => void;
  addPhoto: (jobId: string) => void;
}

export const ChecklistSec = memo(function ChecklistSec({ job, checkItem, overrideItem, uncheckItem, addPhoto }: ChecklistSecProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const vs = jobVerifyState(job);
  if (!vs) return null;

  const pct = Math.round((vs.done / vs.total) * 100);
  const barColor = vs.gaps.length ? "var(--amber)" : "var(--green-700)";

  return (
    <div className="fsec">
      <div className="fsec-h">
        <span>Before you leave</span>
        {job.checklist?.name ? (
          <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 600 }}>
            {job.checklist.name}
          </span>
        ) : null}
      </div>
      <div
        style={{ height: 4, borderRadius: "var(--radius-2xs)", background: "var(--line)", overflow: "hidden", margin: "0 0 var(--space-1)" }}
      >
        <div style={{ height: "100%", width: `${pct}%`, background: barColor }} />
      </div>
      {vs.items.map((row) => (
        <ChecklistItemRow
          key={row.it.id}
          jobId={job.id}
          row={row}
          expanded={expandedId === row.it.id}
          onCheck={() => checkItem(job.id, row.it.id)}
          onPhoto={() => addPhoto(job.id)}
          onOverride={(reason) => {
            overrideItem(job.id, row.it.id, reason);
            setExpandedId(null);
          }}
          onUndo={() => uncheckItem(job.id, row.it.id)}
          onToggleExpand={() => setExpandedId((cur) => (cur === row.it.id ? null : row.it.id))}
        />
      ))}
    </div>
  );
});
