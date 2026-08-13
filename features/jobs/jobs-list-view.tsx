"use client";

/**
 * features/jobs/jobs-list-view.tsx
 * The Jobs list — a flat, sortable table (styled like the Customers table), built from the
 * server-shaped lifecycle bands so the labels and the default order read by state.
 *
 * FIVE FIXED COLUMNS. There used to be a column picker and a Status column; both went in the same
 * change. Status derived its pill from the row's band, and the band IS the chosen view, so under
 * the list's default filter it printed "Today" on every row — nothing to scan and nothing to
 * filter by. Its two remaining jobs (the amber tone, the one link off the row) moved into the WHEN
 * cell, which was already naming the date. Address took the freed width: it is the one fact that
 * differs on every row, and what people in the trades recall a job by.
 *
 * Reads leads/techs from the store; derivation is pure.
 */

import Link from "next/link";
import { useAppStore } from "@/lib/store/app-store";
import { fmt$ } from "@/lib/format";
import type { Lead, Tech } from "@/lib/store/types";
import { custName, jobAddr, leadAgeOf } from "./jobs-helpers";
import { jobTotal } from "./today-derive";
import { jobWhenLabel, jobCrewTech, type WhenLabel } from "./job-row";
import type { JobListItem } from "./server-rows";
import type { JobsSort, JobsSortCol } from "./use-jobs-sort";

interface ListRow {
  id: string;
  title: string;
  cust: string;
  amt: number;
  when: WhenLabel;
  addr: string;
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
    addr: jobAddr(job, leads),
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

/**
 * The WHEN cell — the date, and since the Status column was retired, the BAND.
 *
 * Tone and link come off the WhenLabel rather than being decided here, so the rule lives in one
 * pure place (job-row.ts) and this stays a renderer.
 */
function WhenCell({ when }: { when: WhenLabel }) {
  const cls = [
    "jl-when",
    when.live ? "live" : "",
    when.tone === "rust" ? "late" : "",
    when.tone === "amber" ? (when.href ? "slot" : "unbilled") : "",
  ]
    .filter(Boolean)
    .join(" ");

  const body = (
    <>
      {when.live && <span className="jh-ldot" aria-hidden="true" />}
      {when.live ? `on site · ${when.onsiteAt}` : when.label}
    </>
  );

  if (!when.href) return <span className={cls}>{body}</span>;
  return (
    // stopPropagation, or the one cell that goes somewhere ELSE also opens the job modal.
    <Link
      href={when.href}
      className={cls}
      title="Place it on the Schedule board"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {body} <span aria-hidden="true">→</span>
    </Link>
  );
}

function JobsListRow({ row, onOpenJob }: { row: ListRow; onOpenJob: (id: string) => void }) {
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
      <td data-label="When"><WhenCell when={row.when} /></td>
      <td data-label="Address"><span className="jl-addr">{row.addr || "—"}</span></td>
      <td data-label="Crew">
        {row.tech ? (
          <span className="jl-crew">
            <span className="javatar jh-av" style={{ background: row.tech.color }}>{row.tech.initials}</span>
            {row.tech.name.split(" ")[0]}
          </span>
        ) : (
          <span className="jl-crew">—</span>
        )}
      </td>
      <td className="r" data-label="Amount"><span className="jl-amt">{fmt$(row.amt)}</span></td>
    </tr>
  );
}

export interface JobsListViewProps {
  /** The server's page, in server order. Each row carries the band its labels derive from. */
  items: readonly JobListItem[];
  sort: JobsSort;
  onSort: (s: JobsSort) => void;
  onOpenJob: (id: string) => void;
}

export function JobsListView({ items, sort, onSort, onOpenJob }: JobsListViewProps) {
  const leads = useAppStore((s) => s.leads);
  const techs = useAppStore((s) => s.techs);

  const rows = sortRows(deriveListRows(items, leads, techs), sort);

  function clickCol(col: JobsSortCol) {
    if (sort.col === col) onSort({ col, dir: sort.dir === "asc" ? "desc" : "asc" });
    // Amounts read best high-first; names + time read best low-first.
    else onSort({ col, dir: col === "amount" ? "desc" : "asc" });
  }

  if (rows.length === 0) {
    return <div className="empty-att" style={{ padding: "var(--space-6) 0" }}>Nothing matches.</div>;
  }

  return (
    <div className="jl-card">
      <table className="jl">
        {/* Fixed. The column picker went with the Status column: four load-bearing columns is not
            a set worth hiding, and Customers made the same call. */}
        <colgroup>
          <col />
          <col style={{ width: 150 }} />
          <col style={{ width: 190 }} />
          <col style={{ width: 130 }} />
          <col style={{ width: 104 }} />
        </colgroup>
        <thead>
          <tr>
            <SortTh label="Customer / Job" col="customer" sort={sort} onActivate={clickCol} />
            <SortTh label="When" col="when" sort={sort} onActivate={clickCol} />
            {/* No server sort for Address, and a header that does nothing is a dead control. */}
            <th>Address</th>
            <th>Crew</th>
            <SortTh label="Amount" col="amount" sort={sort} onActivate={clickCol} right />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <JobsListRow key={row.id} row={row} onOpenJob={onOpenJob} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
