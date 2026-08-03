"use client";

/**
 * features/jobs/jobs-list-view.tsx
 * The Jobs list — a flat, sortable table (styled like the Customers table). It is
 * built from the server-shaped lifecycle bands so status
 * and default order read by state. Columns can be hidden (Customer/Job is fixed);
 * the Crew filter narrows rows here; the Status filter chooses the bands upstream.
 * Reads leads/techs from the store; derivation is pure.
 */

import Link from "next/link";
import { useAppStore } from "@/lib/store/app-store";
import { fmt$ } from "@/lib/format";
import type { Lead, Tech } from "@/lib/store/types";
import { custName, leadAgeOf } from "./jobs-helpers";
import { jobTotal } from "./today-derive";
import { jobWhenLabel, jobStatusView, jobCrewTech, type WhenLabel, type StatusView } from "./job-row";
import type { JobListItem } from "./server-rows";
import type { JobsSort, JobsSortCol } from "./use-jobs-sort";
import { JOB_COLS, type JobColKey } from "./jobs-list-config";

interface ListRow {
  id: string;
  title: string;
  cust: string;
  amt: number;
  when: WhenLabel;
  status: StatusView;
  tech: Tech | null;
}

/** One display row per server row, in the order the server sent them. */
function deriveListRows(items: readonly JobListItem[], leads: Lead[], techs: Tech[]): ListRow[] {
  return items.map(({ job, bandKey }) => ({
    id: job.id,
    title: job.title,
    cust: custName(job, leads),
    amt: jobTotal(job),
    when: jobWhenLabel(bandKey, job, leadAgeOf(job, leads)),
    status: jobStatusView(bandKey, job),
    tech: jobCrewTech(bandKey, job, techs),
  }));
}

/**
 * Client-side ordering for the columns the SERVER does not order.
 *
 * "WHEN" IS ABSENT DELIBERATELY. The server now orders on the visit date that column prints, so
 * the page arrives in the order it must render. Re-deriving it here from row POSITION and flipping
 * on direction is what turned a descending page into an ascending one — the header said one thing
 * and the rows did the other. Ordering the page a second time can only disagree with the paging
 * the cursor is walking.
 *
 * Amount and Customer stay: Amount reads jobTotal() (the sum of the job's LINES) while the server
 * pages on jobs.total_cents, so re-sorting keeps the visible order agreeing with the visible
 * numbers; Customer has no server sort at all, and a header that does nothing is a dead control.
 * Both are page-local by nature — see SORT_COL_TO_SERVER.
 */
function sortRows(rows: readonly ListRow[], sort: JobsSort): ListRow[] {
  if (sort.col === "when") return [...rows];
  const dir = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const c = sort.col === "amount" ? a.r.amt - b.r.amt : a.r.cust.localeCompare(b.r.cust);
      // Ties keep the server's order rather than whatever the sort implementation lands on.
      return c !== 0 ? dir * c : a.i - b.i;
    })
    .map((x) => x.r);
}

/** A keyboard-operable, screen-reader-announced sortable column header. */
function SortTh({
  label,
  col,
  sort,
  onActivate,
  right,
}: {
  label: string;
  col: JobsSortCol;
  sort: JobsSort;
  onActivate: (col: JobsSortCol) => void;
  right?: boolean;
}) {
  const active = sort.col === col;
  const ariaSort: "ascending" | "descending" | "none" = active
    ? sort.dir === "asc"
      ? "ascending"
      : "descending"
    : "none";
  return (
    // The <th> keeps its implicit columnheader role (which allows aria-sort); the
    // sort trigger is a nested <button>, so aria-sort is no longer on a button role
    // (aria-allowed-attr) and the header is properly a sortable column header.
    <th className={right ? "r" : undefined} aria-sort={ariaSort}>
      <button type="button" className="th-sort" onClick={() => onActivate(col)}>
        {label} {active ? <span className="caret">{sort.dir === "asc" ? "▴" : "▾"}</span> : null}
      </button>
    </th>
  );
}

