import { z } from "zod";
import { JOB_STATUSES } from "../domain/job";

/**
 * The bulk job-import row, as the browser sends it.
 *
 * Lives in its own file rather than job-router.ts so it can be unit-tested: importing the router
 * pulls the config validator, which throws without DB env.
 *
 * Every field but `customer` is **nullable AND optional**, and both matter for different reasons:
 *
 *   null    — the user mapped this column and left the cell blank. A deliberate blank.
 *   ABSENT  — the sheet has no such column at all. buildRows omits unmapped fields entirely.
 *
 * Requiring the key (nullable alone) rejected every ordinary CSV at the boundary: a file with
 * Customer, Service and Date but no Description column sends no `scope` key, and the whole batch
 * failed Zod validation AFTER the confirm step had promised it would import.
 */
export const importJobRowInput = z.object({
  customer: z.string().min(1).max(255),
  phone: z.string().max(50).nullable().optional(),
  svc: z.string().max(60).nullable().optional(),
  scope: z.string().max(4000).nullable().optional(),
  addr: z.string().max(1000).nullable().optional(),
  status: z.enum(JOB_STATUSES as unknown as [string, ...string[]]).nullable().optional(),
  /** "YYYY-MM-DD" — absent or null when the sheet carried no date; the job imports unscheduled. */
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  /** "HH:MM" — absent or null falls back to the org's opening hour for that weekday. */
  scheduledStart: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
});

export const importJobsInput = z.object({ rows: z.array(importJobRowInput).min(1).max(500) });
