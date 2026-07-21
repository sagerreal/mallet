/**
 * components/modals/sweep-modal.tsx
 * Faithful port of the prototype's openSweep / applySweep (lines 2571-2632).
 * "Clean up leads" — checkbox list split into "Going stale" + "Everything else",
 * Select-all, and three actions: Delete (armed two-tap), Archive, Mark Lost.
 */

"use client";

import { useState } from "react";
import { useAppStore, useCloseModal } from "@/lib/store/app-store";
import { isStaleLead } from "@/features/pipeline/pipeline-constants";
import { StagePill } from "@/components/shared/stage-pill";
import type { Lead } from "@/lib/store/types";

type SweepMode = "delete" | "archive" | "lost";

export function SweepModalContent() {
  const close = useCloseModal();
  const leads = useAppStore((s) => s.leads);
  const archiveLead = useAppStore((s) => s.archiveLead);
  const deleteLead = useAppStore((s) => s.deleteLead);
  const updateLead = useAppStore((s) => s.updateLead);

  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [deleteArmed, setDeleteArmed] = useState(false);

  const live = leads.filter((l) => !l.archived);
  const stale = live.filter(isStaleLead);
  const rest = live.filter((l) => !isStaleLead(l));

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setChecked(new Set(live.map((l) => l.id)));
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
      if (mode === "lost") {
        updateLead(id, {
          stage: "Lost",
          lossReason: "No response",
          last: "Lost — no response (sweep)",
        });
      } else if (mode === "delete") {
        deleteLead(id);
      } else {
        archiveLead(id);
      }
    });
    close();
  }

  function row(l: Lead) {
    return (
      <div className="sweeprow" key={l.id}>
        <input
          type="checkbox"
          checked={checked.has(l.id)}
          onChange={() => toggle(l.id)}
        />
        <b style={{ flex: 1 }}>{l.name}</b>
        <span className="muted">{l.job || ""}</span>
        <StagePill stage={l.stage} />
        <span className="muted">{l.age}d</span>
      </div>
    );
  }

  return (
    <div>
      <h2>Clean up leads</h2>
      <p className="muted" style={{ marginBottom: "var(--space-3)" }}>
        Check anything you want out of the way.{" "}
        <span className="linklike" onClick={selectAll}>
          Select all
        </span>
      </p>

      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {stale.length > 0 && (
          <>
            <div className="navlabel" style={{ padding: "var(--space-2xs) 0 var(--space-2)" }}>
              ⚠ Going stale — {stale.length}
            </div>
            {stale.map(row)}
          </>
        )}
        {rest.length > 0 && (
          <>
            <div className="navlabel" style={{ padding: `${stale.length ? 12 : 2}px 0 6px` }}>
              Everything else
            </div>
            {rest.map(row)}
          </>
        )}
        {stale.length === 0 && rest.length === 0 && (
          <div className="empty-att">No leads to clean.</div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: "var(--space-2)",
          marginTop: "var(--space-4)",
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
        <button className="btn" onClick={() => apply("lost")}>
          ✕ Mark checked Lost — no response
        </button>
      </div>
    </div>
  );
}
