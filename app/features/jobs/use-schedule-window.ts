"use client";

import { useEffect, useMemo } from "react";
import { api } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import { dtoJobToStoreJob } from "@/lib/store/dto-mapper";

/**
 * The jobs the dispatch board is CURRENTLY showing, fetched for those dates.
 *
 * The board is day- or week-scoped and always has been, but it read the store's jobs collection,
 * which a hydrator fills with the newest page. At 20 jobs a day that page is a few weeks of work —
 * so paging the board forward to next month, or back past the window, drew an empty grid. An empty
 * grid is what "nothing is booked" looks like, which is the worst possible way for a scheduling
 * screen to fail: it invites double-booking a slot that is already taken.
 *
 * MERGES rather than replaces. A dozen surfaces read s.jobs; a window that replaced the collection
 * would empty all of them the moment someone opened the board. See mergeJobs in jobs-slice.
 */

/** A week of one shop's work. Six techs at 20 jobs a day is ~140 — this is headroom, not a page. */
const WINDOW_CAP = 400;

export interface ScheduleWindow {
  /** Inclusive ISO dates of the days on screen. */
  readonly from: string;
  readonly to: string;
}

export function useScheduleWindow({ from, to }: ScheduleWindow) {
  const mergeJobs = useAppStore((s) => s.mergeJobs);

  const q = api.v1.jobs.list.useQuery(
    { visitFrom: from, visitTo: to, limit: WINDOW_CAP },
    // The board is a shared surface that people drag things around on — a stale read after a
    // colleague moves a visit is a double-booking, so it refetches on focus.
    { refetchOnWindowFocus: true },
  );

  const items = q.data?.items;

  const jobs = useMemo(
    () => (items ?? []).map((j) => dtoJobToStoreJob(j as never)),
    [items],
  );

  useEffect(() => {
    if (jobs.length) mergeJobs(jobs);
  }, [jobs, mergeJobs]);

  return {
    /** True when the window overflowed its cap — the board is not showing all of those days. */
    truncated: jobs.length >= WINDOW_CAP,
    isFetched: q.isFetched,
    isError: q.isError,
    refetch: () => void q.refetch(),
    isRefetching: q.isRefetching,
  };
}
