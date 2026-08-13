"use client";

/**
 * features/jobs/jobs-home.tsx
 * The Jobs surface — a flat, sortable, filterable list served a page at a time by the DATABASE.
 *
 * It used to read the whole job collection out of the store and group, filter, sort and count it
 * in the browser. That works until the shop has more jobs than one hydrator page: on 1,521 jobs it
 * silently described 500 of them, and reported "220 of 220" while doing it.
 *
 * The shape follows Jobber's Jobs page, checked against their help documentation rather than
 * assumed: a heading with a live count, ONE filter carrying per-value counts, and a flat sortable
 * table. Not tabs — Jobber has none here — and no grouped sections, which they are explicitly
 * retiring on their own schedule list.
 *
 * That one filter is now VISIBLE rather than behind a disclosure. See JobsViewFilter.
 *
 * The labels stay Owen's ("Needs a slot", not "Unscheduled"). The pattern was worth borrowing; the
 * vocabulary was not.
 */

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { shouldShowFirstRun, shouldShowLoadFailed } from "@/lib/first-run";
import { FirstRunEmptyState } from "@/components/shared/first-run-empty-state";
import { useAnimatedNumber } from "@/features/home/use-animated-number";
import { useJobsSort } from "./use-jobs-sort";
import { JobsListView } from "./jobs-list-view";
import { CallbackAutopsyCard } from "./callback-autopsy-card";
import { JobsToolbar } from "./jobs-toolbar";
import { JobsViewFilter } from "./jobs-view-filter";
import { type JobsArchiveSet } from "./jobs-list-config";
import { LoadFailed } from "@/components/shared/load-failed";
import { ListLoading } from "@/components/shared/list-loading";
import { useJobsQuery, useJobsQueryState } from "./use-jobs-query";
import { serverPageToRows, SORT_COL_TO_SERVER } from "./server-rows";
import { useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";

export interface JobsHomeProps {
  onOpenJob: (id: string) => void;
  onOpenNewJob: () => void;
}

// First-run empty-state copy (functional, not chatty). Shown when a brand-new shop opens Jobs
// with zero jobs (see shouldShowFirstRun) — replaces the toolbar + list, header stays.
const FIRST_RUN = {
  heading: "No jobs yet",
  subtext: "Jobs land here when you book one, or when a customer accepts a quote.",
  book: {
    title: "Book a job",
    description: "Log the work directly — it creates the customer inline if they're new.",
    actionLabel: "+ New job",
  },
  quote: {
    title: "Build a quote",
    description: "Price up the work and send it — an accepted quote becomes a job automatically.",
    actionLabel: "+ New quote",
  },
} as const;

export function JobsHome({ onOpenJob, onOpenNewJob }: JobsHomeProps) {
  const router = useRouter();
  const openModal = useOpenModal();
  const { sort, setSort } = useJobsSort();

  const [archiveSet, setArchiveSet] = useState<JobsArchiveSet>("active");

  const q = useJobsQueryState();

  // Archived is now a server view like any other, so the Active/Archived toggle sets the view
  // rather than switching to a second client-side derivation. It wins over the filter: asking for
  // archived work and a live band at once is not a question the screen can answer.
  const view = archiveSet === "archived" ? "archived" : q.view;

  // "Active" means the OPEN book — everything not complete and not canceled. The toggle used to
  // apply no filter whatsoever (view stayed null, the repository filtered only deleted_at), so
  // both tabs returned the same rows and the same total. The label promised a filter that did not
  // exist.
  //
  // NOT stacked on a chosen view. Each view is already a precise slice, and two of them (Done,
  // Done not billed) are finished work by definition — ANDing "not finished" on top would return
  // nothing while the filter's own count pill promised rows, which is a dead control. When a view
  // is chosen the view IS the filter; Archived is a view too, so it is covered by the same rule.
  // "ALL" MEANS ALL — everything the archive does not already hold.
  //
  // This used to send `activeOnly`, which excludes complete and canceled, so All read 39 while the
  // seven bands summed to 65: Done (14) and Done-not-billed (12) were absent from the chip that
  // claimed to contain them. The Active/Archived toggle already separates the archive, so All
  // within Active narrows to "not archived" and nothing further. `activeOnly` is untouched — the
  // nav badge and the work board still count open work with it.
  //
  // NOT stacked on a chosen view. Each view is already a precise slice, and two of them are
  // finished work by definition — narrowing them further would return nothing while the chip's own
  // count promised rows, which is a dead control. Archived is a view too, so it is covered.
  const excludeArchived = archiveSet === "active" && !view;

  // The table's headers speak in display columns; the server in named sorts. A column with no
  // server sort (Customer — it needs a joined ORDER BY the cursor would have to carry too) maps
  // to null and is left inert rather than pointed at a different column.
  const serverSort = SORT_COL_TO_SERVER[sort.col];
  const list = useJobsQuery({
    view,
    excludeArchived,
    search: q.search,
    sort: serverSort,
    sortDir: serverSort ? sort.dir : null,
  });

  const { rows } = useMemo(() => serverPageToRows(list.rows, view), [list.rows, view]);

  // Today's money, summed by the database in the same query as the view counts — not by adding up
  // whichever rows the browser happens to be holding.
  const shownTrucks = useAnimatedNumber(Math.round((list.counts?.todayCents ?? 0) / 100));

  function clearFilters() {
    q.clear();
    setArchiveSet("active");
  }

  // First-run gates on the SERVER's total, never on the loaded page — a no-match search on a
  // populated shop must fall through to an empty list, not to "No jobs yet". `?? 1` while the
  // count is in flight keeps the first-run screen from flashing before it lands.
  const total = list.total;
  // First-run gates on the UNFILTERED book — the filtered total reads 0 on a no-match
  // search, which told a shop with hundreds of jobs "No jobs yet".
  const firstRun = shouldShowFirstRun({ isFetched: list.isFetched, isError: list.isError, count: list.bookTotal ?? 1 });
  const loadFailed = shouldShowLoadFailed({ isFetched: list.isFetched, isError: list.isError, count: total ?? 0 });
  // Cold load only — a filter change keeps previous rows on screen instead of the loader.
  const loading = list.isLoading && list.rows.length === 0 && !list.isFetched;

  return (
    <div className="jh-wrap">
      {/* grain desk — fixed, jobs-page only, behind content */}
      <div className="jh-grain" aria-hidden="true" />

      <div className="jh-head">
        <div>
          <h1>Jobs</h1>
          <div className="jh-verdict">
            {/* Cold load: the figure would state "$0 scheduled today" as fact for a beat. */}
            {loading ? (
              <span className="sk" style={{ display: "inline-block", width: 140, height: 22 }} aria-hidden="true" />
            ) : (
              <>
                <b className="jh-vfig mono">${shownTrucks.toLocaleString("en-US")}</b>
                <span className="jh-vlbl">scheduled today</span>
              </>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <button className="btn ghost" onClick={() => openModal(MODAL.IMPORT_JOBS)}>
            Import
          </button>
          <button className="btn primary" onClick={onOpenNewJob}>+ New job</button>
        </div>
      </div>

      <div className="mob-new">
        <button className="btn primary" onClick={onOpenNewJob}>+ New job</button>
      </div>

      <CallbackAutopsyCard />

      {loadFailed ? (
        <LoadFailed noun="jobs" onRetry={list.refetch} retrying={list.isRefetching} />
      ) : firstRun ? (
        <FirstRunEmptyState
          heading={FIRST_RUN.heading}
          subtext={FIRST_RUN.subtext}
          paths={[
            { ...FIRST_RUN.book, onAction: onOpenNewJob, variant: "primary" },
            { ...FIRST_RUN.quote, onAction: () => router.push("/composer") },
          ]}
        />
      ) : loading ? (
        <ListLoading />
      ) : (
        <>
          <JobsToolbar
            archiveSet={archiveSet}
            onArchiveSet={setArchiveSet}
            q={q.search}
            onQ={q.setSearch}
            total={total ?? 0}
            shown={list.shown}
          />

          {/* THE one filter, rendered unconditionally. It used to sit behind a Filters disclosure
              while the list defaults to view="today", so the screen arrived filtered with nothing
              on it naming the filter and the toolbar read "20 of 20" on a ~1,500-job book. Same
              slot and the same component shape as the Customers list. */}
          <JobsViewFilter
            view={q.view}
            counts={list.counts?.counts}
            onView={q.setView}
            disabled={archiveSet === "archived"}
          />

          {list.rows.length === 0 ? (
            <div className="empty-att" style={{ padding: "var(--space-6) 0" }}>
              {q.search || view ? (
                <>
                  No jobs match that — <span className="linklike" onClick={clearFilters}>clear the filters</span>
                </>
              ) : (
                <>
                  No jobs yet — <span className="linklike" onClick={onOpenNewJob}>create one</span>
                </>
              )}
            </div>
          ) : (
            <>
              <JobsListView items={rows} sort={sort} onSort={setSort} onOpenJob={onOpenJob} />

              {/* Load-more, not infinite scroll: someone scanning a list wants to reach the bottom
                  of it, and an auto-loading list has no bottom. */}
              {list.hasMore && (
                <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-4) 0" }}>
                  <button className="btn" onClick={list.loadMore} disabled={list.isLoadingMore}>
                    {list.isLoadingMore ? "Loading…" : `Load more — showing ${list.shown} of ${total ?? "…"}`}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
