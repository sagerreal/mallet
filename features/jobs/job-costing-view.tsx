"use client";

/**
 * features/jobs/job-costing-view.tsx
 * Job costing — the second reading of the same week.
 *
 * TWO LEDGERS, AND THE TAB IS THE GUARDRAIL. Everything under Timesheet changes what somebody is
 * PAID and syncs to QuickBooks. Everything here changes a REPORT. Nothing crosses, and that is
 * why job attribution is not editable on the approval screen — reassigning an hour between jobs
 * moves a report line and not one cent of pay, and an approver should never be able to mistake
 * one for the other.
 *
 * WHERE THE HOURS COME FROM. `job_visits` stamps — the Arrived and Done taps a technician already
 * makes because the customer wants to know he is here. Never a second clock: a second punch for
 * the same moment is the punch people forget. One triple per visit, summed to the job, so a
 * three-visit job costs correctly instead of measuring its last trip.
 *
 * PROVENANCE IS ON EVERY ROW. "from taps" and "scheduled" are not the same claim, and a report
 * that renders them identically cannot be checked. Same for money: a blank cost means nobody who
 * worked it has a rate set, and it stays blank rather than becoming $0 — a job that reads as free
 * to run is the one wrong answer that looks like good news.
 */

import { fmt$ } from "@/lib/format";
import { api } from "@/lib/trpc/client";
import { ListLoading } from "@/components/shared/list-loading";
import { LoadFailed } from "@/components/shared/load-failed";

interface JobCostingViewProps {
  /** Monday, YYYY-MM-DD. */
  weekStart: string;
  /** Sunday, YYYY-MM-DD. */
  weekEnd: string;
  /** Paid hours for the whole crew this week, from the timesheet — the denominator. */
  paidHours: number;
}

const SOURCE_LABEL = {
  measured: "from taps",
  scheduled: "scheduled — estimate",
  mixed: "part measured",
} as const;

const num = (n: number): string => n.toFixed(2);

export function JobCostingView({ weekStart, weekEnd, paidHours }: JobCostingViewProps) {
  const q = api.v1.jobs.laborByJob.useQuery(
    { from: weekStart, to: weekEnd },
    { refetchOnWindowFocus: false },
  );

  if (q.isPending) return <ListLoading label="Loading job costing…" />;
  if (q.isError) return <LoadFailed noun="job costing" onRetry={() => void q.refetch()} />;

  const rows = [...q.data.items].sort((a, b) => b.hours - a.hours);

  if (rows.length === 0) {
    return (
      <div className="empty-att">
        No job hours this week. Hours land here when a technician taps Arrived and Done on a visit.
      </div>
    );
  }

  const attributed = rows.reduce((sum, r) => sum + r.hours, 0);
  // Never negative on screen: paid hours come from the timesheet and attributed hours from visit
  // stamps, and a tech who tapped Arrived but forgot to clock in makes attributed the larger of
  // the two. That is a real condition and "-1.20 h unaccounted" is not a sentence anyone can act on.
  const unaccounted = Math.max(0, paidHours - attributed);
  const anyCost = rows.some((r) => r.costCents !== null);
  const anyPartial = rows.some((r) => r.costIsPartial);

  return (
    <div>
      <table className="ts-tbl">
        <caption className="sr-only">Job costing for the week of {weekStart}</caption>
        <thead>
          <tr>
            <th scope="col">Job</th>
            <th scope="col" className="r">Visits</th>
            <th scope="col" className="r">Hours</th>
            <th scope="col" className="r">Labor</th>
            <th scope="col" className="r">Quoted</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.jobId}>
              <th scope="row">
                <span style={{ display: "block" }}>
                  {r.title?.trim() || r.num} · {r.customerName}
                </span>
                <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
                  {SOURCE_LABEL[r.source]}
                  {r.costIsPartial ? " · some crew have no cost rate" : ""}
                </span>
              </th>
              <td className="r ts-num">{r.visits}</td>
              <td className="r ts-num"><b>{num(r.hours)}</b></td>
              <td className="r ts-num">{r.costCents === null ? "—" : fmt$(r.costCents / 100)}</td>
              <td className="r ts-num">{fmt$(r.quotedCents / 100)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">
              <span style={{ display: "block" }}>Not attributed to a job</span>
              <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
                paid {num(paidHours)} − attributed {num(attributed)}
              </span>
            </th>
            <td className="r">—</td>
            <td className="r ts-num">{num(unaccounted)}</td>
            <td className="r">—</td>
            <td className="r">—</td>
          </tr>
        </tfoot>
      </table>

      {!anyCost && (
        <div className="muted" style={{ fontSize: "var(--type-sm)", paddingTop: "var(--space-2)" }}>
          No labor costs yet — set what each of your crew costs per hour in Settings → Team, and
          this fills in.
        </div>
      )}
      {anyCost && anyPartial && (
        <div className="muted" style={{ fontSize: "var(--type-sm)", paddingTop: "var(--space-2)" }}>
          Some jobs are part-costed: the crew who ran them do not all have an hourly cost set.
        </div>
      )}
    </div>
  );
}
