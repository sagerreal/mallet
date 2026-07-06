/**
 * features/pipeline/pipeline-toolbar.tsx
 * Search input (boardQ), "+ New customer" button, "Clean up" button.
 * Search bar is only shown when activeCount > 20 (mirrors prototype).
 */

"use client";

import { MODAL } from "@/lib/store/modal-ids";
import { useOpenModal } from "@/lib/store/app-store";

interface PipelineToolbarProps {
  staleCount: number;
  boardQ: string;
  onBoardQ: (v: string) => void;
  showSearch: boolean;
}

export function PipelineToolbar({
  staleCount,
  boardQ,
  onBoardQ,
  showSearch,
}: PipelineToolbarProps) {
  const openModal = useOpenModal();

  return (
    <>
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <h1>Pipeline</h1>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn"
            onClick={() => openModal(MODAL.SWEEP)}
          >
            Clean up
            {staleCount > 0 && (
              <span className="pill amber" style={{ marginLeft: 2 }}>
                {staleCount}
              </span>
            )}
          </button>
          <button
            className="btn primary"
            onClick={() => openModal(MODAL.NEW_CUSTOMER)}
          >
            + New customer
          </button>
        </div>
      </div>

      <div className="sub">
        Lead → quote → won — drag a card to move it.
      </div>

      {/* Search — prototype only shows this above 20 active leads */}
      {showSearch && (
        <div className="board-tools">
          <input
            id="boardQ"
            aria-label="Search the board"
            placeholder="Jump to a name or job…"
            value={boardQ}
            onChange={(e) => onBoardQ(e.target.value)}
          />
        </div>
      )}
    </>
  );
}
