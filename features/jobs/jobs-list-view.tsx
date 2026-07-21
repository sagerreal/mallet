"use client";

/**
 * features/jobs/jobs-list-view.tsx
 * The Jobs list — a flat, sortable table (styled like the Customers table). It is
 * built from the lifecycle bands (deriveJobBands / deriveArchivedBands) so status
 * and default order read by state. Columns can be hidden (Customer/Job is fixed);
 * the Crew filter narrows rows here; the Status filter chooses the bands upstream.
 * Reads leads/techs from the store; derivation is pure.
 */

import Link from "next/link";
import { useAppStore } from "@/lib/store/app-store";
import { fmt$ } from "@/lib/format";
import type { Lead, Tech } from "@/lib/store/types";
import { custName, leadAgeOf } from "./jobs-helpers";
import { jobTotal, type JobBand } from "./today-derive";
import { jobWhenLabel, jobStatusView, jobCrewTech, type WhenLabel, type StatusView } from "./job-row";
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

/** Flatten the lifecycle bands into display rows, keeping the grouped order. */
function deriveListRows(bands: JobBand[], leads: Lead[], techs: Tech[]): ListRow[] {
  return bands.flatMap((band) =>
    band.jobs.map((job) => ({
      id: job.id,
      title: job.title,
      cust: custName(job, leads),
      amt: jobTotal(job),
      when: jobWhenLabel(band.key, job, leadAgeOf(job, leads)),
      status: jobStatusView(band.key, job),
      tech: jobCrewTech(band.key, job, techs),
    }))
  );
}

/** Sort rows by the chosen column; "when" keeps the natural grouped order. */
function sortRows(rows: ListRow[], sort: JobsSort): ListRow[] {
  const indexed = rows.map((r, i) => ({ r, i }));
  indexed.sort((a, b) => {
    const c =
      sort.col === "amount"
        ? a.r.amt - b.r.amt
        : sort.col === "customer"
          ? a.r.cust.localeCompare(b.r.cust)
          : a.i - b.i;
    return sort.dir === "asc" ? c : -c;
  });
  return indexed.map((x) => x.r);
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
    <th
      className={right ? "r" : undefined}
      role="button"
      tabIndex={0}
      aria-sort={ariaSort}
      onClick={() => onActivate(col)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate(col);
        }
      }}
    >
      {label} {active ? <span className="caret">{sort.dir === "asc" ? "▴" : "▾"}</span> : null}
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
  bands: JobBand[];
  sort: JobsSort;
  onSort: (s: JobsSort) => void;
  onOpenJob: (id: string) => void;
  visibleCols: JobColKey[];
}

export function JobsListView({ bands, sort, onSort, onOpenJob, visibleCols }: JobsListViewProps) {
  const leads = useAppStore((s) => s.leads);
  const techs = useAppStore((s) => s.techs);

  const rows = sortRows(deriveListRows(bands, leads, techs), sort);

  function clickCol(col: JobsSortCol) {
    if (sort.col === col) onSort({ col, dir: sort.dir === "asc" ? "desc" : "asc" });
    // Amounts read best high-first; names + time read best low-first.
    else onSort({ col, dir: col === "amount" ? "desc" : "asc" });
  }

  const show = (c: JobColKey) => visibleCols.includes(c);

  if (rows.length === 0) {
    return <div className="empty-att" style={{ padding: "24px 0" }}>Nothing matches.</div>;
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
