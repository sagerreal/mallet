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
import { jobNextVisit, jobDatedUnassignedVisit, techById } from "./jobs-helpers";
import { whenDateLabel, timeLabelShort } from "@/lib/time";
import { todayISO } from "@/lib/clock";

/** The right-hand "when" text: appointment time, the live on-site pill, done date,
 *  or (for an unscheduled sold job) how long it's been sold. */
export interface WhenLabel {
  label: string;
  live: boolean;
  onsiteAt?: string;
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
    return { label: `${whenDateLabel(half.date, todayISO())}${at} · no crew`, live: false };
  }
  return { label: leadAge >= 1 ? `sold ${leadAge}d ago` : "sold today", live: false };
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
    case "today":
      return todayWhen(job);
    case "doneUnbilled":
    case "done":
    case "archived":
      return doneWhen(job);
    default:
      return scheduledWhen(job);
  }
}

/** The status pill for the List view. Amber is rationed to the states that need
 *  the owner — a slot, a live crew, or an unbilled done job — matching the two
 *  amber money-leak bands in the grouped view. Everything else is neutral. */
export interface StatusView {
  label: string;
  tone: "amber" | "neutral";
  live: boolean;
  href?: string;
}

export function jobStatusView(bandKey: BandKey, job: Job): StatusView {
  switch (bandKey) {
    case "needsSlot":
      return { label: "Needs a slot", tone: "amber", live: false, href: "/jobs?tab=schedule" };
    case "today": {
      const tv = todayVisit(job);
      if (tv?.status === "onsite") return { label: "On site", tone: "amber", live: true };
      return { label: "Today", tone: "neutral", live: false };
    }
    case "doneUnbilled":
      return { label: "Done · unbilled", tone: "amber", live: false };
    case "done":
      return { label: "Done", tone: "neutral", live: false };
    case "archived":
      return { label: "Archived", tone: "neutral", live: false };
    default:
      return { label: "Scheduled", tone: "neutral", live: false };
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
