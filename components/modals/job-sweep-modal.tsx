/**
 * components/modals/job-sweep-modal.tsx
 * Faithful port of openJobSweep / applyJobSweep (prototype 5121-5146).
 * Splits live jobs into "Unscheduled" and "Scheduled & done"; checkbox rows +
 * Select all + Delete (armed two-tap) / Archive checked.
 */

"use client";

import { useState } from "react";
import { useAppStore, useCloseModal } from "@/lib/store/app-store";
import type { Job, Lead } from "@/lib/store/types";

type SweepMode = "delete" | "archive";

/** Status pill styling, mirroring the prototype's JST map. */
const JST: Record<string, { l: string; c: string; bg: string }> = {
  unscheduled: { l: "Unscheduled", c: "var(--amber)", bg: "var(--amber-bg)" },
  scheduled: { l: "Scheduled", c: "var(--ink-2)", bg: "var(--paper)" },
  enroute: { l: "On the way", c: "var(--ink-2)", bg: "var(--paper)" },
  onsite: { l: "On site", c: "var(--green-700)", bg: "var(--green-50)" },
  done: { l: "Done", c: "var(--ink-3)", bg: "var(--paper)" },
};

function jstFor(status: string): { l: string; c: string; bg: string } {
  return JST[status] ?? { l: status, c: "var(--ink-2)", bg: "var(--paper)" };
}

function fmt$(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function jobTotal(j: Job): number {
  return (j.lines ?? []).reduce((s, l) => s + (l.q ?? 1) * (l.r ?? 0), 0);
}

function custName(j: Job, leads: readonly Lead[]): string {
  return leads.find((l) => l.id === j.leadId)?.name ?? "—";
}

function StatusPill({ status }: { status: string }) {
  const s = jstFor(status);
  return (
    <span className="stpill" style={{ color: s.c, background: s.bg }}>
      {s.l}
    </span>
  );
}

export function JobSweepModalContent() {
  const close = useCloseModal();
  const jobs = useAppStore((s) => s.jobs);
  const leads = useAppStore((s) => s.leads);
  const archiveJob = useAppStore((s) => s.archiveJob);
  const deleteJob = useAppStore((s) => s.deleteJob);

  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set());
  const [deleteArmed, setDeleteArmed] = useState(false);

  const live = jobs.filter((j) => !j.archived);
  const uns = live.filter((j) => j.status === "unscheduled");
  const rest = live.filter((j) => j.status !== "unscheduled");

  function toggle(id: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setChecked(new Set(live.map((j) => j.id)));
  }

  function apply(mode: SweepMode) {
    const ids = [...checked];
    if (!ids.length) return;
    // Destruction is never one tap: first Delete arms, second executes.
    if (mode === "delete" && !deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    ids.forEach((id) => {
      if (mode === "delete") deleteJob(id);
      else archiveJob(id);
    });
    close();
  }

  function row(j: Job) {
    return (
      <div className="sweeprow" key={j.id}>
        <input
          type="checkbox"
          checked={checked.has(j.id)}
          onChange={() => toggle(j.id)}
        />
        <b style={{ flex: 1 }}>{custName(j, leads)}</b>
        <span className="muted">{j.title}</span>
        <StatusPill status={j.status} />
        <span className="muted">{fmt$(jobTotal(j))}</span>
      </div>
    );
  }

  return (
    <div>
      <h2>Clean up jobs</h2>
      <p className="muted" style={{ marginBottom: 10 }}>
        Check anything to clear off the board.{" "}
        <span className="linklike" onClick={selectAll}>
          Select all
        </span>
      </p>

      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {uns.length > 0 && (
          <>
            <div className="navlabel" style={{ padding: "2px 0 6px" }}>
              Unscheduled — {uns.length}
            </div>
            {uns.map(row)}
          </>
        )}
        {rest.length > 0 && (
          <>
            <div className="navlabel" style={{ padding: `${uns.length ? 12 : 2}px 0 6px` }}>
              Scheduled &amp; done
            </div>
            {rest.map(row)}
          </>
        )}
        {live.length === 0 && <div className="empty-att">No jobs to clean.</div>}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 9,
          marginTop: 16,
          flexWrap: "wrap",
        }}
      >
        <button
          className="btn ghost"
          style={{ color: "var(--red)", borderColor: deleteArmed ? "var(--red)" : undefined }}
          onClick={() => apply("delete")}
        >
          {deleteArmed ? `⚠ Really delete ${checked.size}? Tap again` : "Delete checked"}
        </button>
        <button className="btn ghost" onClick={() => apply("archive")}>
          Archive checked
        </button>
      </div>
    </div>
  );
}
