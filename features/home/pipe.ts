/**
 * features/home/pipe.ts
 *
 * The shared vocabulary of the Dashboard's headline tiles: the shape of one tile, and how many
 * quiet days make a quote "going cold".
 *
 * The tiles themselves are BUILT in features/home/use-home-pipe.ts, from figures each module
 * computes in the database. This file used to derive them here by adding up store collections —
 * one page each, with three of the six joining ACROSS two capped collections — so the first
 * screen of the app stated money derived from whatever happened to be cached. On the real org
 * that meant "$0 owed" while $516.56 genuinely was.
 */


/** A quote is "going cold" once the customer has been silent this many business days. */
export const QUOTE_COLD_DAYS = 2;

export interface PipeStage {
  key: string;
  label: string;
  value: string;
  /** One quiet context line, ≤6 words. */
  sub: string;
  /** A red fragment prepended to the sub (overdue) — rationed to real urgency. */
  red: string | null;
  /** Amber emphasis: a money leak the owner should clear here. */
  leak: boolean;
  href: string;
}
