/**
 * components/modals/tech-job-modal/helpers.ts
 * Pure derivations shared by the tech-job sections — ported 1:1 from the
 * prototype (svcMeta 3991, jobMode 4002, vPlaced, quoted 4567, custName 3582,
 * colLabel 3558, hmLabel 3810, tvRow 4577, curV 4586).
 */

import type { CSSProperties } from "react";
import { isEstimateJob } from "@/features/jobs/job-status-meta";
import { todayISO } from "@/lib/clock";
import type { Job, Visit, Lead, Invoice } from "@/lib/store/types";

interface SvcMeta {
  word: string;
  c: string;
}

// prototype SVC_META (line 3991) — the service word + its color.
const SVC_META: Record<string, SvcMeta> = {
  estimate: { word: "Estimate", c: "var(--amber)" },
  service: { word: "Job", c: "#9C5B34" },
  install: { word: "Job", c: "#4A639E" },
};

export function svcMeta(key: string): SvcMeta {
  return SVC_META[key] ?? SVC_META.service!;
}

export function jobTotal(j: Job): number {
  return (j.lines ?? []).reduce((s, l) => s + (l.q ?? 1) * (l.r ?? 0), 0);
}

/**
 * invPaid / invDue — ONE definition, in lib/store/invoice-balance.ts.
 *
 * This module's own copy re-derived the balance from `depPaid` + `payments`, neither of which a
 * LIST row carries, so the done card read the full total as owed until a mutation reconcile
 * loaded the real record — and back again on the next refetch.
 */
export { invPaid, invDue } from "@/lib/store/invoice-balance";

/** priced → "install" (blue), unpriced job → "service" (brown), estimate → estimate (prototype jobMode, 4002). */
export function jobMode(j: Job): string {
  if (isEstimateJob(j)) return "estimate";
  const priced = (j.lines ?? []).some((l) => (l.q ?? 1) * (l.r ?? 0) > 0);
  return priced ? "install" : "service";
}

/** A visit is PLACED once it has a day + crew + start — the tech only sees these (prototype vPlaced).
 *  One rule, one definition: see lib/store/visit-placement.ts. */
export { isVisitPlaced as vPlaced } from "@/lib/store/visit-placement";

/** The repair has an agreed price — a service-call fee alone doesn't count (prototype `quoted`, 4567). */
export function jobQuoted(j: Job): boolean {
  return (j.lines ?? []).some((l) => (l.q ?? 1) * (l.r ?? 0) > 0);
}

/**
 * A pure scoping visit: an ESTIMATE job with no priced work. Nothing to bill —
 * completing it hands the scope to the office, never a payment ask. A quote
 * signed on site writes real priced lines onto the job (jobQuoted flips true),
 * so signed estimates fall OUT of this predicate and stay billable.
 */
export function isUnpricedEstimate(j: Job): boolean {
  return jobMode(j) === "estimate" && !jobQuoted(j);
}

/** Customer name (prototype custName, 3582) — the linked lead's name, else the job title. */
export function custNameOf(j: Job, lead: Lead | undefined): string {
  if (lead) return lead.name;
  const m = (j.title ?? "").split("—");
  return m.length > 1 ? (m[1] ?? "").trim() : j.title || "Customer";
}

/** Day label (prototype colLabel, 3558) — "Today" / "Wed 3" / "Not scheduled". */
export function colLabel(iso: string | null): string {
  if (!iso) return "Not scheduled";
  const d = new Date(iso + "T12:00:00");
  if (isNaN(d.getTime())) return "Not scheduled";
  if (iso === todayISO()) return "Today";
  return d.toLocaleDateString(undefined, { weekday: "short" }) + " " + d.getDate();
}

/** Hours→"2h 30m" / "1h" (prototype hmLabel, 3810). */
export function hmLabel(h: number): string {
  const hh = +h || 0;
  let H = Math.floor(hh);
  let M = Math.round((hh - H) * 60);
  if (M === 60) {
    H++;
    M = 0;
  }
  return M ? `${H}h ${M}m` : `${H}h`;
}

/** Arrival time from a fractional hour start (prototype tvRow, 4577). */
export function startTimeStr(start: number): string {
  const hr = Math.floor(start);
  const mn = Math.round((start - hr) * 60);
  let h12 = hr % 12;
  if (!h12) h12 = 12;
  return `${h12}:${String(mn).padStart(2, "0")} ${hr < 12 ? "AM" : "PM"}`;
}

/** The current visit the timer tracks (prototype curV, 4586). */
export function currentVisit(visits: Visit[]): Visit | undefined {
  return (
    visits.find((v) => v.status === "onsite") ??
    visits.find((v) => v.status === "enroute") ??
    visits.find((v) => v.status === "scheduled") ??
    visits[0]
  );
}

/**
 * The compact bare-input treatment for the in-section composers (found-work +
 * notes). These inputs live OUTSIDE a `.field` container, so they carry their
 * own border — deliberately not `COMPACT_INPUT` (which relies on `.field`'s
 * border) and not byte-equal to it.
 */
export const AO_INPUT: CSSProperties = {
  border: "1.5px solid var(--line)",
  borderRadius: "var(--radius-sm)",
  padding: "var(--space-2) var(--space-2)",
  fontFamily: "inherit",
  fontSize: "var(--type-base)",
};
