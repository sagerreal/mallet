"use client";

/**
 * features/settings/use-timesheet-clock.ts
 * Does this shop punch a clock, or does the crew write their week down?
 *
 * Both are real shops. A punch shop taps start/break/end and the rows write themselves; a sheet
 * shop has people type "Monday, 7 to 3:30". `time_entries.src` has always allowed both
 * (`manual | clock | timer`), so this is a SURFACE decision and nothing about the hours, the
 * approval or the QuickBooks push changes with it.
 *
 * Reads `v1.settings.fieldToggles` — `anyRole`, and the only settings read the field surface has.
 * `v1.settings.get` is ownerOrOffice and always will be, so a technician could never see the
 * office payload; this is the narrow window that exists for exactly this kind of flag. Same query
 * key as the field-toggles hydrator, so it costs no extra request.
 *
 * DEFAULTS TRUE while loading and on failure. Showing the clock to a sheet shop is a surface they
 * ignore; HIDING it from a punch shop takes away the control their whole day runs on.
 */
import { api } from "@/lib/trpc/client";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";

export function useTimesheetClock(): boolean {
  const { data } = api.v1.settings.fieldToggles.useQuery(undefined, {
    staleTime: HYDRATOR_STALE_MS,
    refetchOnWindowFocus: false,
  });
  return data?.timesheetClock ?? true;
}
