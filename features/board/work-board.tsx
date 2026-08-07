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
import { useSmsGate, type SmsGate } from "@/features/a2p/use-sms-ready";
import type { DraftContext } from "@/features/home/drafts";
import { BoardCard } from "./board-card";
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
    // A named <section> IS a region — the role is implicit, and stating it is an a11y lint error.
    <section className="col" aria-label={`${column.title} column`}>
      <div className="col-head">
        <span>{column.title}</span>
        <span className="sum fig">{headFigure(column)}</span>
      </div>

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
    </section>
  );
}

export function WorkBoard({
  data,
  firstRun,
  onOpen,
  ctx,
}: {
  data: WorkBoardData;
  /** A shop with nothing in it yet gets the setup brief instead. */
  firstRun: boolean;
  onOpen(item: BoardItem): void;
  /**
   * The org/owner names the on-card drafts sign off with. REQUIRED, not defaulted: the fallback
   * signs every reminder "us here", which is a worse text than a compile error is a bug. The
   * dashboard already computes both (app/(office)/dashboard/page.tsx).
   */
  ctx: DraftContext;
}) {
  const gate = useSmsGate();
  const sends = useBoardSends();

  // Task 9 owns the first-run board (the setup brief + ghost cards). Rendering an empty
  // four-column skeleton in the meantime would teach a brand-new shop that its board is broken.
  if (firstRun) return null;

  return (
    <div className="board">
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
    </div>
  );
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
