/**
 * components/modals/tech-job-modal/visit-row.tsx
 * Your visit(s) row (prototype tvRow, 4568-4585) — ARRIVE label + big
 * "colLabel · H:MM AM" + ON SITE label + "~hmLabel", then full-width step
 * buttons. On-my-way / Arrived are optional; Done is never gated.
 *
 * The step buttons are the technician's, and they are also how his hours get recorded — each tap
 * moves his clock (travel → on site → back to shop). Only ↩ Reopen is withheld: it is a
 * correction to a visit that already ended, made days later, against hours he may already have
 * been paid for.
 */

"use client";

import type { Visit } from "@/lib/store/types";
import { colLabel, hmLabel, startTimeStr } from "./helpers";

interface VisitRowProps {
  visit: Visit;
  quoted: boolean;
  /** ↩ Reopen is an office correction (it can rewrite recorded hours) — owner/office only. */
  canReopen: boolean;
  /**
   * May the viewer MOVE this visit? True for office, and for the tech this visit is assigned to.
   *
   * A job with two visits shows both rows, because "my stop is the second one today" is useful
   * context — but only the viewer's own row gets step buttons. The server refuses a tech acting on
   * a colleague's visit, so rendering the buttons anyway would be a live-looking control that
   * returns an unexplained error.
   */
  canAct: boolean;
  onStatus: (status: string) => void;
}

export function VisitRow({ visit, quoted, canReopen, canAct, onStatus }: VisitRowProps) {
  // guarded: only PLACED visits reach here, so date/start are non-null.
  const date = visit.date ?? "";
  const start = visit.start ?? 0;
  const stepP = !quoted;

  // On my way → / Arrived → (scheduled → enroute → onsite). Empty once on site, and empty on
  // somebody else's visit.
  const step = !canAct ? null :
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

  // ✓ Mark done / ↩ Reopen. A finished visit shows nothing at all to a technician rather than a
  // button that would be refused — the row is a record at that point, not a control.
  const doneB = !canAct ? null :
    visit.status === "done" ? (
      canReopen ? (
        <button className="btn ghost" style={{ flex: 1 }} onClick={() => onStatus("scheduled")}>
          ↩ Reopen
        </button>
      ) : null
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
      {(step || doneB) && (
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          {step}
          {doneB}
        </div>
      )}
    </div>
  );
}
