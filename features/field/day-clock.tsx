"use client";

/**
 * features/field/day-clock.tsx
 * The technician's day row on My day: Start day → On the clock → Break → End day.
 *
 * It replaced a card that kept its state in React and persisted nothing — which meant a reload,
 * a backgrounded phone or a tab switch silently un-clocked the man. The state here is a database
 * row (`v1.timesheets.open` — the single running time entry), so the row reads the same after a
 * reload as it did before one. That is the whole point of the feature.
 *
 * Job time is NOT tapped here. On my way / Arrived / ✓ Mark done on the job screen move the same
 * clock between travel, on-site and shop, so this row only ever shows two things a job tap cannot
 * say: that the day has begun, and that lunch is unpaid.
 */

import { haptics } from "@/lib/haptics";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/trpc/client";
import { todayISO } from "@/lib/clock";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LoadFailed } from "@/components/shared/load-failed";
import { reportWriteError } from "@/lib/store/write-error";
import {
  dayClockView,
  optimisticView,
  DAY_CLOCK_ACTIONS,
  WRITE_ACTION_FOR_TAP,
  type DayClockTap,
  type DayClockView,
  elapsedLabel,
} from "./day-clock-view";

/**
 * How long the running entry is trusted without a refetch. Short, because the clock can also be
 * moved from the job screen (Arrived closes travel and opens job time) and this row must not sit
 * on a stale answer while the technician is looking at it.
 */
const OPEN_STALE_MS = 15_000;

/** The row's surface. One card, so the loading, failed and settled rows do not jump the page. */
function ClockCard({ children }: { children: ReactNode }) {
  return (
    <Card className="clockcard" style={{ marginBottom: "var(--space-3)" }}>
      {children}
    </Card>
  );
}

/**
 * The write half of the row: fire a tap, show the predicted state until the server answers, and
 * put the row back where it was if it refuses.
 *
 * The prediction is held in component state rather than written into the query cache, because a
 * predicted entry would need a fabricated row id — and a fake id in the cache is the sort of thing
 * that eventually gets sent somewhere.
 */
/**
 * A clock that advances, for the running total.
 *
 * The total is recomputed from the segment's own start rather than counted up, so a slept phone,
 * a backgrounded tab and a reload all land on the same number. Every 15s rather than every second:
 * the figure is shown to the minute, and this keeps the boundary tight without a per-second
 * re-render of a card that is on screen all day.
 */
function useTickingNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function useClockTap() {
  const utils = api.useUtils();
  const [predicted, setPredicted] = useState<DayClockView | null>(null);

  const clockTap = api.v1.timesheets.clockTap.useMutation();

  const tap = (tapName: DayClockTap): void => {
    // Fire with the OPTIMISTIC update, not on server success: the buzz is confirmation
    // that the press landed, and it has to arrive in the same instant as the UI does.
    // A punch made with no signal still feels like it happened, because it did.
    haptics.commit();
    setPredicted(optimisticView(tapName, new Date()));
    clockTap.mutate(
      // The DEVICE's timestamp, not the server's: a tap made with no signal is retried when the
      // van reaches the road, and the moment he pressed it is the moment he means. The server
      // bounds it in both directions before it becomes hours.
      { tap: tapName, at: new Date().toISOString() },
      {
        onSuccess: (result) => {
          utils.v1.timesheets.open.setData(undefined, result);
          setPredicted(null);
          // My hours reads a different query; without this the day's new segment only appears
          // there after its own staleTime expires.
          void utils.v1.timesheets.list.invalidate();
        },
        onError: (error) => {
          // Roll back to whatever the server last said, and say so out loud — a punch that
          // silently did not happen is exactly the failure this feature exists to prevent.
          setPredicted(null);
          haptics.warn();
          reportWriteError(WRITE_ACTION_FOR_TAP[tapName], error);
        },
      },
    );
  };

  return { predicted, tap };
}

export function DayClock() {
  const now = useTickingNow();
  const open = api.v1.timesheets.open.useQuery(undefined, {
    staleTime: OPEN_STALE_MS,
    refetchOnWindowFocus: false,
  });
  const { predicted, tap: handleTap } = useClockTap();

  // A failed load is not "off the clock". Showing the Start day button on a connection error
  // invites a second punch on top of one that is already running.
  if (open.isError) {
    return (
      <ClockCard>
        <LoadFailed noun="time clock" onRetry={() => void open.refetch()} retrying={open.isFetching} />
      </ClockCard>
    );
  }

  // Cold load: no state claim at all until the row is known, for the same reason.
  if (!open.isFetched && predicted === null) {
    return (
      <ClockCard>
        <div className="clock-head">
          <div className="clock-meta" role="status" aria-busy="true">
            <span className="muted">Loading your time clock…</span>
          </div>
        </div>
      </ClockCard>
    );
  }

  const view = predicted ?? dayClockView(open.data?.open, todayISO());
  // Nothing while a tap is still in flight: `predicted` describes the NEW segment while
  // `open.data` still holds the old one, so a total computed across the two would read as the
  // previous segment's length attached to the state that just replaced it.
  const elapsed = predicted !== null || view.state === "off" ? null : elapsedLabel(open.data?.open, now);
  const actions = DAY_CLOCK_ACTIONS[view.state];

  return (
    <ClockCard>
      <div className="clock-head">
        {/* One live region for the whole state sentence, so a state change is announced as the
            sentence it is rather than as two unrelated fragments. */}
        <div className="clock-meta" aria-live="polite">
          <b
            style={{
              fontWeight: 700,
              // The running states are marked in the verified-contrast green. The words carry the
              // meaning on their own — colour is never the only signal here.
              color: view.state === "off" ? "var(--ink)" : "var(--green-700)",
            }}
          >
            {view.title}
          </b>
          {view.since ? (
            <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
              {" "}
              {view.since}
            </span>
          ) : null}
          {/* The running total, ticking. The day clock is now the whole payroll record, so how long
              it has been running is the one number worth reading at a glance — and a clock that
              does not move is the one people distrust. */}
          {elapsed ? (
            <span
              className="clock-elapsed"
              // Genuinely live: masked out of the visual baseline, which would otherwise fail on
              // every run as the total grows. See dynamicRegions in e2e/helpers/ui.ts.
              data-dynamic
              // Announced on its own, not as part of the sentence: a screen reader should not
              // re-read "On the clock since 8:14p" every minute.
              aria-live="off"
            >
              {elapsed}
            </span>
          ) : null}
        </div>
        <div className="clock-acts">
          {actions.map((action) => (
            <Button
              key={action.tap}
              variant={action.primary ? "primary" : "quiet"}
              onClick={() => handleTap(action.tap)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </div>
    </ClockCard>
  );
}