/** One column's cell for a row. */
function RowCell({ col, row }: { col: JobColKey; row: ListRow }) {
  const label = JOB_COLS[col].label; // doubles as the mobile-card row label
  switch (col) {
    case "status": {
      const pillContent = (
        <>
          <span className="d" aria-hidden="true" />
          {row.status.label}
        </>
      );
      if (row.status.href) {
        return (
          <td data-label={label}>
            <Link
              href={row.status.href}
              className={`jst jst-${row.status.tone}`}
              title="Place it on the Schedule board"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              {pillContent}
            </Link>
          </td>
        );
      }
      return (
        <td data-label={label}>
          <span className={`jst jst-${row.status.tone}`}>
            {pillContent}
          </span>
        </td>
      );
    }
    case "when":
      return (
        <td data-label={label}>
          <span className={`jl-when${row.when.live ? " live" : ""}`}>
            {row.when.live && <span className="jh-ldot" aria-hidden="true" />}
            {row.when.live ? `on site · ${row.when.onsiteAt}` : row.when.label}
          </span>
        </td>
      );
    case "crew":
      return (
        <td data-label={label}>
          {row.tech ? (
            <span className="jl-crew">
              <span className="javatar jh-av" style={{ background: row.tech.color }}>{row.tech.initials}</span>
              {row.tech.name.split(" ")[0]}
            </span>
          ) : (
            <span className="jl-crew">—</span>
          )}
        </td>
      );
    case "amount":
      return (
        <td className="r" data-label={label}>
          <span className="jl-amt">{fmt$(row.amt)}</span>
        </td>
      );
  }
}

function JobsListRow({ row, visibleCols, onOpenJob }: { row: ListRow; visibleCols: JobColKey[]; onOpenJob: (id: string) => void }) {
  return (
    <tr className="clickable" onClick={() => onOpenJob(row.id)}>
      <td className="jl-cust">
        {/* Focusable open control — keyboard access without the <tr> being a button
            (the status cell can be a Link, which would nest inside a button-row). */}
        <button
          type="button"
          className="rowopen"
          style={{ display: "block", width: "100%" }}
          aria-label={`Open ${row.cust} · ${row.title}`}
          onClick={(e) => { e.stopPropagation(); onOpenJob(row.id); }}
        >
          <b>{row.cust}</b>
          <span className="job">{row.title}</span>
        </button>
      </td>
      {visibleCols.map((col) => (
        <RowCell key={col} col={col} row={row} />
      ))}
    </tr>
  );
}

export interface JobsListViewProps {
  /** The server's page, in server order. Each row carries the band its labels derive from. */
  items: readonly JobListItem[];
  sort: JobsSort;
  onSort: (s: JobsSort) => void;
  onOpenJob: (id: string) => void;
  visibleCols: JobColKey[];
}

export function JobsListView({ items, sort, onSort, onOpenJob, visibleCols }: JobsListViewProps) {
  const leads = useAppStore((s) => s.leads);
  const techs = useAppStore((s) => s.techs);

  const rows = sortRows(deriveListRows(items, leads, techs), sort);

  function clickCol(col: JobsSortCol) {
    if (sort.col === col) onSort({ col, dir: sort.dir === "asc" ? "desc" : "asc" });
    // Amounts read best high-first; names + time read best low-first.
    else onSort({ col, dir: col === "amount" ? "desc" : "asc" });
  }

  const show = (c: JobColKey) => visibleCols.includes(c);

  if (rows.length === 0) {
    return <div className="empty-att" style={{ padding: "var(--space-6) 0" }}>Nothing matches.</div>;
  }

  return (
    <div className="jl-card">
      <table className="jl">
        <colgroup>
          <col />
          {show("status") && <col style={{ width: 150 }} />}
          {show("when") && <col style={{ width: 140 }} />}
          {show("crew") && <col style={{ width: 130 }} />}
          {show("amount") && <col style={{ width: 104 }} />}
        </colgroup>
        <thead>
          <tr>
            <SortTh label="Customer / Job" col="customer" sort={sort} onActivate={clickCol} />
            {show("status") && <th>{JOB_COLS.status.label}</th>}
            {show("when") && <SortTh label={JOB_COLS.when.label} col="when" sort={sort} onActivate={clickCol} />}
            {show("crew") && <th>{JOB_COLS.crew.label}</th>}
            {show("amount") && <SortTh label={JOB_COLS.amount.label} col="amount" sort={sort} onActivate={clickCol} right />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <JobsListRow key={row.id} row={row} visibleCols={visibleCols} onOpenJob={onOpenJob} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
