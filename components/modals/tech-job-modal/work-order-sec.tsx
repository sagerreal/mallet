/**
 * components/modals/tech-job-modal/work-order-sec.tsx
 * Work order (prototype workOrderBlock, 4649-4669) — a read-only "office-sold"
 * scope handoff, install jobs only, not done, with scope lines. Our JobLine has
 * no `fee`, so scope = every non-empty `d` line. The sold $ shows ONLY when
 * techSeesPrice (the crew usually gets scope, no $).
 */

"use client";

import { memo } from "react";
import type { CSSProperties } from "react";
import type { Job } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";

const SCOPE_HEAD: CSSProperties = {
  fontSize: "var(--type-xs)",
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: ".05em",
};

export interface WorkOrderSecProps {
  job: Job;
  seesPrice: boolean;
}

// Custom comparator for the memoized section — compares only the job fields the
// section actually reads. A checklist tap changes job.verify: WorkOrderSec reads
// none of those fields, so it skips the re-render.
export function workOrderPropsEqual(a: WorkOrderSecProps, b: WorkOrderSecProps): boolean {
  return (
    a.seesPrice === b.seesPrice &&
    a.job.lines === b.job.lines &&
    a.job.photos === b.job.photos &&
    a.job.title === b.job.title &&
    a.job.special === b.job.special &&
    a.job.prep === b.job.prep
  );
}

// WorkOrderSec uses a custom comparator so a checklist tap (job.verify change)
// does NOT re-render it — it only reads lines/photos/title/special/prep.
function WorkOrderSecFn({ job, seesPrice }: WorkOrderSecProps) {
  const scope = (job.lines ?? []).filter((l) => (l.d ?? "").trim());
  const photoN = (job.photos ?? []).length;

  return (
    <div className="fsec">
      <div className="fsec-h">
        <span>Work order</span>
        <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 600 }}>office-sold</span>
      </div>
      <div style={{ fontWeight: 700, fontSize: "var(--type-md)" }}>{job.title}</div>

      {scope.length ? (
        <>
          <div className="muted" style={{ ...SCOPE_HEAD, margin: "var(--space-3) 0 var(--space-1)" }}>
            Scope — what was sold
          </div>
          {scope.map((x, i) => (
            <div
              key={i}
              style={{ fontSize: "var(--type-base)", padding: "var(--space-1) 0", display: "flex", gap: "var(--space-2)", alignItems: "baseline" }}
            >
              <span style={{ color: "var(--green-700)" }}>✓</span>
              <span style={{ flex: 1 }}>
                {x.d}
                {(x.q ?? 1) > 1 ? <span className="muted"> × {x.q}</span> : null}
              </span>
              {/* x.r === null = server-redacted (techSeesPrice off) — show nothing, never $0. */}
              {seesPrice && x.r != null && (
                <span className="muted fig" style={{ fontSize: "var(--type-sm)" }}>
                  {fmt$((x.q ?? 1) * x.r)}
                </span>
              )}
            </div>
          ))}
        </>
      ) : null}

      {job.special ? (
        <div
          style={{
            marginTop: "var(--space-3)",
            background: "#FFFBEF",
            border: "1px solid var(--manila-line)",
            borderRadius: "var(--radius-sm)",
            padding: "var(--space-2) var(--space-3)",
          }}
        >
          <b style={{ fontSize: "var(--type-sm)", color: "#b45309" }}>★ Homeowner&rsquo;s requests</b>
          <div style={{ fontSize: "var(--type-base)", marginTop: "var(--space-2xs)" }}>{job.special}</div>
        </div>
      ) : null}

      {job.prep ? (
        <div style={{ fontSize: "var(--type-base)", marginTop: "var(--space-2)" }}>
          <b>Bring:</b> {job.prep}
        </div>
      ) : null}

      {photoN ? (
        <div style={{ marginTop: "var(--space-3)" }}>
          <span className="muted" style={SCOPE_HEAD}>
            Site photos · {photoN}
          </span>
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-1)" }}>
            {Array.from({ length: Math.min(photoN, 4) }).map((_, i) => (
              <div
                key={i}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: "var(--radius-sm)",
                  background: "var(--green-100)",
                  border: "1px solid var(--manila-line)",
                }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
export const WorkOrderSec = memo(WorkOrderSecFn, workOrderPropsEqual);
