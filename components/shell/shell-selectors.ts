/**
 * components/shell/shell-selectors.ts
 * Pure selector functions for shell badge counts — extracted so they can be
 * unit-tested independently of the React components.  The component subscriptions
 * call these inline: `useAppStore((s) => selectOpenTaskCount(s))`.
 */

import type { AppStore } from "@/lib/store/app-store";

/** Number of incomplete tasks — Tasks sub-nav badge. */
export function selectOpenTaskCount(s: Pick<AppStore, "tasks">): number {
  return s.tasks.filter((t) => !t.done).length;
}

/** Sent quotes awaiting an answer — Quotes sub-nav badge (the paper out the door). */
export function selectSentQuoteCount(s: Pick<AppStore, "estimates">): number {
  return s.estimates.filter((e) => !e.archived && !e.trash && e.status === "sent").length;
}

/** Active (non-archived) customer/lead count — Customers nav badge. */
export function selectCustomerCount(s: Pick<AppStore, "leads">): number {
  return s.leads.filter((l) => !l.archived).length;
}

/** Non-archived, non-done job count — Jobs nav badge. */
export function selectJobsCount(s: Pick<AppStore, "jobs">): number {
  return s.jobs.filter((j) => !j.archived && j.status !== "done").length;
}

/** Unscheduled (no slot) job count — Schedule sub-nav badge. */
export function selectUnscheduledCount(s: Pick<AppStore, "jobs">): number {
  return s.jobs.filter((j) => !j.archived && j.status === "unscheduled").length;
}

/** Outstanding invoice count (sent or partial) — Money nav badge. */
export function selectMoneyCount(s: Pick<AppStore, "invoices">): number {
  return s.invoices.filter(
    (i) => !i.archived && (i.status === "sent" || i.status === "partial")
  ).length;
}
