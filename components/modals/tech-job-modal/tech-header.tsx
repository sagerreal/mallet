/**
 * components/modals/tech-job-modal/tech-header.tsx
 * The sheet header (sheet grammar): the customer's name as the modal's <h2> over ONE calm
 * .sheet-meta line that answers the two questions a technician has at the kerb — what am I here
 * to do, and when was I due.
 *
 *   Marta Delgado
 *   Water heater repair · Today, 3:00 PM
 *
 * The trade label comes from `job.svc` (see tradeLabel) — the shop's own words for the work. It
 * used to be `svcMeta().word`, which can only say "Job" or "Estimate"; and the day and time lived
 * far down the sheet on the visit row, so the two halves of one sentence were a scroll apart.
 *
 * Sticky via .sheet-head, so the job you are looking at never scrolls away. NO status pill — the
 * visit stepper below is this view's state readout.
 */

"use client";

import { memo } from "react";
import type { Job, Visit } from "@/lib/store/types";
import { tradeLabel, visitWhenLabel } from "./helpers";

export interface TechHeaderProps {
  job: Job;
  custName: string;
  /** The visit the sheet is about — its scheduled day and time complete the meta line. */
  visit: Visit | undefined;
}

/**
 * Custom comparator, for the same reason every other section in this directory has one: a
 * checklist tap replaces `job` wholesale, and this header reads four fields of it. Adding a prop
 * WITHOUT adding it here is the quiet way to break a section — see
 * tech-job-modal-comparators.test.ts, which exists to catch exactly that.
 */
export function techHeaderPropsEqual(a: TechHeaderProps, b: TechHeaderProps): boolean {
  return (
    a.custName === b.custName &&
    a.job.svc === b.job.svc &&
    a.job.title === b.job.title &&
    a.job.kind === b.job.kind &&
    a.job.lines === b.job.lines &&
    a.visit?.date === b.visit?.date &&
    a.visit?.start === b.visit?.start
  );
}

function TechHeaderFn({ job, custName, visit }: TechHeaderProps) {
  const trade = tradeLabel(job, custName);
  const when = visitWhenLabel(visit);

  return (
    <div className="sheet-head">
      <h2>{custName}</h2>
      <div className="sheet-meta">
        <span style={{ fontWeight: 600 }}>{trade}</span>
        {when ? (
          <>
            <span aria-hidden="true">·</span>
            <span>{when}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

export const TechHeader = memo(TechHeaderFn, techHeaderPropsEqual);
