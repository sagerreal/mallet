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
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/trpc/client";
import { todayISO } from "@/lib/clock";
import { useTickingNow } from "@/lib/use-ticking-now";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LoadFailed } from "@/components/shared/load-failed";
import { reportWriteError } from "@/lib/store/write-error";
import { useMe } from "@/features/identity/hooks";
import { myHoursListInput, MY_HOURS_STALE_MS } from "./my-hours-input";
import { daySummary, hoursClock, type DaySummary } from "./day-segments";
import {
  dayClockView,
  optimisticView,
  DAY_CLOCK_ACTIONS,
  WRITE_ACTION_FOR_TAP,
  type DayClockTap,
  type DayClockView,
} from "./day-clock-view";

/**
 * Enough of a My day job to NAME a job segment — "#JOB-2541 Delgado" instead of "Job". Passed in
 * rather than fetched: the page already holds today's agenda, and a card that re-queried for
 * labels would be asking the same server the same question twice.
 */
export interface DayClockJob {
  readonly id: string;
  readonly num: string;
  readonly title: string | null;
  readonly customerName: string | null;
}

interface DayClockProps {
  /** Today's assigned jobs, for labelling job segments. A segment on a job that is no longer on
   *  the agenda (reassigned) simply reads "Job" — never a wrong name. */
  jobs?: readonly DayClockJob[];
}

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
 * Today's segments, off the SAME query My hours reads — `v1.timesheets.list`, not
 * `v1.timesheets.open`.
 *
 * That choice is load-bearing. After End day, `open` returns null and this card knows nothing
 * about the day it just finished — it reverts to "Off the clock / Start day" at exactly the
 * moment somebody wants to check what they worked. `list` still holds every finished row, and
 * the End-day tap already invalidates it.
 *
 * NO EXTRA REQUEST. The field layout already fires this exact input via `myHoursListInput`
 * (features/field/field-jobs-hydrator.tsx), at this exact staleTime, so the two dedupe into one
 * fetch. The prefetch is one-shot per mount and only WARMS the cache; this useQuery is what keeps
 * the card subscribed, so a clockTap invalidation re-renders it.
 *
 * Disabled until `me` resolves, for the reason My hours is: an unscoped first fetch would serve
 * an owner-operator the whole org's rows and quietly total somebody else's day into theirs.
 */
function useDaySummary(jobs: readonly DayClockJob[], now: Date): DaySummary | null {
  const me = useMe();
  const myUserId = me.data?.userId;
  const list = api.v1.timesheets.list.useQuery(
    myHoursListInput(myUserId ?? ""),
    { staleTime: MY_HOURS_STALE_MS, refetchOnWindowFocus: false, enabled: Boolean(myUserId) },
  );

  const jobLabel = useCallback(
    (jobId: string): string | null => {
      const job = jobs.find((j) => j.id === jobId);
      if (!job) return null;
      const who = job.customerName ?? job.title;
      return who ? `#${job.num} ${who}` : `#${job.num}`;
    },
    [jobs],
  );

  const items = list.data?.items;
  return useMemo(
    () => (items ? daySummary(items, todayISO(), now, jobLabel) : null),
    [items, now, jobLabel],
  );
}

/**
 * The day, laid out: where it began, every stretch in the order it happened, and the two totals.
 *
 * Breaks are listed individually because that is how they are stored — an ordinary row with
 * `kind='break'` and its own start and end — and because "0:30 of break" hides a lunch left
 * running, which is the commonest way this record goes wrong and the only unpaid kind.
 */
