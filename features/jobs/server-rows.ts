import type { BandKey } from "./today-derive";
import type { Job } from "@/lib/store/types";
import { dtoJobToStoreJob, type JobDTO } from "@/lib/store/dto-mapper";
import type { RouterOutputs } from "@/lib/trpc/client";

import type { JobView } from "@/modules/jobs/infra/job-views";
import type { JobsSortCol } from "./use-jobs-sort";
import type { JobSort } from "@/modules/jobs/infra/job-sorts";

/**
 * Adapt a server page of jobs into the rows the list renders.
 *
 * ONE FLAT SEQUENCE, IN THE ORDER THE SERVER SENT IT. That is the whole contract, and it is what
 * this file previously broke: it bucketed the page into lifecycle bands (done / needsSlot / later)
 * and the view flat-mapped the buckets, so whichever band the FIRST row belonged to absorbed every
 * same-band row further down the page and floated them to the top. On a shop whose first row was a
 * finished job, the Jobs list opened on a wall of "Done" from last week and the work that was
 * actually coming up sat below it. The old code even carried a comment claiming the order was
 * preserved; grouping and then concatenating groups cannot preserve it.
 *
 * The band key survives as a PER-ROW value rather than a container, because that is all it was ever
 * used for: job-row.ts derives the WHEN text, the status pill and the crew avatar from
 * (bandKey, job). Nothing renders a band header on this screen, so grouping bought nothing and
 * cost the sort.
 */

/** Server view → the band key the row helpers already understand. */
const BAND_FOR_VIEW: Record<JobView, BandKey> = {
  needsSlot: "needsSlot",
  today: "today",
  week: "thisWeek",
  upcoming: "later",
  needsInvoice: "doneUnbilled",
  done: "done",
  archived: "archived",
};

/**
 * With no view selected the list is mixed, so the band key is derived per row from the job's own
 * state. It is a display hint only — the row still renders its real date and status, and it no
 * longer influences where the row appears.
 */
const bandForJob = (job: Job): BandKey => {
  if (job.status === "done") return "done";
  if (job.status === "unscheduled") return "needsSlot";
  return "later";
};

/** A row as the list renders it: the job, plus the band its labels are derived from. */
export interface JobListItem {
  readonly job: Job;
  readonly bandKey: BandKey;
}

export interface ServerRowsResult {
  /** The page, in server order. */
  readonly rows: JobListItem[];
  readonly jobs: Job[];
}

/** A row as the LIST returns it — the summary shape, not the full job record. */
export type JobListRow = RouterOutputs["v1"]["jobs"]["list"]["items"][number];

/**
 * The summary DTO omits MOST of the lifecycle timestamps the full record carries. The store
 * mapper reads them, so they are supplied as null EXPLICITLY rather than cast away: null is the
 * honest value — the list genuinely does not know them — and a cast would let a future field go
 * missing silently. completedAt is no longer in this set: the summary now carries it (the field
 * agenda's Finished bucket sorts on it), so the row's own value flows through.
 */
const asStoreJob = (row: JobListRow) =>
  dtoJobToStoreJob({
    scheduledEnd: null,
    startedAt: null,
    canceledAt: null,
    enrouteAt: null,
    cancelReason: null,
    ...row,
  } as unknown as JobDTO);

/**
 * The page, in server order, each row tagged with the band its labels come from.
 *
 * When a view is selected every row on screen belongs to it, so the view's band key is not an
 * approximation — it is the truth, and it is the same for every row. With no view the key is
 * derived per row. Either way the SEQUENCE is untouched: the server owns the sort.
 */
export function serverPageToRows(dtos: readonly JobListRow[], view: JobView | null): ServerRowsResult {
  const jobs = dtos.map(asStoreJob);
  const viewBand = view ? BAND_FOR_VIEW[view] : null;
  return {
    jobs,
    rows: jobs.map((job) => ({ job, bandKey: viewBand ?? bandForJob(job) })),
  };
}

/**
 * The table's column headers speak in display columns; the server speaks in named sorts.
 *
 * "when" maps to `scheduled` rather than `created`: the column shows when the work HAPPENS, and
 * sorting it by row-creation date would be a different question wearing the same label. `scheduled`
 * now orders on the visit date the column actually prints — see job-sorts.ts.
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
