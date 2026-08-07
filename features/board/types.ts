/**
 * features/board/types.ts
 * The shape of the work board: every open piece of work as ONE card, in one of
 * four columns. Types only — the rules that put a card in a column live in
 * derive.ts, and nothing here knows about React, the store or a query.
 */

import type { OkItem } from "@/features/home/derive";

export type BoardColumnId = "requests" | "quoting" | "jobs" | "billing";
export type BoardItemKind = "lead" | "estimate" | "job" | "invoice";

/**
 * How a card READS, not what it is: `attention` = the shop owes the next move,
 * `waiting` = somebody else does, `active` = happening right now, `overdue` =
 * past a date the customer agreed to.
 */
export type BoardTone = "attention" | "waiting" | "active" | "overdue";

export interface BoardItem {
  /** Stable: `bl-<leadId>` | `be-<estId>` | `bj-<jobId>` | `bi-<invId>`. */
  key: string;
  kind: BoardItemKind;
  column: BoardColumnId;
  /** Modal target id for `kind`. */
  refId: string;
  leadId?: string;
  /** Customer name. */
  name: string;
  /** Job / estimate / invoice title. */
  service: string;
  /** 0 = unpriced — the card renders blank, NEVER "$0". */
  valueDollars: number;
  /** "Reminder due" | "Scheduled" | … */
  stateLabel: string;
  tone: BoardTone;
  needsAction: boolean;
  /** Reused verbatim from the source row's own stamp ("Quiet 3 days"). */
  ageLabel: string;
  /** Present ⇒ a prepared text renders on the card. */
  ok?: OkItem;
}

export interface BoardColumn {
  id: BoardColumnId;
  /** "New requests" | "Estimates & quotes" | "Jobs" | "Billing" */
  title: string;
  /** needsAction pinned first — see rankItems. */
  items: BoardItem[];
  /** The server's count when it has one, else the loaded items. */
  count: number;
  valueDollars: number;
  truncated: boolean;
}

export interface WorkBoardData {
  columns: [BoardColumn, BoardColumn, BoardColumn, BoardColumn];
  needsYou: { count: number; valueDollars: number; textsReady: number };
  isFetched: boolean;
  isError: boolean;
}