function DaySegments({ day }: { day: DaySummary }) {
  return (
    <div className="clock-day">
      {day.dayStart ? (
        <div className="clock-daystart">Day started {day.dayStart}</div>
      ) : null}
      <ul className="clock-segs">
        {day.segments.map((s) => (
          <li key={s.id} className={s.kind === "break" ? "clock-seg brk" : "clock-seg"}>
            <span className="clock-seg-l">{s.running ? `${s.label} — now` : s.label}</span>
            <span className="clock-seg-t">{s.span}</span>
            {/* The running stretch grows; everything else is settled. Only the live one is masked
                out of the visual baseline. */}
            <span className="clock-seg-d" {...(s.running ? { "data-dynamic": true } : {})}>
              {hoursClock(s.hours)}
            </span>
          </li>
        ))}
      </ul>
      <div className="clock-tot">
        <span>Worked today</span>
        <span className="clock-seg-d" data-dynamic>
          {hoursClock(day.workedHours)}
        </span>
      </div>
      {day.breakHours > 0 ? (
        <div className="clock-tot brk">
          <span>Break (unpaid)</span>
          <span className="clock-seg-d" data-dynamic>
            {hoursClock(day.breakHours)}
          </span>
        </div>
      ) : null}
    </div>
  );
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

/**
 * The state sentence and the day's total — "On the clock  since 7:42a  1:08".
 *
 * THE BIG FIGURE IS THE DAY, NOT THE CURRENT STRETCH. It used to be `elapsedLabel(open)`, the
 * length of the segment that happened to be running, which resets on every break and on every job
 * start: at 4pm after a normal day it read 0:50. It is also the number the expanded panel totals
 * as "Worked today", and two figures on one card that disagree are worse than one being absent —
 * which is why it stays absent until the day's rows land rather than falling back to the old one.
 */
function ClockSentence({ view, workedHours }: { view: DayClockView; workedHours: number | null }) {
  return (
    <>
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
      {workedHours !== null ? (
        <span
          className="clock-elapsed"
          // Genuinely live: masked out of the visual baseline, which would otherwise fail on
          // every run as the total grows. See dynamicRegions in e2e/helpers/ui.ts.
          data-dynamic
          // Announced on its own, not as part of the sentence: a screen reader should not
          // re-read "On the clock since 8:14p" every minute.
          aria-live="off"
        >
          {hoursClock(workedHours)}
        </span>
      ) : null}
    </>
  );
}

export function DayClock({ jobs = [] }: DayClockProps) {
  const now = useTickingNow();
  const [dayOpen, setDayOpen] = useState(false);
  const open = api.v1.timesheets.open.useQuery(undefined, {
    staleTime: OPEN_STALE_MS,
    refetchOnWindowFocus: false,
  });
  const day = useDaySummary(jobs, now);
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
  const actions = DAY_CLOCK_ACTIONS[view.state];
  // A day worth opening. No rows today = no toggle: an expander onto an empty panel is a dead
  // control, and before the first punch there is genuinely nothing to read.
  const hasDay = day !== null && day.segments.length > 0;

  const stateSentence = <ClockSentence view={view} workedHours={hasDay ? day.workedHours : null} />;

  return (
    <ClockCard>
      <div className="clock-head">
        {/* One live region for the whole state sentence, so a state change is announced as the
            sentence it is rather than as two unrelated fragments. */}
        <div className="clock-meta" aria-live="polite">
          {hasDay ? (
            // The sentence and the total ARE the trigger — one large target, and the actions stay
            // outside it so a button never nests inside a button (WCAG nested-interactive).
            <button
              type="button"
              className="clock-open"
              aria-expanded={dayOpen}
              onClick={() => setDayOpen((v) => !v)}
            >
              {stateSentence}
              <span className="clock-caret" aria-hidden="true">
                ›
              </span>
              <span className="sr-only">{dayOpen ? " Hide today's hours" : " Show today's hours"}</span>
            </button>
          ) : (
            stateSentence
          )}
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
      {/* IN FLOW, inside the same Card, pushing the agenda down — never a popover. Same shape as
          the My hours row editor (features/field/my-hours-entries.tsx). */}
      {dayOpen && day ? <DaySegments day={day} /> : null}
    </ClockCard>
  );
}
