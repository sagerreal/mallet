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
  /** The day's booked load in minutes (today's visit durations, summed by the page) — the
   *  "of 7h 45m scheduled" line and the ring's denominator. 0 hides the line. */
  scheduledMinutes?: number;
}

/** "4h 0m" — the DAY TOTAL card's figure grammar (the mock's, not the segment panel's H:MM). */
const figureLabel = (hours: number): string => {
  const mins = Math.round(hours * 60);
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
};

/** The worked-vs-booked donut. Pure SVG, no dependency; masked from the visual net (it grows). */
const RING_R = 42;
const RING_CIRC = 2 * Math.PI * RING_R;
function ClockRing({ fraction }: { fraction: number }) {
  const clamped = Math.min(Math.max(fraction, 0), 1);
  return (
    <svg className="clock-ring" width="106" height="106" viewBox="0 0 106 106" aria-hidden data-dynamic>
      <circle cx="53" cy="53" r={RING_R} fill="none" stroke="var(--line-2)" strokeWidth="10" />
      <circle
        cx="53"
        cy="53"
        r={RING_R}
        fill="none"
        stroke="var(--ink)"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={RING_CIRC}
        strokeDashoffset={RING_CIRC * (1 - clamped)}
        transform="rotate(-90 53 53)"
      />
    </svg>
  );
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
 *
 * THE READ'S FAILURE IS RETURNED, NOT SWALLOWED. `daySummary` can only be built from rows, so a
 * refused fetch and a day with no punches both leave it null — and rendered the same they are
 * byte-identical: no total, no expander, nothing. On the one screen whose job is telling a man he
 * is being paid, "we could not ask" must not read as "you have not worked". The caller draws the
 * failure and a retry; see DayClock below.
 */
interface DayRead {
  /** Today, once the rows are in. Null while loading, on failure, and on a day with no punches. */
  readonly day: DaySummary | null;
  /** The read was refused. The panel and the total are unknown, not empty. */
  readonly failed: boolean;
  /** A retry is in flight. */
  readonly retrying: boolean;
  readonly retry: () => void;
}

function useDaySummary(jobs: readonly DayClockJob[], now: Date): DayRead {
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
  const day = useMemo(
    () => (items ? daySummary(items, todayISO(), now, jobLabel) : null),
    [items, now, jobLabel],
  );

  const refetch = list.refetch;
  const retry = useCallback(() => void refetch(), [refetch]);

  return { day, failed: list.isError, retrying: list.isFetching, retry };
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
function ClockSentence({ view }: { view: DayClockView }) {
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
    </>
  );
}

export function DayClock({ jobs = [], scheduledMinutes = 0 }: DayClockProps) {
  const now = useTickingNow();
  const [dayOpen, setDayOpen] = useState(false);
  const open = api.v1.timesheets.open.useQuery(undefined, {
    staleTime: OPEN_STALE_MS,
    refetchOnWindowFocus: false,
  });
  const { day, failed: dayFailed, retrying: dayRetrying, retry: retryDay } = useDaySummary(jobs, now);
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

  // The open row is always clock-shaped (a running time-off entry is unconstructible) —
  // narrow the wire type at this one seam instead of widening the view.
  const openRow = open.data?.open;
  const openView =
    openRow && openRow.startTime !== null
      ? { kind: openRow.kind as "job" | "travel" | "break" | "shop", workDate: openRow.workDate, startTime: openRow.startTime }
      : null;
  const view = predicted ?? dayClockView(openView, todayISO());
  const actions = DAY_CLOCK_ACTIONS[view.state];
  // A day worth opening. No rows today = no toggle: an expander onto an empty panel is a dead
  // control, and before the first punch there is genuinely nothing to read.
  const hasDay = day !== null && day.segments.length > 0;

  const workedHours = hasDay ? day.workedHours : 0;
  const scheduledHours = scheduledMinutes / 60;

  // The mock's DAY TOTAL block: the big figure, what the day holds, and the state sentence.
  // A REFUSED hours read shows "—", never a confident zero — on the one card whose job is
  // telling a man he is being paid, "we could not ask" must not read as "you have not worked".
  const figures = (
    <>
      {/* Genuinely live: masked out of the visual baseline, which would otherwise fail on
          every run as the total grows. Announced on its own, not as part of the sentence. */}
      <span className="clock-elapsed" data-dynamic aria-live="off">
        {dayFailed ? "—" : figureLabel(workedHours)}
      </span>
      {scheduledMinutes > 0 && !dayFailed ? (
        <span className="clock-of">of {figureLabel(scheduledHours)} scheduled</span>
      ) : null}
      <span className="clock-state">
        <ClockSentence view={view} />
      </span>
    </>
  );

  return (
    <ClockCard>
      <div className="mdp-kicker">Day total</div>
      <div className="clock-head clockface">
        {/* Worked against booked. Denominator absent (or the read refused) → an empty track,
            never a full ring claiming a day with nothing scheduled is done. */}
        <ClockRing fraction={scheduledHours > 0 && !dayFailed ? workedHours / scheduledHours : 0} />
        {/* One live region for the whole block, so a state change is announced as the
            sentence it is rather than as two unrelated fragments. */}
        <div className="clock-meta" aria-live="polite">
          {hasDay ? (
            // The figures ARE the trigger — one large target, and the actions stay outside it
            // so a button never nests inside a button (WCAG nested-interactive).
            <button
              type="button"
              className="clock-open"
              aria-expanded={dayOpen}
              onClick={() => setDayOpen((v) => !v)}
            >
              <span className="clock-open-t">{figures}</span>
              <span className="clock-caret" aria-hidden="true">
                ›
              </span>
              <span className="sr-only">{dayOpen ? " Hide today's hours" : " Show today's hours"}</span>
            </button>
          ) : (
            figures
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
      {/* The hours could not be read. Said out loud, with a retry, rather than left to render as
          a day with no punches — the same words My hours uses for the same refusal
          (app/(field)/my-hours/page.tsx), and the same shape as the `open` failure above. The
          state sentence stays: it comes from `open`, which answered. */}
      {dayFailed ? (
        <LoadFailed noun="hours" onRetry={retryDay} retrying={dayRetrying} />
      ) : /* IN FLOW, inside the same Card, pushing the agenda down — never a popover. Same shape
             as the My hours row editor (features/field/my-hours-entries.tsx). */
      dayOpen && day ? (
        <DaySegments day={day} />
      ) : null}
    </ClockCard>
  );
}
