/**
 * features/pipeline/pipeline-lost-bar.tsx
 * Collapsed "Lost (N)" bar at the bottom of the board.
 * Mirrors prototype: shows count + first 6 names with loss reasons.
 */

"use client";

import type { Lead } from "@/lib/store/types";

const MAX_NAMES = 6;

interface PipelineLostBarProps {
  lostLeads: Lead[];
}

export function PipelineLostBar({ lostLeads }: PipelineLostBarProps) {
  const names = lostLeads
    .slice(0, MAX_NAMES)
    .map((l) => l.name + " · " + (l.lossReason ?? ""))
    .join(", ");

  const overflow = lostLeads.length > MAX_NAMES ? " …" : "";

  return (
    <div
      className="lostbar"
      onClick={() => {
        // Info toast — no live toast system wired yet; interaction is NOTED.
      }}
    >
      ✕ Lost ({lostLeads.length}) — {names}
      {overflow}
    </div>
  );
}
