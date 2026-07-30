import { jobTotal, type JobBand, type BandKey } from "./today-derive";
import type { Job } from "@/lib/store/types";
import { dtoJobToStoreJob, type JobDTO } from "@/lib/store/dto-mapper";

import type { JobView } from "@/modules/jobs/infra/job-views";
import type { JobsSortCol } from "./use-jobs-sort";
import type { JobSort } from "@/modules/jobs/infra/job-sorts";

/**
 * Adapt a server page of jobs into the shape the existing list view renders.
 *
 * The table, its columns, its keyboard-operable headers and its empty states all already work.
 * Rebuilding them to consume a different row type would put a large, untested rewrite in the same
 * change as the pagination — so the page is wrapped in ONE synthetic band instead, and the table
 * is untouched.
 *
 * The band is synthetic because the grouping now happens in SQL: when a view is selected every row
 * on screen belongs to it, so one band with that key is not an approximation, it is the truth. The
 * key is what drives the "when" and status labels (see job-row.ts), which is why it is carried
 * through rather than defaulted.
 */

/** Server view → the band key the row helpers already understand. */
const BAND_FOR_VIEW: Record<JobView, BandKey> = {
  needsSlot: "needsSlot",
  today: "today",
  week: "thisWeek",
  upcoming: "later",
  needsInvoice: "doneUnbilled",
  done: "done",
};

/**
 * With no view selected the list is mixed, so the band key is derived per row from the job's own
 * state. It is a display hint only — the row still renders its real date and status.
 */
const bandForJob = (job: Job): BandKey => {
  if (job.status === "done") return "done";
  if (job.status === "unscheduled") return "needsSlot";
  return "later";
};

export interface ServerRowsResult {
  readonly bands: JobBand[];
  readonly jobs: Job[];
}

/**
 * One band holding the page, keyed by the active view.
 *
 * Returns an empty array rather than an empty band when there are no rows: an empty band renders
 * a header with nothing under it, which reads as a loading failure rather than "no matches".
 */
export function serverRowsToBands(dtos: readonly JobDTO[], view: JobView | null): ServerRowsResult {
  const jobs = dtos.map((d) => dtoJobToStoreJob(d));
  if (jobs.length === 0) return { bands: [], jobs };

  if (view) {
    return {
      jobs,
      bands: [
        {
          key: BAND_FOR_VIEW[view],
          label: "",
          // Amber is the screen's "money leak" marker. The band header is not rendered in this
          // mode, so it carries no signal here and is left off rather than guessed at.
          amber: false,
          jobs,
          count: jobs.length,
          sum: jobs.reduce((t, j) => t + jobTotal(j), 0),
        },
      ],
    };
  }

  // Mixed list: group by the per-row key so each row still gets a sensible label, while the
  // ORDER stays exactly as the server returned it — the server owns the sort now.
  const seen: BandKey[] = [];
  const byKey = new Map<BandKey, Job[]>();
  for (const j of jobs) {
    const k = bandForJob(j);
    if (!byKey.has(k)) {
      byKey.set(k, []);
      seen.push(k);
    }
    byKey.get(k)!.push(j);
  }
  return {
    jobs,
    bands: seen.map((k) => {
      const group = byKey.get(k)!;
      return { key: k, label: "", amber: false, jobs: group, count: group.length, sum: group.reduce((t, j) => t + jobTotal(j), 0) };
    }),
  };
}

/**
 * The table's column headers speak in display columns; the server speaks in named sorts.
 *
 * "when" maps to `scheduled` rather than `created`: the column shows when the work HAPPENS, and
 * sorting it by row-creation date would be a different question wearing the same label.
 *
 * CUSTOMER IS DELIBERATELY ABSENT. Sorting jobs by customer name needs an ORDER BY on a joined
 * column, which the keyset cursor would have to carry too — real work, not yet done. Mapping it
 * to any existing sort would put rows in an order that is not the one the header claims, which is
 * worse than the header simply not sorting. `null` means "this column does not sort yet" and the
 * caller leaves it inert.
 */
export const SORT_COL_TO_SERVER: Record<JobsSortCol, JobSort | null> = {
  when: "scheduled",
  amount: "amount",
  customer: null,
};
