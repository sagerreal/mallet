/**
 * components/modals/tech-job-modal/visit-row.tsx
 * Your visit(s) row (prototype tvRow, 4568-4585) — ARRIVE label + big
 * "colLabel · H:MM AM" + ON SITE label + "~hmLabel", then full-width step
 * buttons. On-my-way / Arrived are optional; Done is never gated.
 */

"use client";

import type { Visit } from "@/lib/store/types";
import { colLabel, hmLabel, startTimeStr } from "./helpers";

interface VisitRowProps {
  visit: Visit;
  quoted: boolean;
  /** Tech role: the step/done buttons call v1.visits.setVisitStatus (ownerOrOffice) — hidden. */
  readOnly: boolean;
  onStatus: (status: string) => void;
}

export function VisitRow({ visit, quoted, readOnly, onStatus }: VisitRowProps) {
  // guarded: only PLACED visits reach here, so date/start are non-null.
  const date = visit.date ?? "";
  const start = visit.start ?? 0;
  const stepP = !quoted;

  // On my way → / Arrived → (scheduled → enroute → onsite). Empty once on site.
  const step =
    visit.status === "scheduled" ? (
      <button
        className={`btn ${stepP ? "primary" : "ghost"}`}
        style={{ flex: 1 }}
        onClick={() => onStatus("enroute")}
      >
        On my way →
      </button>
    ) : visit.status === "enroute" ? (
      <button
        className={`btn ${stepP ? "primary" : "ghost"}`}
        style={{ flex: 1 }}
        onClick={() => onStatus("onsite")}
      >
        Arrived →
      </button>
    ) : null;

  // ✓ Mark done / ↩ Reopen.
  const doneB =
    visit.status === "done" ? (
      <button className="btn ghost" style={{ flex: 1 }} onClick={() => onStatus("scheduled")}>
        ↩ Reopen
      </button>
    ) : (
      <button
        className={`btn ${visit.status === "onsite" || quoted ? "primary" : "ghost"}`}
        style={{ flex: 1 }}
        onClick={() => onStatus("done")}
      >
        ✓ Mark done
      </button>
    );

  return (
    <div style={{ marginBottom: "var(--space-2xs)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "var(--space-3)",
          marginBottom: "var(--space-3)",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "var(--type-xs)",
              fontWeight: 700,
              letterSpacing: ".05em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              marginBottom: "var(--space-2xs)",
            }}
          >
            Arrive
          </div>
          <div style={{ fontSize: "var(--type-lg)", fontWeight: 800, letterSpacing: "-.01em" }}>
            {colLabel(date)} · {startTimeStr(start)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: "var(--type-xs)",
              fontWeight: 700,
              letterSpacing: ".05em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              marginBottom: "var(--space-2xs)",
            }}
          >
            On site
          </div>
          <div style={{ fontSize: "var(--type-lg)", fontWeight: 800, letterSpacing: "-.01em" }}>
            ~{hmLabel(visit.dur)}
          </div>
        </div>
      </div>
      {!readOnly && (
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          {step}
          {doneB}
        </div>
      )}
    </div>
  );
}
