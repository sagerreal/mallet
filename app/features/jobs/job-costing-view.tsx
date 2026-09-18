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
 * MARGIN IS WITHHELD, NOT GUESSED. The moment any job in the week is missing a cost rate the
 * money tiles go blank and say which jobs, because a margin summed from the jobs we CAN price can
 * only be too high — the ones left out are exactly the ones whose cost we could not see. A figure
 * that is quietly thirty points optimistic is the figure somebody prices the next job from.
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
import { costingRows, costingTotals, type CostingRow } from "./job-costing-derive";

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
  const tree = costingRows(rows);
  const totals = costingTotals(tree, paidHours);

  return (
    <div>
      <div className="jc-tiles">
        <Tile label="Revenue" value={fmt$(totals.revenueCents / 100)}
          sub={`${totals.jobs} job${totals.jobs === 1 ? "" : "s"} · ${totals.visits} visits · excl. tax`} />
        <Tile
          label="Direct cost"
          value={totals.directCostCents === null ? "—" : fmt$(totals.directCostCents / 100)}
          sub={
            totals.laborCents === null
              ? `materials ${fmt$(totals.materialsCents / 100)} · labour needs cost rates`
              : `labour ${fmt$(totals.laborCents / 100)} · materials ${fmt$(totals.materialsCents / 100)}`
          }
        />
        <Tile
          label="Gross margin"
          value={totals.marginPct === null ? "—" : `${totals.marginPct.toFixed(1)}%`}
          sub={
            totals.marginCents === null
              ? `${totals.uncostedJobs} job${totals.uncostedJobs === 1 ? "" : "s"} without a full cost — set hourly costs in Settings → Team`
              : fmt$(totals.marginCents / 100)
          }
          tone={totals.marginPct === null ? undefined : totals.marginPct < 0 ? "bad" : "good"}
        />
        <Tile
          label="Billable hours"
          value={totals.utilizationPct === null ? "—" : `${totals.utilizationPct.toFixed(1)}%`}
          sub={
            totals.hoursExceedPaid
              ? `${num(totals.hours)} job h against ${num(paidHours)} paid — someone tapped Arrived without clocking in`
              : `${num(totals.hours)} job h of ${num(paidHours)} paid`
          }
        />
      </div>

      <p className="jc-note">
        Labour is <b>fully burdened</b>{" "}
        &mdash; wage plus payroll tax, insurance and vehicle &mdash; at each person&rsquo;s rate on
        the day they worked.
      </p>

      <table className="ts-tbl">
        <caption className="sr-only">Job costing for the week of {weekStart}</caption>
        <thead>
          <tr>
            <th scope="col">Job</th>
            <th scope="col" className="r">Visits</th>
            <th scope="col" className="r">Hours</th>
            <th scope="col" className="r">Labour</th>
            <th scope="col" className="r">Materials</th>
            <th scope="col" className="r">Purchased</th>
            <th scope="col" className="r">Revenue</th>
            <th scope="col" className="r">Margin</th>
          </tr>
        </thead>
        <tbody>
          {tree.map((r) => (
            <CostRows key={r.jobId} row={r} />
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
            <td className="r">—</td>
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
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="jc-tile">
      <div className="jc-tile-l">{label}</div>
      <div className={tone ? `jc-tile-v jc-${tone}` : "jc-tile-v"}>{value}</div>
      <div className="jc-tile-s">{sub}</div>
    </div>
  );
}

/** A job row, then any warranty callbacks that came back on it, indented under it. */
function CostRows({ row }: { row: CostingRow }) {
  return (
    <>
      <CostRow row={row} />
      {row.callbacks.map((c) => (
        <CostRow key={c.jobId} row={c} isCallback />
      ))}
    </>
  );
}

function CostRow({ row, isCallback = false }: { row: CostingRow; isCallback?: boolean }) {
  const margin =
    row.marginPct === null
      ? row.revenueCents === null || row.revenueCents === 0
        ? "no charge"
        : "—"
      : `${row.marginPct.toFixed(1)}%`;
  const tone =
    row.marginCents === null ? "" : row.marginCents < 0 ? " jc-bad" : row.marginPct !== null ? " jc-good" : "";
  return (
    <tr className={isCallback ? "jc-callback" : undefined}>
      <th scope="row">
        <span style={{ display: "block" }}>
          {row.title?.trim() || row.num} · {row.customerName}
        </span>
        <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
          {SOURCE_LABEL[row.source]}
          {row.costIsPartial ? " · some crew have no cost rate" : ""}
          {isCallback ? " · warranty" : ""}
        </span>
      </th>
      <td className="r ts-num">{row.visits}</td>
      <td className="r ts-num">
        <b>{num(row.hours)}</b>
        {row.overrunPct !== null && row.overrunPct !== 0 && (
          <span className={row.overrunPct > 0 ? "jc-over" : "muted"} style={{ display: "block", fontSize: "var(--type-xs)" }}>
            est {num(row.scheduledHours)} · {row.overrunPct > 0 ? "+" : ""}
            {row.overrunPct}%
          </span>
        )}
      </td>
      <td className="r ts-num">{row.costCents === null ? "—" : fmt$(row.costCents / 100)}</td>
      <td className="r ts-num">{row.materialsCents === 0 ? "—" : fmt$(row.materialsCents / 100)}</td>
      {/* What was actually bought via a placed PO — beside Materials (what was quoted), never
          folded into it or into margin: the two answer different questions. */}
      <td className="r ts-num">{row.purchasedCents === 0 ? "—" : fmt$(row.purchasedCents / 100)}</td>
      <td className="r ts-num">{row.revenueCents === null ? "—" : fmt$(row.revenueCents / 100)}</td>
      <td className={`r ts-num${tone}`}>
        <b>{margin}</b>
        {row.marginCents !== null && (
          <span className="muted" style={{ display: "block", fontSize: "var(--type-xs)" }}>
            {fmt$(row.marginCents / 100)}
          </span>
        )}
      </td>
    </tr>
  );
}
