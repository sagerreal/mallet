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
import { leadVal } from "./pipeline-utils";
import type { DragHandlers } from "./use-lead-drag";
import { fmt$ } from "@/lib/format";

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
    // Oldest-first: flagged cards (age > stage norm) naturally float above
    // healthy ones because their ages are strictly larger.
    return [...ls].sort((a, b) => b.age - a.age);
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
