/**
 * features/jobs/job-row.ts
 * Shared, pure per-row display derivations used by BOTH the grouped ledger
 * (jobs-home) and the flat List view (jobs-list-view), so the two never drift:
 * the "when" cell, the status pill, and which crew avatar a row shows are
 * derived once here from the job + its lifecycle band. No React, no store.
 */

import type { Job, Tech } from "@/lib/store/types";
import type { BandKey } from "./today-derive";
import { todayVisit } from "./today-derive";
import { jobNextVisit, jobDatedUnassignedVisit, jobOldestOverdueVisit, techById } from "./jobs-helpers";
import { whenDateLabel, timeLabelShort, daysBetweenISO } from "@/lib/time";
import { todayISO } from "@/lib/clock";

/**
 * The right-hand "when" text — and, since the Status column was retired, the row's BAND too.
 *
 * The Status pill derived its label from the row's band, and the band IS the selected view, so
 * under the list's default filter it printed "Today" on all twenty rows. It was deleted and the
 * two jobs it still did moved here, onto the cell that was already naming the date: the tone that
 * rations amber to the money-leak states, and the one link that goes somewhere the row click does
 * not.
 */
export interface WhenLabel {
  label: string;
  live: boolean;
  onsiteAt?: string;
  /**
   * amber = money on the floor (a job with no slot, finished work with no bill). rust = overdue,
   * the far end of the ledger palette's existing sand -> amber -> rust aging rail.
   *
   * Amber stays RATIONED to those states. The live on-site row is amber too, via `.jl-when.live`,
   * which predates this and is left where it is.
   */
  tone?: "amber" | "rust";
  /**
   * Only ever set on needsSlot. Every other band's action is the job modal, which clicking the row
   * already opens — a second arrow would promise a destination that does not exist.
   */
  href?: string;
}

/**
 * The "Needs a slot" cell. Usually how long the job has been sold — but a job can also be in that
 * band HALF PLANNED: a day was picked and no crew was ever put on it, which the board cannot draw
 * (there is no lane for nobody) and the server now correctly counts as unplaced. Printing "sold 4d
 * ago" over one of those states the wrong thing — the day is decided, the crew is not — so the row
 * shows the day it is pencilled in for and names what is missing, in the same shorthand the
 * Scheduled rows use.
 */
function soldWhen(job: Job, leadAge: number): WhenLabel {
  const half = jobDatedUnassignedVisit(job);
  if (half?.date) {
    const at = half.start != null ? ` · ${timeLabelShort(half.start)}` : "";
    return { label: `${whenDateLabel(half.date, todayISO())}${at} · no crew`, live: false, ...SLOT };
  }
  return { label: leadAge >= 1 ? `sold ${leadAge}d ago` : "sold today", live: false, ...SLOT };
}

/** Sold work going nowhere: amber, and the only cell that links off the row. */
const SLOT = { tone: "amber", href: "/jobs?tab=schedule" } as const;

/**
 * How overdue, and since when — "3d late · Jun 20".
 *
 * The date comes from jobOldestOverdueVisit, not jobNextVisit: see that helper for the finished-
 * visit-dated-later shape that makes the obvious choice report the wrong day.
 */
function lateWhen(job: Job): WhenLabel {
  const today = todayISO();
  const v = jobOldestOverdueVisit(job);
  if (!v?.date) return { label: "late", live: false, tone: "rust" };
  // At least 1: the band's own predicate is `date < today`, so a zero here would be a lie about
  // which side of today the trip sits on.
  const days = Math.max(1, daysBetweenISO(v.date, today));
  return { label: `${days}d late · ${whenDateLabel(v.date, today)}`, live: false, tone: "rust" };
}

function todayWhen(job: Job): WhenLabel {
  const tv = todayVisit(job);
  if (tv?.status === "onsite") return { label: "on site", live: true, onsiteAt: tv.onsiteAt ?? "now" };
  return { label: tv ? `Today · ${timeLabelShort(tv.start ?? 0)}` : "", live: false };
}

function doneWhen(job: Job): WhenLabel {
  const dv = [...(job.visits ?? [])].reverse().find((x) => x.status === "done");
  return { label: dv?.date ? `done ${whenDateLabel(dv.date, todayISO())}` : "done", live: false };
}

function scheduledWhen(job: Job): WhenLabel {
  const v = jobNextVisit(job);
  return { label: v ? `${whenDateLabel(v.date ?? "", todayISO())} · ${timeLabelShort(v.start ?? 0)}` : "", live: false };
}

export function jobWhenLabel(bandKey: BandKey, job: Job, leadAge: number): WhenLabel {
  switch (bandKey) {
    case "needsSlot":
      return soldWhen(job, leadAge);
    case "late":
      return lateWhen(job);
    case "today":
      return todayWhen(job);
    case "doneUnbilled":
      // Finished work nobody has billed — money on the floor, and the third of the three states
      // amber is spent on. No href: billing happens in the job modal, which the row click opens.
      return { ...doneWhen(job), tone: "amber" };
    case "done":
    case "archived":
      return doneWhen(job);
    default:
      return scheduledWhen(job);
  }
}

/** The crew avatar a row shows: the done crew for finished jobs, today's crew
 *  for today, else the next scheduled crew. */
export function jobCrewTech(bandKey: BandKey, job: Job, techs: Tech[]): Tech | null {
  const v =
    bandKey === "doneUnbilled" || bandKey === "done" || bandKey === "archived"
      ? [...(job.visits ?? [])].reverse().find((x) => x.status === "done")
      : bandKey === "today"
        ? todayVisit(job)
        : jobNextVisit(job);
  return v?.techId != null ? techById(techs, v.techId) ?? null : null;
}
