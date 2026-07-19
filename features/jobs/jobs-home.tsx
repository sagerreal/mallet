"use client";

/**
 * features/jobs/jobs-home.tsx
 * The Jobs surface — a flat, sortable, filterable list (JobsListView). Built from
 * the lifecycle bands so status + default order read by state. The toolbar mirrors
 * Customers: search + Filters (Status incl. Archived, Crew) + Columns. Done+billed
 * jobs auto-archive after a week and drop off here — reachable via Status → Archived.
 * Header verdict = today's scheduled dollars. State lives in the store; this reads + renders.
 */

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/lib/store/app-store";
import { api } from "@/lib/trpc/client";
import { HYDRATOR_PAGE_LIMIT, HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import { shouldShowFirstRun, isFirstLoad } from "@/lib/first-run";
import { FirstRunEmptyState } from "@/components/shared/first-run-empty-state";
import { useCallbackCandidates } from "@/features/jobs/hooks";
import type { Invoice, Job } from "@/lib/store/types";
import { useAnimatedNumber } from "@/features/home/use-animated-number";
import { custName } from "./jobs-helpers";
import { jobCrewTech } from "./job-row";
import { deriveOnTrucks, deriveJobBands, deriveArchivedBands, jobTotal, type JobBand } from "./today-derive";
import type { Tech } from "@/lib/store/types";
import { useJobsSort } from "./use-jobs-sort";
import { JobsListView } from "./jobs-list-view";
import { CallbackAutopsyCard } from "./callback-autopsy-card";
import { JobsToolbar } from "./jobs-toolbar";
import { JobsFilters } from "./jobs-filters";
import { JobsColumns } from "./jobs-columns";
import { JOB_STATUS_FILTERS, DEFAULT_JOB_COLS, JOB_COL_ORDER, type JobColKey, type JobsArchiveSet } from "./jobs-list-config";

export interface JobsHomeProps {
  onOpenJob: (id: string) => void;
  onOpenNewJob: () => void;
}

/** The bands to render for the current set (active vs archived) + Status filter,
 *  plus the set total for the "N of M" count. */
function selectBands(
  filtered: Job[],
  invoices: Invoice[],
  archiveSet: JobsArchiveSet,
  statusFilter: string
): { bandsToShow: JobBand[]; total: number } {
  if (archiveSet === "archived") {
    const archived = deriveArchivedBands(filtered, invoices);
    return { bandsToShow: archived, total: archived.reduce((s, b) => s + b.count, 0) };
  }
  const active = deriveJobBands(filtered, invoices);
  const statusDef = JOB_STATUS_FILTERS.find((s) => s.value === statusFilter);
  const bandsToShow = statusDef && statusDef.keys.length ? active.filter((b) => statusDef.keys.includes(b.key)) : active;
  return { bandsToShow, total: active.reduce((s, b) => s + b.count, 0) };
}

/** Narrow each band's jobs to one crew (empty = all); drops emptied bands. */
function applyCrew(bands: JobBand[], techs: Tech[], crewFilter: string): JobBand[] {
  if (!crewFilter) return bands;
  return bands
    .map((b) => {
      const jobs = b.jobs.filter((j) => jobCrewTech(b.key, j, techs)?.id === crewFilter);
      return { ...b, jobs, count: jobs.length, sum: jobs.reduce((s, j) => s + jobTotal(j), 0) };
    })
    .filter((b) => b.jobs.length > 0);
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
  const candidates = useCallbackCandidates();
  const jobs = useAppStore((s) => s.jobs);
  const leads = useAppStore((s) => s.leads);
  const invoices = useAppStore((s) => s.invoices);
  const techs = useAppStore((s) => s.techs);
  const { sort, setSort } = useJobsSort();

  const [archiveSet, setArchiveSet] = useState<JobsArchiveSet>("active");
  const [jobsQ, setJobsQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [crewFilter, setCrewFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  const [visibleCols, setVisibleCols] = useState<JobColKey[]>([...DEFAULT_JOB_COLS]);

  const q = jobsQ.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? jobs.filter((j) =>
            (custName(j, leads) + " " + (j.title ?? "") + " " + (j.addr ?? "")).toLowerCase().includes(q)
          )
        : jobs,
    [jobs, leads, q]
  );

  const trucksValue = useMemo(() => deriveOnTrucks(jobs), [jobs]);
  const shownTrucks = useAnimatedNumber(trucksValue);

  const { bandsToShow, total } = useMemo(
    () => selectBands(filtered, invoices, archiveSet, statusFilter),
    [filtered, invoices, archiveSet, statusFilter]
  );
  const finalBands = useMemo(
    () => applyCrew(bandsToShow, techs, crewFilter),
    [bandsToShow, techs, crewFilter]
  );
  const shown = finalBands.reduce((s, b) => s + b.jobs.length, 0);
  const activeFilterCount = (archiveSet === "active" && statusFilter ? 1 : 0) + (crewFilter ? 1 : 0);

  function toggleCol(key: JobColKey) {
    setVisibleCols((prev) =>
      prev.includes(key) ? prev.filter((c) => c !== key) : JOB_COL_ORDER.filter((c) => prev.includes(c) || c === key)
    );
  }

  function clearFilters() {
    setJobsQ("");
    setStatusFilter("");
    setCrewFilter("");
  }

  const empty = jobs.length === 0;
  // Same query key + options as JobsHydrator → React Query dedupes it (no extra fetch). Gate the
  // first-run screen on the TOTAL job count (never the filtered `shown`) so a no-match search on a
  // populated shop still falls through to the list. Never flashes mid-fetch / on a failed load.
  const { isFetched, isError } = api.v1.jobs.list.useQuery(
    { limit: HYDRATOR_PAGE_LIMIT },
    { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false },
  );
  const firstRun = shouldShowFirstRun({ isFetched, isError, count: jobs.length });
  // Cold reload: the store hasn't hydrated yet (query in flight, nothing cached). Render a loading
  // line rather than falling through to the "No jobs yet" copy below — otherwise a shop that HAS
  // jobs is told it has none for a beat before the rows (or the first-run screen) arrive.
  const loading = isFirstLoad({ isFetched, isError, count: jobs.length });

  return (
    <div className="jh-wrap">
      {/* grain desk — fixed, jobs-page only, behind content */}
      <div className="jh-grain" aria-hidden="true" />

      <div className="jh-head">
        <div>
          <h1>Jobs</h1>
          <div className="jh-verdict">
            <b className="jh-vfig mono">${shownTrucks.toLocaleString("en-US")}</b>
            <span className="jh-vlbl">scheduled today</span>
          </div>
        </div>
        <button className="btn primary" onClick={onOpenNewJob}>+ New job</button>
      </div>

      <div className="mob-new">
        <button className="btn primary" onClick={onOpenNewJob}>+ New job</button>
      </div>

      {(() => {
        const count = candidates.data?.length ?? 0;
        return count > 0 ? (
          <div className="cb-review-bar">
            <b>{count}</b> callback{count === 1 ? "" : "s"} to review
          </div>
        ) : null;
      })()}

      <CallbackAutopsyCard />

      {firstRun ? (
        <FirstRunEmptyState
          heading={FIRST_RUN.heading}
          subtext={FIRST_RUN.subtext}
          paths={[
            { ...FIRST_RUN.book, onAction: onOpenNewJob, variant: "primary" },
            { ...FIRST_RUN.quote, onAction: () => router.push("/composer") },
          ]}
        />
      ) : loading ? (
        <div className="empty-att" style={{ padding: "24px 0" }} aria-busy="true">
          Loading…
        </div>
      ) : (
        <>
          <JobsToolbar
            archiveSet={archiveSet}
            onArchiveSet={setArchiveSet}
            q={jobsQ}
            onQ={setJobsQ}
            filtersOpen={filtersOpen}
            onToggleFilters={() => setFiltersOpen((o) => !o)}
            colsOpen={colsOpen}
            onToggleCols={() => setColsOpen((o) => !o)}
            activeFilterCount={activeFilterCount}
            total={total}
            shown={shown}
          />

          {colsOpen && <JobsColumns visible={visibleCols} onToggle={toggleCol} />}

          {filtersOpen && (
            <JobsFilters
              statusFilter={statusFilter}
              crewFilter={crewFilter}
              techs={techs}
              onStatus={setStatusFilter}
              onCrew={setCrewFilter}
              onClear={clearFilters}
              showStatus={archiveSet === "active"}
            />
          )}

          {empty ? (
            <div className="empty-att" style={{ padding: "24px 0" }}>
              No jobs yet — <span className="linklike" onClick={onOpenNewJob}>create one</span>
            </div>
          ) : (
            <JobsListView
              bands={finalBands}
              sort={sort}
              onSort={setSort}
              onOpenJob={onOpenJob}
              visibleCols={visibleCols}
            />
          )}
        </>
      )}
    </div>
  );
}
