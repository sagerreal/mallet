/**
 * features/pipeline/index.tsx
 * Thin orchestrator: reads store, computes derived counts, renders toolbar + board.
 * Replaces the monolith in app/(office)/pipeline/page.tsx.
 */

"use client";

import { useState, useMemo } from "react";
import { useLeads, useEstimates } from "@/lib/store/app-store";
import { PipelineToolbar } from "./pipeline-toolbar";
import { PipelineBoard } from "./pipeline-board";
import { ACTIVE_STAGES, STALE_AGE } from "./pipeline-constants";

export function PipelineView() {
  const leads = useLeads();
  const estimates = useEstimates();
  const [boardQ, setBoardQ] = useState("");

  const activeLeads = useMemo(
    () =>
      leads.filter(
        (l) => !l.archived && !l.book && ACTIVE_STAGES.includes(l.stage)
      ),
    [leads]
  );

  const activeCount = activeLeads.length;

  const staleCount = useMemo(
    () => activeLeads.filter((l) => l.age >= STALE_AGE).length,
    [activeLeads]
  );

  // Prototype: search bar only appears once > 20 active leads on the board
  const showSearch = activeCount > 20;

  return (
    <div>
      <PipelineToolbar
        activeCount={activeCount}
        staleCount={staleCount}
        boardQ={boardQ}
        onBoardQ={setBoardQ}
        showSearch={showSearch}
      />
      <PipelineBoard leads={leads} estimates={estimates} boardQ={boardQ} />
    </div>
  );
}
