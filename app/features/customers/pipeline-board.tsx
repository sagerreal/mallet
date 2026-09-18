"use client";

import { useState } from "react";
import { api } from "@/lib/trpc/client";
import { useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { StagePill } from "@/components/shared/stage-pill";
import { LEAD_GROUP_LABELS, type LeadGroup } from "@/modules/customers/infra/lead-views";
import { PipelineSetup } from "./pipeline-setup";
import { PipelineStageHead, AddStage } from "./pipeline-stage-head";
import { usePipelineStageMutations } from "./use-pipeline-stage-mutations";

/**
 * features/customers/pipeline-board.tsx
 * The Customers page's Pipeline view — the shop's OWN stages as a kanban, .board/.col/.kcard,
 * the same classes the work board draws with.
 *
 * MANUAL BY DESIGN. Columns are the shop's process vocabulary and Mallet never moves a card
 * itself — the deliberate opposite of the work board, whose columns are derived and undraggable.
 * The honesty device is on the card instead: every card carries its DERIVED work fact (the same
 * "where they are" pill as the list), so a card parked in "Follow-up" with a paid invoice shows
 * the contradiction rather than hiding it.
 *
 * Drag is pointer-only, so it is never the only path: tapping a card opens the customer sheet,
 * and the sheet's "Pipeline stage" row is the keyboard/mobile way to move a customer.
 */

/** Per-column page. A column is a working set, not an archive — Load more paginates the rest. */
const COLUMN_PAGE = 25;

/** A card mid-flight: rendered in its target column before the server confirms. */
interface PendingMove {
  readonly leadId: string;
  readonly fromStageId: string | null;
  readonly toStageId: string | null;
  readonly card: CardData;
}

interface CardData {
  readonly id: string;
  readonly name: string;
  readonly address: string | null;
  readonly group: string | null;
}

export function PipelineBoard() {
  const board = api.v1.customers.pipeline.board.useQuery(undefined, { refetchOnWindowFocus: false });
  // Optimistic, narrow-settling stage edits — the why lives with the hook.
  const { seed, createStage, renameStage, removeStage, moveStage, boardCache, invalidateColumns } =
    usePipelineStageMutations();

  // The in-flight moves overlay: instant feedback on drop, cleared when the server settles.
  // On error the entry clears WITHOUT invalidating, so the card visibly snaps back home.
  const [moves, setMoves] = useState<readonly PendingMove[]>([]);
  const setLeadStage = api.v1.customers.pipeline.setLeadStage.useMutation({
    onSettled: (_d, _e, vars) => setMoves((m) => m.filter((x) => x.leadId !== vars.leadId)),
  });

  const drop = (leadId: string, card: CardData, fromStageId: string | null, toStageId: string | null) => {
    if (setLeadStage.isPending) return; // one move at a time — the overlay holds one truth
    setMoves((m) => [...m.filter((x) => x.leadId !== leadId), { leadId, fromStageId, toStageId, card }]);
    setLeadStage.mutate(
      { leadId, stageId: toStageId },
      {
        // Settle the board head and ONLY the two columns this move touched.
        onSuccess: () => {
          void boardCache.invalidate();
          invalidateColumns([fromStageId, toStageId]);
        },
      },
    );
  };

  if (board.isLoading) return <p className="muted">Loading…</p>;
  if (board.isError || !board.data) {
    return (
      <div className="empty-att">
        <p>Couldn’t load the pipeline.</p>
        <button type="button" className="btn" onClick={() => void board.refetch()}>Try again</button>
      </div>
    );
  }

  if (board.data.stages.length === 0) {
    return <PipelineSetup seeding={seed.isPending} onPick={(template) => seed.mutate({ template })} />;
  }

  const stages = board.data.stages;
  return (
    <div className="board" data-testid="pipeline-board">
      <PipelineColumn
        title="Not staged"
        stageId={null}
        count={board.data.unstaged}
        moves={moves}
        onDrop={drop}
      />
      {stages.map((s, i) => (
        <PipelineColumn
          key={s.id}
          title={s.name}
          stageId={s.id}
          count={s.count}
          moves={moves}
          onDrop={drop}
          head={
            <PipelineStageHead
              name={s.name}
              count={
                s.count +
                moves.filter((m) => m.toStageId === s.id).length -
                moves.filter((m) => m.fromStageId === s.id).length
              }
              first={i === 0}
              last={i === stages.length - 1}
              onRename={(name) => renameStage.mutate({ id: s.id, name })}
              onMove={(direction) => moveStage.mutate({ id: s.id, direction })}
              onRemove={() => removeStage.mutate({ id: s.id })}
            />
          }
        />
      ))}
      <AddStage disabled={createStage.isPending} onAdd={(name) => createStage.mutate({ name })} />
    </div>
  );
}

function PipelineColumn({
  title,
  stageId,
  count,
  moves,
  onDrop,
  head,
}: {
  title: string;
  stageId: string | null;
  count: number;
  moves: readonly PendingMove[];
  onDrop: (leadId: string, card: CardData, fromStageId: string | null, toStageId: string | null) => void;
  head?: React.ReactNode;
}) {
  const openModal = useOpenModal();
  const [over, setOver] = useState(false);
  const list = api.v1.customers.list.useInfiniteQuery(
    { limit: COLUMN_PAGE, pipelineStage: stageId ?? "none" },
    { getNextPageParam: (last) => last.nextCursor, refetchOnWindowFocus: false },
  );

  const loaded: CardData[] = (list.data?.pages ?? []).flatMap((p) =>
    p.items.map((l) => ({ id: l.id, name: l.name, address: l.address, group: l.group })),
  );
  // The overlay: moved-out cards leave immediately, moved-in cards arrive immediately.
  const outbound = new Set(moves.filter((m) => m.toStageId !== stageId).map((m) => m.leadId));
  const inbound = moves.filter((m) => m.toStageId === stageId && !loaded.some((c) => c.id === m.leadId));
  const cards = [...inbound.map((m) => m.card), ...loaded.filter((c) => !outbound.has(c.id))];
  // The head count follows the overlay too — a card that visibly moved must count where it sits.
  // Outbound is measured against LOADED cards only: a card can only be dragged if this column
  // rendered it, so an unloaded outbound card cannot exist.
  const shownCount = count + inbound.length - loaded.filter((c) => outbound.has(c.id)).length;

  return (
    <div
      className={over ? "col pipe-over" : "col"}
      data-testid={`pipeline-col-${stageId ?? "none"}`}
      onDragOver={(e) => {
        e.preventDefault(); // required, or the browser refuses the drop
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const raw = e.dataTransfer.getData("application/x-mallet-lead");
        if (!raw) return; // something else was dragged in — not ours, not an error
        const { from, ...card } = JSON.parse(raw) as CardData & { from: string | null };
        if (from === stageId) return; // dropped back where it started — a no-op, not a write
        onDrop(card.id, card, from, stageId);
      }}
    >
      {head ?? (
        <div className="col-head">
          <span>{title}</span>
          <span className="sum">{shownCount}</span>
        </div>
      )}
      {cards.map((c) => (
        <div
          key={c.id}
          className="kcard"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData("application/x-mallet-lead", JSON.stringify({ ...c, from: stageId }));
            e.dataTransfer.effectAllowed = "move";
          }}
          onClick={() => openModal(MODAL.LEAD, { leadId: c.id })}
        >
          <div className="nm">
            {/* Keyboard access is the name button (rowopen device, docs/design-system.md §3) —
                it opens the sheet, where the stage picker is the non-drag way to move. */}
            <button
              type="button"
              className="cname rowopen"
              onClick={(e) => {
                e.stopPropagation();
                openModal(MODAL.LEAD, { leadId: c.id });
              }}
            >
              {c.name}
            </button>
          </div>
          {c.address ? <div className="kjob">{c.address}</div> : null}
          {/* The derived fact — the same pill as the list. The column is the shop's intention;
              this is what is actually true of the customer. Both stay visible. */}
          {c.group ? (
            <div className="ktrace kmeta">
              <StagePill stage={LEAD_GROUP_LABELS[c.group as LeadGroup] ?? c.group} />
            </div>
          ) : null}
        </div>
      ))}
      {cards.length === 0 && !list.isLoading ? <p className="pipe-colempty">No customers here</p> : null}
      {list.hasNextPage ? (
        <button type="button" className="btn sm ghost pipe-more" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
          {list.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </div>
  );
}
