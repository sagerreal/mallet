"use client";

/**
 * features/customers/pipeline-stage-picker.tsx
 * The customer sheet's "Pipeline stage" row body — the NON-DRAG way to move a customer.
 *
 * The board's drag is pointer-only, so this picker is what makes placement keyboard- and
 * mobile-operable (a11y floor, docs/design-system.md). It reuses the source picker's option-list
 * classes: same question shape ("which one of the shop's own labels applies?"), same rendering.
 *
 * Stage management is deliberately NOT here — renaming or deleting a stage is board work; this
 * row answers one question about one customer.
 */

import { api } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";

export function PipelineStagePicker({ leadId, value }: { leadId: string; value: string | undefined }) {
  const setStage = useAppStore((s) => s.setLeadPipelineStage);
  // The board query is already cached when the shop uses the Pipeline tab; here it costs one read
  // the first time a sheet opens. Errors render as the row simply not offering options — the
  // SheetRow that mounts this body is itself gated on stages existing.
  const board = api.v1.customers.pipeline.board.useQuery(undefined, { refetchOnWindowFocus: false });
  const stages = board.data?.stages ?? [];

  return (
    <div className="qa-srclist">
      <div className="qa-srcrow">
        <button type="button" className={`qa-srcopt${!value ? " on" : ""}`} onClick={() => void setStage(leadId, null)}>
          <span>No stage</span>
          {!value ? <span className="qa-srcok">✓</span> : null}
        </button>
      </div>
      {stages.map((s) => (
        <div key={s.id} className="qa-srcrow">
          <button
            type="button"
            className={`qa-srcopt${value === s.id ? " on" : ""}`}
            onClick={() => void setStage(leadId, s.id)}
          >
            <span>{s.name}</span>
            {value === s.id ? <span className="qa-srcok">✓</span> : null}
          </button>
        </div>
      ))}
    </div>
  );
}
