"use client";

/**
 * features/artie/artie-board.tsx
 * The board a shop owner actually looks at: four columns, Needs you first, because the queue of
 * things Artie cannot do alone IS the shop's work list — the same reasoning that puts "Not
 * staged" first on the customers pipeline board (features/customers/pipeline-board.tsx).
 *
 * Rides the same kanban classes as the work board and the pipeline board — `.board > .col >
 * .kcard`, `.col-head` with a `.sum` count — and adds no new CSS. Reads `useArtieTasks`, which
 * fetches ONE PAGE PER COLUMN (batched into a single HTTP request) so open work can never fall off
 * the board, and whose counts come from the same rows the cards do.
 */

import { agoShort } from "@/lib/format";
import { isFirstLoad, shouldShowFirstRun, shouldShowLoadFailed } from "@/lib/first-run";
import { ListLoading } from "@/components/shared/list-loading";
import { LoadFailed } from "@/components/shared/load-failed";
import { FirstRunEmptyState } from "@/components/shared/first-run-empty-state";
import { ARTIE_COPY } from "./artie-copy";
import { useArtieTasks, type ArtieStatus, type ArtieTask } from "./use-artie-tasks";

function TaskCard({ task, onOpen }: { task: ArtieTask; onOpen: (taskId: string) => void }) {
  return (
    <div className="kcard" onClick={() => onOpen(task.id)}>
      <div className="nm">
        {/* .rowopen device (docs/design-system.md §3): the card keeps its mouse onClick, this
            button carries keyboard access — the title IS the open control. */}
        <button
          type="button"
          className="cname rowopen"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(task.id);
          }}
        >
          {task.title}
        </button>
      </div>
      {/* The single most important text on this screen: what Artie says it needs. Full room in
          .kjob, never truncated to a chip. */}
      {task.nextActionNote ? <div className="kjob">{task.nextActionNote}</div> : null}
      <div className="ktrace kmeta">
        <span>{agoShort(task.updatedAt)}</span>
      </div>
    </div>
  );
}

function ArtieColumn({
  columnKey,
  label,
  tasks,
  truncated,
  onOpen,
}: {
  columnKey: ArtieStatus;
  label: string;
  tasks: readonly ArtieTask[];
  truncated: boolean;
  onOpen: (taskId: string) => void;
}) {
  return (
    <section className="col" data-testid={`artie-col-${columnKey}`} aria-label={`${label} column`}>
      <div className="col-head" data-testid="artie-col-head">
        <span>{label}</span>
        {/* "25+" when the status holds more rows than this page fetched. A bare "25" beside a
            column that actually has hundreds is a count that lies; the finished columns are a
            recent view on purpose (there is no archive path yet), so it has to say so. */}
        <span className="sum">{truncated ? `${tasks.length}+` : tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <p className="muted">{ARTIE_COPY.emptyColumn}</p>
      ) : (
        tasks.map((task) => <TaskCard key={task.id} task={task} onOpen={onOpen} />)
      )}
    </section>
  );
}

export interface ArtieBoardProps {
  readonly onOpen: (taskId: string) => void;
  /** Opens the new-task composer. Optional so the board still renders standalone (tests, a
   *  future embed); the page always supplies a real handler — this is never reachable unwired
   *  in the shipped product. */
  readonly onNewTask?: () => void;
}

export function ArtieBoard({ onOpen, onNewTask }: ArtieBoardProps) {
  const board = useArtieTasks();
  // The shared predicate a list surface's four states are built from (lib/first-run.ts, which
  // names "Tasks" as an intended consumer) — called directly rather than re-encoding the same
  // isFetched/isError/count logic here, where a future edit to either side could silently diverge.
  const listState = { isFetched: board.isFetched, isError: board.isError, count: board.total };

  if (isFirstLoad(listState)) return <ListLoading />;
  if (shouldShowLoadFailed(listState)) {
    return (
      <LoadFailed noun={ARTIE_COPY.loadFailedNoun} onRetry={() => void board.refetch()} retrying={board.isRefetching} />
    );
  }

  // First-run is a BANNER above the board, not a replacement for it — the same shape as
  // WorkBoard/TodayPane (features/board/work-board.tsx), which draws its four columns under the
  // setup brief rather than swapping them out. The four columns are real work-list structure even
  // on day one; hiding them would teach a new shop nothing about what it's looking at.
  const firstRun = shouldShowFirstRun(listState);

  return (
    <>
      {firstRun ? (
        <FirstRunEmptyState
          heading={ARTIE_COPY.firstRun.heading}
          subtext={ARTIE_COPY.firstRun.subtext}
          paths={[{ ...ARTIE_COPY.firstRun.add, onAction: onNewTask ?? (() => {}), variant: "primary" }]}
        />
      ) : null}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- same scrollable-region
          fix the work board's BoardFrame uses: .board is overflow-x:auto and axe flags it
          unreachable by keyboard without this on a board whose cards don't already carry a
          focusable child (an empty/first-run board has none). */}
      <div className="board" data-testid="artie-board" tabIndex={0} role="group" aria-label="Artie's tasks">
        {board.columns.map((column) => (
          <ArtieColumn
            key={column.key}
            columnKey={column.key}
            label={ARTIE_COPY.columns[column.key]}
            tasks={column.tasks}
            truncated={column.truncated}
            onOpen={onOpen}
          />
        ))}
      </div>
    </>
  );
}
