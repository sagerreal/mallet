/**
 * features/board/work-board.tsx
 * THE BOARD: four columns, always, in the order work moves through the shop — and inside each
 * one, the cards that need the SHOP pinned to the top under a label that says so.
 *
 * The grouping is the readability. A column that mixed "needs quote" into "waiting on the
 * customer" would be a list of records; grouped, it is a board an owner can read at a glance and
 * act on from the top down. The order comes from `rankItems` upstream and is preserved here —
 * this only partitions.
 *
 * No fetching, no store reads except the one carrier fact every Send has to answer to
 * (`useSmsReady`), which is a selector over already-hydrated state, not a query.
 */

"use client";

import { Fragment } from "react";
import { fmt$ } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { useSmsGate, type SmsGate } from "@/features/a2p/use-sms-ready";
import type { DraftContext } from "@/features/home/drafts";
import { BADGE_TONE, BoardCard } from "./board-card";
import { GHOST_CARDS, GHOST_TAG } from "./ghosts";
import { cardSendOf, useBoardSends, type BoardSends } from "./use-board-sends";
import type { BoardColumn, BoardColumnId, BoardItem, WorkBoardData } from "./types";

/** The three shapes a column's work comes in, in the order an owner should meet them. */
type BoardGroupKey = "action" | "field" | "waiting";
const GROUP_ORDER: readonly BoardGroupKey[] = ["action", "field", "waiting"];

/** The shop's own move — the only group that is amber, in every column. */
const ACTION_LABEL = "Needs action";
/** A crew is on it right now. Only the Jobs column produces `active` cards. */
const FIELD_LABEL = "Scheduled / in field";
/** Somebody else's turn, named in the column's own terms rather than a generic "Waiting". */
const PASSIVE_LABEL: Record<BoardColumnId, string> = {
  requests: "Waiting for customer",
  quoting: "Waiting for customer",
  jobs: "Scheduled / waiting",
  billing: "Awaiting payment",
};

export interface BoardGroup {
  key: BoardGroupKey;
  label: string;
  /** The shop owes this group the next move — it reads amber and sits first. */
  attention: boolean;
  items: BoardItem[];
}

const groupKeyOf = (item: BoardItem): BoardGroupKey =>
  item.needsAction ? "action" : item.tone === "active" ? "field" : "waiting";

function groupLabel(key: BoardGroupKey, column: BoardColumnId): string {
  if (key === "action") return ACTION_LABEL;
  if (key === "field") return FIELD_LABEL;
  return PASSIVE_LABEL[column];
}

/**
 * The scroll frame both boards share.
 *
 * `tabIndex={0}` is load-bearing, not decoration. `.board` is `overflow-x:auto`, and a scrollable
 * region a keyboard cannot reach is WCAG 2.1.1 (axe `scrollable-region-focusable`). A busy live
 * board satisfies that rule by accident, because its cards carry focusable name buttons — but the
 * two boards that do NOT are exactly the ones a keyboard user is most stranded on: the first-run
 * board, whose example cards are inert by construction, and an established shop's board on a day
 * it is cleared. Either way the columns to the right could not be scrolled to without a mouse.
 *
 * Named rather than left as a bare focus stop, so what has been focused is announced.
 */
function BoardFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="board" tabIndex={0} role="group" aria-label="Work board">
      {children}
    </div>
  );
}

/**
 * The column shell — title, header, and body container. Both the live and first-run boards render
 * identical markup here; they differ only in what fills the body.
 */
function ColumnShell({
  column,
  figure,
  children,
}: {
  column: BoardColumn | { id: BoardColumnId; title: string };
  figure: string | number;
  children: React.ReactNode;
}) {
  return (
    <section className="col" aria-label={`${column.title} column`}>
      <div className="col-head">
        <span>{column.title}</span>
        <span className="sum fig">{figure}</span>
      </div>
      {children}
    </section>
  );
}

/**
 * A column's cards, partitioned and labelled. Empty groups are dropped — a header over nothing is
 * a fact about a shape, not about the business. Order inside a group is the order it arrived in,
 * which is `rankItems`' total order.
 */
export function boardGroups(column: BoardColumn): BoardGroup[] {
  return GROUP_ORDER.map((key) => ({
    key,
    label: groupLabel(key, column.id),
    attention: key === "action",
    items: column.items.filter((item) => groupKeyOf(item) === key),
  })).filter((group) => group.items.length > 0);
}

/** "2 · $5,780" — what the column holds. The money is silent when there is none to state. */
function headFigure(column: BoardColumn): string {
  return column.valueDollars > 0
    ? `${column.count} · ${fmt$(column.valueDollars)}`
    : String(column.count);
}

