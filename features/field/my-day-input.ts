"use client";

import { useMemo } from "react";
import { todayISO } from "@/lib/clock";

/**
 * The EXACT input every caller passes to v1.field.myDay — single source of truth, imported by the
 * page (its useQuery AND its optimistic setData) and by the field hydrator.
 *
 * Two things break if these are built independently, and both are silent:
 *
 *  1. A NEW OBJECT EVERY RENDER IS A NEW QUERY KEY. An inline `new Date()` changes on every render,
 *     so the query never settles — it refetches forever. Hence the memo, keyed on the local
 *     calendar day, which is stable until midnight.
 *
 *  2. `utils.v1.field.myDay.setData(input, …)` MATCHES ON THE INPUT. Once the query takes one, a
 *     setData that passes anything else silently patches a cache entry nobody reads, and the
 *     optimistic Start/Complete flip dies — the button sits unchanged for the whole round trip,
 *     which is the exact failure the optimistic path was written to fix.
 *
 * The window is the caller's LOCAL day expressed as two absolute instants, half-open
 * [dayStart, dayEnd). It has to come from the client: there is no org timezone column, so the
 * server's "today" is UTC, and a UTC day boundary empties a Pacific technician's list every
 * afternoon at 5pm.
 */

export interface MyDayInput {
  readonly dayStart: Date;
  readonly dayEnd: Date;
}

/** Local midnight → next local midnight, as instants. Pure; exported for tests. */
export function myDayWindow(localDayISO: string): MyDayInput {
  // No trailing Z: an ISO datetime without an offset is parsed in the device's own zone, which is
  // the whole point. Same convention as lib/clock's addDaysISO.
  const dayStart = new Date(`${localDayISO}T00:00:00`);
  const dayEnd = new Date(dayStart);
  // setDate, not +86_400_000: across a DST boundary the local day is 23 or 25 hours long and the
  // agenda still has to mean "until midnight tonight".
  dayEnd.setDate(dayEnd.getDate() + 1);
  return { dayStart, dayEnd };
}

/** The memoized input. Stable for the whole calendar day; rolls over on the first render after it. */
export function useMyDayInput(): MyDayInput {
  const today = todayISO();
  return useMemo(() => myDayWindow(today), [today]);
}
