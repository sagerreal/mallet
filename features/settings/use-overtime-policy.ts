"use client";

/**
 * features/settings/use-overtime-policy.ts
 * The shop's overtime rule, for the surface that computes a technician's own overtime.
 *
 * WHY THIS EXISTS. My hours had the federal weekly-40 threshold compiled in
 * (`FULL_TIME_HOURS_PER_WEEK`), which is right in most states and wrong in the one the pilot shop
 * works in: California pays overtime past EIGHT HOURS IN A DAY, so five ten-hour days are ten
 * overtime hours that a weekly-only rule reports as none. Understating overtime on the screen whose
 * job is telling a man what he earned is the worst direction for that error to run.
 *
 * Reads `v1.settings.fieldToggles` — `anyRole`, the field surface's one settings window, and the
 * same query key as the clock hook and the field-toggles hydrator, so it costs no extra request.
 *
 * DEFAULTS TO FEDERAL while loading and on failure: weekly-40 with no daily rule. That is the
 * federal floor and the value the column itself defaults to, so a shop that has never opened
 * Settings sees the same figure either way — and no shop is ever shown a daily rule it did not set.
 */
import { api } from "@/lib/trpc/client";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import type { OvertimePolicy } from "@/features/field/hours-sheet-derive";

/** The federal floor: overtime past forty hours in a week, no daily rule. */
export const FEDERAL_OVERTIME_POLICY: OvertimePolicy = {
  weeklyThresholdMinutes: 40 * 60,
  dailyThresholdMinutes: null,
};

export function useOvertimePolicy(): OvertimePolicy {
  const { data } = api.v1.settings.fieldToggles.useQuery(undefined, {
    staleTime: HYDRATOR_STALE_MS,
    refetchOnWindowFocus: false,
  });
  return data?.overtime ?? FEDERAL_OVERTIME_POLICY;
}