function BoardColumnView({
  column,
  gate,
  sends,
  onOpen,
  ctx,
}: {
  column: BoardColumn;
  gate: SmsGate;
  sends: BoardSends;
  onOpen(item: BoardItem): void;
  ctx: DraftContext;
}) {
  return (
    <ColumnShell column={column} figure={headFigure(column)}>
      {boardGroups(column).map((group) => (
        <Fragment key={group.key}>
          <div className={`kgrp${group.attention ? " on" : ""}`}>
            {group.attention && <span className="kdot" aria-hidden="true" />}
            <span>{group.label}</span>
            <span className="kcount fig">{group.items.length}</span>
          </div>
          {group.items.map((item) => (
            <BoardCard
              key={item.key}
              item={item}
              smsReady={gate.ready}
              smsBlockedReason={gate.reason ?? undefined}
              onOpen={onOpen}
              ctx={ctx}
              send={item.ok ? cardSendOf(sends, item.key, item.ok.key) : undefined}
            />
          ))}
        </Fragment>
      ))}

      {/* A page of a longer list, stated as a fact. The column is capped on purpose; an apology
          would suggest something went wrong. */}
      {column.truncated && <div className="kfoot">Showing first {column.items.length}</div>}
    </ColumnShell>
  );
}

/**
 * ONE DRAWN CARD. Every property that keeps this a drawing rather than a record is in this one
 * element and none of them is decorative:
 *
 * - `aria-hidden` — a screen reader that read these out would be reading out four customers who do
 *   not exist. The column heading and its 0 carry the whole meaning without them.
 * - no button, no link, no tabindex, no onClick — nothing to open, and nothing the keyboard can
 *   land on. Inertness lives in the MARKUP, not in a disabled handler; `.ghosted` then removes the
 *   pointer and hover so the look cannot promise what the markup won't do.
 * - no money — see ghosts.ts.
 */
function GhostCardView({ column }: { column: BoardColumnId }) {
  const ghost = GHOST_CARDS[column];
  return (
    <div className="kcard ghosted" aria-hidden="true">
      <div className="kgrp">{GHOST_TAG}</div>
      <div className="nm">
        <span className="cname">{ghost.name}</span>
      </div>
      <div className="kjob">{ghost.service}</div>
      <div className="ktrace kmeta">
        <Badge tone={BADGE_TONE[ghost.tone]}>{ghost.badge}</Badge>
        <span className="fig">{ghost.state}</span>
      </div>
    </div>
  );
}

/** A first-run column: its real title, a hard 0, and the one card that shows what lands here. */
function GhostColumnView({ column }: { column: BoardColumn }) {
  return (
    <ColumnShell column={column} figure={0}>
      <GhostCardView column={column.id} />
    </ColumnShell>
  );
}

/**
 * The board a shop meets on day one: the same four columns, drawn. The live board's data is not
 * consulted beyond the column titles — no items, no counts, no money — so nothing real can leak
 * onto the teaching screen even if the caller's verdict and the data disagree.
 */
function FirstRunBoard({ columns }: { columns: WorkBoardData["columns"] }) {
  return (
    <BoardFrame>
      {columns.map((column) => (
        <GhostColumnView key={column.id} column={column} />
      ))}
    </BoardFrame>
  );
}

/** The board with the shop's real work on it. Holds the send ledger and the carrier gate. */
function LiveBoard({
  data,
  onOpen,
  ctx,
}: {
  data: WorkBoardData;
  onOpen(item: BoardItem): void;
  ctx: DraftContext;
}) {
  const gate = useSmsGate();
  const sends = useBoardSends();

  return (
    <BoardFrame>
      {data.columns.map((column) => (
        <BoardColumnView
          key={column.id}
          column={column}
          gate={gate}
          sends={sends}
          onOpen={onOpen}
          ctx={ctx}
        />
      ))}
    </BoardFrame>
  );
}

export function WorkBoard({
  data,
  firstRun,
  onOpen,
  ctx,
}: {
  data: WorkBoardData;
  /** A shop with nothing open yet gets the four columns DRAWN — see FirstRunBoard. The setup
   *  brief that goes above them belongs to the page, which owns the modals and the tabs. */
  firstRun: boolean;
  onOpen(item: BoardItem): void;
  /**
   * The org/owner names the on-card drafts sign off with. REQUIRED, not defaulted: the fallback
   * signs every reminder "us here", which is a worse text than a compile error is a bug. The
   * dashboard already computes both (app/(office)/dashboard/page.tsx).
   */
  ctx: DraftContext;
}) {
  // Two components rather than one branch inside the board: the first-run path then holds no send
  // ledger and no carrier gate at all, so "a ghost cannot send a text" is true by construction
  // rather than by review.
  if (firstRun) return <FirstRunBoard columns={data.columns} />;
  return <LiveBoard data={data} onOpen={onOpen} ctx={ctx} />;
}

/** The board's shape while the first read is in flight — one skeleton, one reveal. */
export function WorkBoardSkeleton() {
  const columns = ["New requests", "Estimates & quotes", "Jobs", "Billing"];
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="board" aria-hidden="true">
        {columns.map((title) => (
          <div className="col" key={title}>
            <div className="col-head">
              <span>{title}</span>
              <span className="sum" />
            </div>
            {Array.from({ length: 3 }).map((_, i) => (
              <div className="kcard" key={i}>
                <div className="sk sk-nm" />
                <div className="sk sk-job" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
