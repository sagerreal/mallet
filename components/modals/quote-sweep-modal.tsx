/**
 * components/modals/quote-sweep-modal.tsx
 * Faithful port of openQuoteSweep / applyQuoteSweep (prototype 7833-7863).
 * Splits quotes into the "paper pile" (drafts/declined/superseded/expired) and
 * "live" (out the door or won); checkboxes + Select all + Delete / Archive.
 *
 * Sheet grammar: sticky .sheet-head + sticky .sheet-foot, matching sweep-modal.
 * Archive is the terminal, recoverable action → the one filled primary; Delete
 * stays quiet red (armed two-tap) and never takes the primary slot.
 */

"use client";

import { useState } from "react";
import { useAppStore, useCloseModal } from "@/lib/store/app-store";
import { calcQuote } from "@/lib/prototype-sample";
import type { Estimate } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";
import { estTotal, isExpired } from "@/lib/estimates";
import { SoftPill, type PillTone } from "@/components/shared/stage-pill";

type SweepMode = "delete" | "archive";


/** Drafts, declined, superseded, or expired-sent = clutter worth clearing. */
function isClutter(e: Estimate): boolean {
  return (
    e.status === "draft" ||
    e.status === "declined" ||
    e.status === "superseded" ||
    (e.status === "sent" && isExpired(e))
  );
}

const STATUS_STAMP: Record<string, { cls: string; label: string }> = {
  draft: { cls: "ink", label: "Draft" },
  declined: { cls: "bad", label: "Declined" },
  superseded: { cls: "ink", label: "Superseded" },
  sent: { cls: "info", label: "Sent" },
  accepted: { cls: "good", label: "Accepted" },
};

function StatusPill({ e }: { e: Estimate }) {
  if (e.status === "sent" && isExpired(e)) {
    return <SoftPill tone="bad">Expired</SoftPill>;
  }
  const s = STATUS_STAMP[e.status] ?? { cls: "ink", label: e.status };
  return <SoftPill tone={s.cls as PillTone}>{s.label}</SoftPill>;
}

export function QuoteSweepModalContent() {
  const close = useCloseModal();
  const estimates = useAppStore((s) => s.estimates);
  const leads = useAppStore((s) => s.leads);
  const updateEstimate = useAppStore((s) => s.updateEstimate);
  const deleteEstimate = useAppStore((s) => s.deleteEstimate);
  const restoreEstimate = useAppStore((s) => s.restoreEstimate);

  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [deleteArmed, setDeleteArmed] = useState(false);

  const live = estimates.filter((e) => !e.archived);
  const clutter = live.filter(isClutter);
  const rest = live.filter((e) => !isClutter(e));
  // Archived quotes restore HERE now — archive is a state on the record, not a
  // Settings destination (the old Settings → Archive tab is retired).
  const archived = estimates.filter((e) => e.archived);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setChecked(new Set(live.map((e) => e.id)));
  }

  function apply(mode: SweepMode) {
    const ids = [...checked];
    if (!ids.length) return;
    if (mode === "delete" && !deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    ids.forEach((id) => {
      if (mode === "delete") deleteEstimate(id);
      else updateEstimate(id, { archived: true });
    });
    close();
  }

  function row(e: Estimate) {
    const l = leads.find((x) => x.id === e.leadId);
    return (
      <div className="sweeprow" key={e.id}>
        <input
          type="checkbox"
          aria-label={`Select ${e.num} — ${e.title}`}
          checked={checked.has(e.id)}
          onChange={() => toggle(e.id)}
        />
        <b className="sweeptitle">
          {e.num} — {e.title}
        </b>
        <span className="muted">{l ? l.name : ""}</span>
        <StatusPill e={e} />
        <span className="muted">{fmt$(estTotal(e))}</span>
      </div>
    );
  }

  return (
    <>
      <div className="sheet-head">
        <h2>Clean up quotes</h2>
      </div>
      <p className="muted" style={{ marginBottom: "var(--space-3)" }}>
        Check anything you want out of the way.{" "}
        <button type="button" className="linklike" onClick={selectAll}>
          Select all
        </button>
      </p>

      <div style={{ maxHeight: 320, overflowY: "auto" }}>
        {clutter.length > 0 && (
          <>
            <div className="navlabel" style={{ padding: "var(--space-2xs) 0 var(--space-2)" }}>
              Paper pile — drafts, declined, superseded, expired
            </div>
            {clutter.map(row)}
          </>
        )}
        {rest.length > 0 && (
          <>
            <div
              className="navlabel"
              style={{ padding: `${clutter.length ? "var(--space-3)" : "var(--space-2xs)"} 0 var(--space-2)` }}
            >
              Live — out the door or won
            </div>
            {rest.map(row)}
          </>
        )}
        {live.length === 0 && <div className="empty-att">No quotes on file.</div>}
        {archived.length > 0 && (
          <>
            <div
              className="navlabel"
              style={{ padding: `${live.length ? "var(--space-3)" : "var(--space-2xs)"} 0 var(--space-2)` }}
            >
              Archived — {archived.length}
            </div>
            {archived.map((e) => {
              const l = leads.find((x) => x.id === e.leadId);
              return (
                <div className="sweeprow" key={e.id}>
                  <b className="sweeptitle">
                    {e.num} — {e.title}
                  </b>
                  <span className="muted">{l ? l.name : ""}</span>
                  <span className="muted">{fmt$(estTotal(e))}</span>
                  <button
                    className="btn sm"
                    aria-label={`Restore ${e.num}`}
                    onClick={() => restoreEstimate(e.id)}
                  >
                    ↩ Restore
                  </button>
                </div>
              );
            })}
          </>
        )}
      </div>

      <div className="sheet-foot" style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        <button
          className="btn ghost"
          style={{ color: "var(--red)", borderColor: deleteArmed ? "var(--red)" : undefined }}
          onClick={() => apply("delete")}
        >
          {deleteArmed ? `⚠ Really delete ${checked.size}? Tap again` : "Delete checked"}
        </button>
        <button className="sheet-pri" onClick={() => apply("archive")}>
          Archive checked
        </button>
      </div>
    </>
  );
}
