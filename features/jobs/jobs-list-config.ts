/**
 * features/jobs/jobs-list-config.ts
 * Which SET of jobs the list shows — the active work, or the archive.
 *
 * This file used to also carry the column picker's config and a JOB_STATUS_FILTERS table. The
 * picker went when the Status column did (four load-bearing columns is not a set worth hiding),
 * and JOB_STATUS_FILTERS was already dead — declared, never imported. The chips read JOB_VIEWS
 * from modules/jobs/infra/job-views.ts, which is where the bands are actually defined.
 */

/** Chosen by the toolbar toggle, kept separate from the chips, which narrow the active set. */
export type JobsArchiveSet = "active" | "archived";
