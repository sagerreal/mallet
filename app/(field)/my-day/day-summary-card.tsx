"use client";

/**
 * app/(field)/my-day/day-summary-card.tsx — the DAY TOTAL card for a paged-to day.
 *
 * Today keeps the live DayClock; this card answers the same question for every other day.
 * PAST: what you were paid for (a real timesheet read — v1.timesheets.list, the same query My
 * hours renders from) against what was booked. FUTURE: the load you're walking into. No clock
 * buttons either way — you cannot clock into Thursday.
 */

import { Card } from "@/components/ui/card";
import { api } from "@/lib/trpc/client";
import { entryHours } from "@/features/field/my-hours-derive";
import { minutesLabel } from "./day-view";

export interface DaySummaryCardProps {
  dateISO: string;
  isPast: boolean;
  scheduledMinutes: number;
  jobCount: number;
}

export function DaySummaryCard({ dateISO, isPast, scheduledMinutes, jobCount }: DaySummaryCardProps) {
  // A past day's hours are a fact on the timesheet — read them; never derive from visits
  // (timesheets are payroll-first; visits move jobs, not hours).
  const entries = api.v1.timesheets.list.useQuery(
    { fromDate: dateISO, toDate: dateISO },
    { enabled: isPast, staleTime: 300_000, refetchOnWindowFocus: false },
  );

  if (!isPast) {
    return (
      <Card className="clockcard" style={{ marginBottom: "var(--space-3)" }}>
        <div className="mdp-kicker">Scheduled</div>
        <div className="clock-elapsed">{minutesLabel(scheduledMinutes)}</div>
        <div className="mdp-sub">
          {jobCount > 0
            ? `across ${jobCount} job${jobCount === 1 ? "" : "s"} · not started yet`
            : "nothing booked yet"}
        </div>
      </Card>
    );
  }

  const hours = (entries.data?.items ?? []).reduce((sum, e) => sum + entryHours(e), 0);
  const mins = Math.round(hours * 60);
  const loaded = entries.isFetched && !entries.isError;
  return (
    <Card className="clockcard" style={{ marginBottom: "var(--space-3)" }}>
      <div className="mdp-kicker">Day total</div>
      <div className="clock-elapsed">
        {loaded ? minutesLabel(mins) : "—"}
      </div>
      <div className="mdp-sub">
        {!loaded
          ? entries.isError
            ? "Couldn't load this day's hours."
            : "Loading hours…"
          : mins === 0
            ? "No hours this day"
            : scheduledMinutes > 0
              ? `of ${minutesLabel(scheduledMinutes)} booked · on your timesheet`
              : "on your timesheet"}
      </div>
    </Card>
  );
}
