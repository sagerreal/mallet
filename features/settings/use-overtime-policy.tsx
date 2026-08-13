"use client";

/**
 * features/settings/use-overtime-policy.tsx
 * The shop's overtime rule, for the surface that computes a technician's own overtime.
 *
 * WHY THIS EXISTS. My hours had the federal weekly-40 threshold compiled in
 * (`FULL_TIME_HOURS_PER_WEEK`), which is right in most states and wrong in the one the pilot shop
 * works in: California pays overtime past EIGHT HOURS IN A DAY, so four ten-hour days are eight
 * overtime hours that a weekly-only rule reports as none. Understating overtime on the screen whose
 * job is telling a man what he earned is the worst direction for that error to run.
 *
 * SERVER-SEEDED, THEN LIVE — the same prior art as `useCanText` and `useMeasurementGate`, and for
 * a sharper reason. My hours is a client component under an SSR'd layout, so the first HTML is
 * painted before React hydrates and an empty query cache means the default. With a client-only
 * read a California technician saw his 4x10 week as "40.00 paid h" with NO overtime, which then
 * became "8.00 OT" a beat later: the exact figure this policy exists to get right, wrong first.
 *
 * The field layout already resolves this DTO per request (lib/auth/server-field-toggles.ts) and
 * was dropping this field, so the seed costs no request. A context value renders identically on
 * the server and on the first client render: no flash, no hydration mismatch.
 *
 * THE MERGE RULE mirrors `useCanText`: the LIVE query wins the moment it has answered, and the
 * seed covers every paint before that — so a rule changed in Settings mid-session appears without
 * a reload.
 *
 *   query landed → the query   (the office changes the policy; the figure follows)
 *   seeded       → the seed    (this request's own server read)
 *   neither      → FEDERAL     (the column's default, and the law where no state rule applies)
 *
 * FAILS TO THE FEDERAL FLOOR rather than to "unknown". There is no fail-open/fail-closed dilemma
 * here: weekly-40 is both the column default and the rule where no state adds one, so a failed
 * read shows a shop exactly what a shop that never opened Settings sees — never a daily rule
 * nobody set, and never a blank where a paycheck figure belongs.
 */

import { createContext, useContext, type ReactNode } from "react";
import { api } from "@/lib/trpc/client";
import { HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import type { OvertimePolicySeed } from "@/lib/field-toggles-seed";
import type { OvertimePolicy } from "@/features/field/hours-sheet-derive";

/** The federal floor: overtime past forty hours in a week, no daily rule. */
export const FEDERAL_OVERTIME_POLICY: OvertimePolicy = {
  weeklyThresholdMinutes: 40 * 60,
  dailyThresholdMinutes: null,
};

const OvertimePolicyContext = createContext<OvertimePolicySeed | null>(null);

export function OvertimePolicyProvider({
  seed,
  children,
}: {
  seed: OvertimePolicySeed | null;
  children: ReactNode;
}) {
  return <OvertimePolicyContext.Provider value={seed}>{children}</OvertimePolicyContext.Provider>;
}

export function useOvertimePolicy(): OvertimePolicy {
  const seed = useContext(OvertimePolicyContext);
  const { data } = api.v1.settings.fieldToggles.useQuery(undefined, {
    staleTime: HYDRATOR_STALE_MS,
    refetchOnWindowFocus: false,
  });
  return data?.overtime ?? seed ?? FEDERAL_OVERTIME_POLICY;
}
