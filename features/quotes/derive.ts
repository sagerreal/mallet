/**
 * features/quotes/derive.ts
 * Pure derivations for the Rail. The page's job: what the CUSTOMER is doing to
 * your paper — so every unit here keys off customer action (reads), never shop
 * action. Bands are geography (shop / out / won), warmth is honest (business
 * days since the customer touched it, reset by nothing else), and the one hero
 * figure is the money currently sitting on customers' phones.
 */

import { estTotal } from "@/lib/estimates";
import { firstName, visitLabel } from "@/features/home/derive";
import type { Estimate, EstimateRead, Job, Lead } from "@/lib/store/types";

export const WON_WINDOW_DAYS = 30;

export interface RailRow {
  est: Estimate;
  /**
   * The customer's name, for display.
   *
   * Separate from `lead` because the two answer different questions. This always has a value when
   * the server sent one, so a card can name its customer without that customer being loaded.
   * `lead` is the full record, present only when it happens to be in the store, and is used for
   * the interactive extras (drafting a message needs the phone, not just the name).
   */
  customerName: string;
  lead: Lead | null;
  total: number;
  /** Business days since the customer last touched it (Infinity = never). */
  quietDays: number;
  /** 0.5–1 ink warmth — cools one step per silent business day. */
  cool: number;
  /** Rings on the dot = reads (capped for drawing). */
  rings: number;
  /** A session is open right now — the breathing dot. */
  live: boolean;
  /** The right-rail mono stamp, ≤4 words. */
  stamp: string;
}

export interface WonRow {
  est: Estimate;
  /** The customer's name, for display — see RailRow.customerName. */
  customerName: string;
  lead: Lead | null;
  total: number;
  job: Job | null;
  /** Accepted but no visit on the board — the amber halo. */
  unscheduled: boolean;
  stamp: string;
}

export interface Rail {
  shop: RailRow[];
  out: RailRow[];
  won: WonRow[];
  /** The hero: dollars sitting on customers' phones. */
  outSum: number;
  /** One human delta line under the hero ("Maria read it twice — 9:12pm"), or null. */
  delta: string | null;
}

function lastRead(est: Estimate): EstimateRead | null {
  const reads = est.reads ?? [];
  return reads.length ? (reads[reads.length - 1] ?? null) : null;
}

function quietDaysOf(est: Estimate): number {
  const reads = est.reads ?? [];
  if (reads.length === 0) return Infinity;
  return Math.min(...reads.map((r) => r.daysAgo));
}

/** Ink cools ~12% per silent business day, floor 60% — cooler, never "disabled". */
export function coolOf(quietDays: number): number {
  if (!Number.isFinite(quietDays) || quietDays <= 0) return 1;
  return Math.max(0.6, 1 - 0.12 * quietDays);
}

function sentStamp(est: Estimate): string {
  const read = lastRead(est);
  if (!read) return `Sent ${est.age}d`;
  const quiet = quietDaysOf(est);
  if (quiet >= 2) return `Quiet ${quiet} days`;
  const n = (est.reads ?? []).length;
  return n >= 2 ? `Read ×${n} · ${read.when}` : `Read ${read.when}`;
}

function toRailRow(est: Estimate, leads: Lead[], customerName?: string | null): RailRow {
  const quiet = quietDaysOf(est);
  const reads = est.reads ?? [];
  const lead = leads.find((l) => l.id === est.leadId && !l.archived) ?? null;
  return {
    est,
    // The server's name first. Falling back to the store's copy keeps the in-memory callers
    // (features/home/pipe.ts) working unchanged; "—" is the last resort, not the normal case.
    customerName: customerName ?? lead?.name ?? "—",
    lead,
    total: estTotal(est),
    quietDays: quiet,
    cool: est.status === "draft" ? 0.45 : coolOf(quiet),
    rings: Math.min(reads.length, 3),
    live: reads.some((r) => r.live),
    stamp: est.status === "draft" ? "" : sentStamp(est),
  };
}

function toWonRow(est: Estimate, leads: Lead[], jobs: Job[], customerName?: string | null): WonRow {
  const lead = leads.find((l) => l.id === est.leadId) ?? null;
  const job = lead
    ? jobs.find((j) => !j.archived && j.leadId === lead.id) ?? null
    : null;
  const unscheduled = !job || job.status === "unscheduled";
  const nextVisit = job?.visits?.find((v) => v.date && v.start != null);
  // est.age counts from SEND — only trust it as "days since the yes" once it's
  // clearly aged; a fresh acceptance just says what it is.
  const agedYes = est.age >= 2 ? `Accepted ${est.age} days` : "Accepted";
  return {
    est,
    customerName: customerName ?? lead?.name ?? "—",
    lead,
    total: estTotal(est),
    job,
    unscheduled,
    stamp: unscheduled
      ? `${agedYes} · unscheduled`
      : nextVisit
        ? visitLabel(nextVisit).split(" ")[0] ?? "scheduled"
        : "scheduled",
  };
}

/**
 * Rail rows built from quotes the SERVER selected, each carrying its customer's name.
 *
 * No orphan filter, deliberately. deriveRail drops quotes whose customer is missing from the
 * loaded set — which was meant to hide quotes belonging to archived customers, but also hid every
 * quote whose customer simply had not loaded. Archiving cascades to quotes server-side, so rows
 * that reach here are live by construction and dropping any of them would only lose real work.
 */
export function railRowsFor(
  rows: readonly { est: Estimate; customerName: string | null }[],
  leads: Lead[],
): RailRow[] {
  return rows
    .map((r) => toRailRow(r.est, leads, r.customerName))
    .sort((a, b) => a.quietDays - b.quietDays || b.total - a.total);
}

/** Won rows from server-selected quotes. Same reasoning as railRowsFor. */
export function wonRowsFor(
  rows: readonly { est: Estimate; customerName: string | null }[],
  leads: Lead[],
  jobs: Job[],
): WonRow[] {
  return rows
    .filter((r) => r.est.age <= WON_WINDOW_DAYS)
    .map((r) => toWonRow(r.est, leads, jobs, r.customerName))
    .sort((a, b) => Number(b.unscheduled) - Number(a.unscheduled) || b.total - a.total);
}

/** The delta sentence — the newest customer act, named, or null for silence. */
export function deltaOf(out: RailRow[]): string | null {
  const withReads = out.filter((r) => (r.est.reads ?? []).length > 0 && r.lead);
  if (withReads.length === 0) return null;
  const newest = withReads.reduce((a, b) => (quietDaysOf(a.est) <= quietDaysOf(b.est) ? a : b));
  const reads = newest.est.reads ?? [];
  const last = reads[reads.length - 1];
  if (!last || last.daysAgo > 1) return null; // old news isn't a delta
  const first = firstName(newest.lead?.name ?? "");
  return reads.length >= 2
    ? `${first} read it twice — ${last.when}`
    : `${first} read it — ${last.when}`;
}


/** Dot diameter from dollars — a figure rendered as shape (√ scale, 10–17px). */
export function dotSize(total: number): number {
  return Math.round(Math.min(17, Math.max(10, 6 + Math.sqrt(total) / 9)));
}
