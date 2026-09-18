"use client";

import { useEffect, useMemo } from "react";
import { api } from "@/lib/trpc/client";
import { useAppStore } from "@/lib/store/app-store";
import { dtoToTimeEntry } from "@/lib/store/dto-mapper";

/**
 * One week of time entries, fetched for THAT week.
 *
 * The office panel has always been week-scoped — it has a week toolbar and a Monday-normalised
 * weekStart — but the data underneath it was not: a hydrator fetched a flat, unscoped page of the
 * newest 500 entries and the panel filtered that window down to the week on screen.
 *
 * At 6 technicians and 20 jobs a day that window is about a month. Navigate back past it and the
 * week renders EMPTY — not "no hours logged", which would be a fact, but "we never fetched those
 * rows", which looks identical on screen. Payroll disagreeing with reality is the worst possible
 * place for that failure. The list endpoint already accepted fromDate/toDate; nothing passed them.
 *
 * WHY THIS WRITES THE STORE INSTEAD OF RETURNING ROWS.
 * The panel's edits are optimistic writes into the timesheets slice — stop the clock, fix an out
 * time, approve a week — which reconcile from the returned DTO. A panel rendering query data
 * directly would show every edit reverting until the next refetch. So the fetch stays the loader
 * and the store stays the single thing the grid reads, exactly as every other surface here works.
 * This is now the ONLY writer of that slice: the unscoped hydrator was deleted rather than left to
 * race this one with a different scope.
 *
 * NOT paginated, deliberately. A week of one shop's hours is bounded by people times days worked;
 * it is a payroll period, not a feed. The cap below is a backstop, not a page size.
 */

/** Far above any real week — six techs clocking four segments a day is ~170 rows. */
const WEEK_CAP = 500;

export interface TimesheetsWeekArgs {
  /** ISO Monday of the week being shown. */
  readonly weekStart: string;
}

/** The Sunday that closes a Monday-started week — inclusive, matching the endpoint's range. */
const weekEndOf = (weekStart: string): string => {
  const d = new Date(`${weekStart}T00:00:00`);
  d.setDate(d.getDate() + 6);
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  // Built from local parts, not toISOString(): that converts to UTC first, so at any positive UTC
  // offset local midnight falls on the previous UTC day and the range would close on the Saturday,
  // dropping Sunday's hours from the week that contains them. US shops happen to sit at negative
  // offsets where it works by luck — which is exactly the kind of thing that breaks on the first
  // customer who does not.
  return `${d.getFullYear()}-${m}-${day}`;
};

export function useTimesheetsWeek({ weekStart }: TimesheetsWeekArgs) {
  const setTimeEntries = useAppStore((s) => s.setTimeEntries);
  const toDate = useMemo(() => weekEndOf(weekStart), [weekStart]);

  const week = api.v1.timesheets.list.useQuery(
    { fromDate: weekStart, toDate, limit: WEEK_CAP },
    { refetchOnWindowFocus: false },
  );

  // Whether the SHOP has ever logged an hour, which is a different question from whether anyone
  // worked this week. Both render an empty grid; only the first should be offered the set-up
  // screen. Unfiltered on purpose, and it stays valid as the user pages through weeks.
  const everCount = api.v1.timesheets.count.useQuery({}, { refetchOnWindowFocus: false });

  const items = week.data?.items;

  useEffect(() => {
    if (!items) return;
    setTimeEntries(items.map(dtoToTimeEntry));
  }, [items, setTimeEntries]);

  return {
    /** Rows returned for the week — the grid itself reads the store, which this fills. */
    count: items?.length ?? 0,
    /** True when the week overflowed its backstop, so the grid is not the whole week. */
    truncated: (items?.length ?? 0) >= WEEK_CAP,
    /** Entries across all time. Undefined until it lands — gates must not guess zero. */
    everCount: everCount.data?.total,
    isFetched: week.isFetched && everCount.isFetched,
    isError: week.isError || everCount.isError,
    refetch: () => {
      void week.refetch();
      void everCount.refetch();
    },
    isRefetching: week.isRefetching || everCount.isRefetching,
  };
}
