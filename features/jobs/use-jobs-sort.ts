"use client";

/**
 * features/jobs/use-jobs-sort.ts
 * Remembers, per browser, how the owner sorts the Jobs list (which column +
 * direction). Persisted to localStorage. Starts at the default and hydrates
 * after mount, so server and first client render agree.
 */

import { useEffect, useState } from "react";

export type JobsSortCol = "when" | "amount" | "customer";
export type SortDir = "asc" | "desc";

export interface JobsSort {
  col: JobsSortCol;
  dir: SortDir;
}

const SORT_KEY = "mallet.jobs.sort";
const DEFAULT_SORT: JobsSort = { col: "when", dir: "asc" };
const SORT_COLS: readonly JobsSortCol[] = ["when", "amount", "customer"];

function readSort(): JobsSort {
  if (typeof window === "undefined") return DEFAULT_SORT;
  try {
    const raw = window.localStorage.getItem(SORT_KEY);
    if (!raw) return DEFAULT_SORT;
    const parsed = JSON.parse(raw) as Partial<JobsSort>;
    const col = SORT_COLS.includes(parsed.col as JobsSortCol) ? (parsed.col as JobsSortCol) : DEFAULT_SORT.col;
    const dir = parsed.dir === "asc" || parsed.dir === "desc" ? parsed.dir : DEFAULT_SORT.dir;
    return { col, dir };
  } catch {
    return DEFAULT_SORT;
  }
}

export interface UseJobsSort {
  sort: JobsSort;
  setSort: (s: JobsSort) => void;
}

export function useJobsSort(): UseJobsSort {
  const [sort, setSortState] = useState<JobsSort>(DEFAULT_SORT);

  // Hydrate from storage after mount — avoids a server/client render mismatch.
  useEffect(() => {
    setSortState(readSort());
  }, []);

  const setSort = (s: JobsSort) => {
    setSortState(s);
    if (typeof window !== "undefined") window.localStorage.setItem(SORT_KEY, JSON.stringify(s));
  };

  return { sort, setSort };
}
