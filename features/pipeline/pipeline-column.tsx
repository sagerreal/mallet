/**
 * features/pipeline/pipeline-column.tsx
 * One stage column: header (label, count, $ sum), list of cards, drop zone.
 * Fold logic: columns with >20 leads show flagged cards + a fold bar.
 */

"use client";

import { useState, useMemo } from "react";
import type { Lead, Estimate } from "@/lib/store/types";
import { PipelineCard } from "./pipeline-card";
import {
  stageNorm,
  STAGE_LABEL,
  WON_WINDOW_DAYS,
} from "./pipeline-constants";
import type { DragHandlers } from "./use-lead-drag";

function fmt$(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function estTotal(e: Estimate): number {
  const p = e.pricing ?? { disc: 0, dep: 0, tax: 0 };
  const sub = e.lines.filter((l) => !l.opt).reduce((s, l) => s + l.q * l.r, 0);
  const disc = sub * ((p.disc ?? 0) / 100);
  return (sub - disc) * (1 + (p.tax ?? 0) / 100);
}

function leadVal(lead: Lead, estimates: Estimate[]): number {
  const e = estimates.find((e) => e.leadId === lead.id && e.status !== "draft");
  return e ? estTotal(e) : (lead.value ?? 0);
}

interface PipelineColumnProps {
  stage: string;
  leads: Lead[];
  estimates: Estimate[];
  dragHandlers: DragHandlers;
}

export function PipelineColumn({
  stage,
  leads,
  estimates,
  dragHandlers,
}: PipelineColumnProps) {
  const [expanded, setExpanded] = useState(false);

  const staged = useMemo(() => {
    let ls = leads.filter((l) => l.stage === stage);
    if (stage === "Won") ls = ls.filter((l) => l.age <= WON_WINDOW_DAYS);
    // flagged (overdue) float to top; within each group oldest-first
    return [...ls].sort(
      (a, b) => b.age - stageNorm(stage) - (a.age - stageNorm(stage))
    );
  }, [leads, stage]);

  const sum = useMemo(
    () => staged.reduce((s, l) => s + leadVal(l, estimates), 0),
    [staged, estimates]
  );

  const compact = staged.length > 7;
  const fold = staged.length > 20;
  const flagged = staged.filter((l) => l.age > stageNorm(stage));
  const healthy = staged.filter((l) => l.age <= stageNorm(stage));

  const colHead = STAGE_LABEL[stage] ?? stage;

  return (
    <div
      className="col"
      onDragOver={dragHandlers.onDragOver}
      onDragLeave={dragHandlers.onDragLeave}
      onDrop={(e) => dragHandlers.onDrop(e, stage)}
    >
      <div className="col-head">
        <span>
          {colHead}&nbsp;
          <span className="muted">{staged.length}</span>
        </span>
        <span className="sum">{sum ? fmt$(sum) : ""}</span>
      </div>

      {fold ? (
        <>
          {flagged.map((l) => (
            <PipelineCard
              key={l.id}
              lead={l}
              estimates={estimates}
              compact={compact}
              dragHandlers={dragHandlers}
            />
          ))}
          <div className="foldbar" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "▾" : "▸"} {healthy.length} on track —{" "}
            {expanded ? "hide" : "show"}
          </div>
          {expanded &&
            healthy.map((l) => (
              <PipelineCard
                key={l.id}
                lead={l}
                estimates={estimates}
                compact={compact}
                dragHandlers={dragHandlers}
              />
            ))}
        </>
      ) : staged.length > 0 ? (
        staged.map((l) => (
          <PipelineCard
            key={l.id}
            lead={l}
            estimates={estimates}
            compact={compact}
            dragHandlers={dragHandlers}
          />
        ))
      ) : (
        <div className="empty-att" style={{ padding: "24px 0" }}>
          —
        </div>
      )}
    </div>
  );
}
