"use client";

/**
 * My Hours page — the technician's own timesheet, and the only place he can correct it.
 *
 * Reads v1.timesheets.list (anyRole; the router ignores any techUserId a tech passes and always
 * scopes to ctx.principal.userId). Writes go to v1.timesheets.update / .create, which authorise
 * by ownership — a tech may only touch his own rows — and refuse an approved row outright.
 *
 * Deliberately does NOT use the office Zustand timesheets slice: that slice is hydrated only
 * under the ownerOrOffice layout, so this page queries directly and stays the single reader of
 * its own data.
 *
 * Why correction lives here at all: the capture mechanism is the clock, not typing. Self-entry
 * is the repair tool. Without it the only person who can fix a wrong hour is the office, on a
 * Sunday, reconstructing a week they were not present for — the worst available reconstruction
 * surface, and a record the worker never got to challenge.
 */

import { useState, type ReactNode } from "react";
import { todayISO, addDaysISO } from "@/lib/clock";
import { api } from "@/lib/trpc/client";
import { useMe } from "@/features/identity/hooks";
import { myHoursListInput, MY_HOURS_STALE_MS } from "@/features/field/my-hours-input";
import { shouldShowFirstRun, shouldShowLoadFailed, isFirstLoad } from "@/lib/first-run";
import { ListLoading } from "@/components/shared/list-loading";
import { LoadFailed } from "@/components/shared/load-failed";
import { FirstRunEmptyState } from "@/components/shared/first-run-empty-state";
import { Button } from "@/components/ui/button";
import { MINUTES_PER_HOUR } from "@/lib/time";
import {
  weekStart,
  weekDates,
  weekEntries,
  DAYS_PER_WEEK,
  type MyHoursEntry,
} from "@/features/field/my-hours-derive";
import { openEntryOf, suggestEndTime } from "@/features/field/my-hours-edit";
import { HoursSummary } from "@/features/field/hours-summary";
import { HoursWeekNav } from "@/features/field/hours-week-nav";
import { HoursSheet } from "@/features/field/hours-sheet";
import { UnreportedDayCard } from "@/features/field/unreported-day-card";
import { useTimesheetClock } from "@/features/settings/use-timesheet-clock";
import { useOvertimePolicy } from "@/features/settings/use-overtime-policy";
import { useTechEditsTimes } from "@/features/settings/use-tech-edits-times";
import { useWeekSubmission } from "@/features/field/use-week-submission";
import { HoursSubmit } from "@/features/field/hours-submit";
import { weekSummary, type OvertimePolicy } from "@/features/field/hours-sheet-derive";
import { StillOpenBanner } from "@/features/field/my-hours-still-open";
import { AddBlockForm } from "@/features/field/my-hours-add-block";
import { useMyHoursWrites } from "@/features/field/use-my-hours-writes";

type Writes = ReturnType<typeof useMyHoursWrites>;

/** The page identity, kept on every state so the four list states never swap the title out. */
function Screen({ children }: { children: ReactNode }) {
  return (
    <>
      <h1>My hours</h1>
      {children}
    </>
  );
}

/** Shared, so the summary's identity does not change on every render. */
const EMPTY_STANDARD: ReadonlyMap<string, number | null> = new Map();

/** Nothing has ever been recorded for this technician — an invitation to act, not a dead end. */
function NoHoursYet({ onAdd }: { onAdd: (() => void) | null }) {
  // With hand edits off there is nothing to offer, so the screen explains where hours come from and
  // who to ask instead of showing a button whose only outcome is a refusal.
  if (onAdd === null) {
    return (
      <FirstRunEmptyState
        heading="No hours yet"
        subtext="Hours are recorded as you start your day and tap through your jobs. On this account the office keeps timesheet changes — ask them about anything missing."
        paths={[]}
      />
    );
  }
  return (
    <FirstRunEmptyState
      heading="No hours yet"
      subtext="Hours are recorded as you start your day and tap through your jobs. Anything the clock missed — or time planned ahead — you can add here."
      paths={[
        {
          title: "Add hours",
          description: "Pick the day and the times. The office reviews it before it reaches payroll.",
          actionLabel: "Add hours",
          onAction: onAdd,
          variant: "primary",
        },
      ]}
    />
  );
}

interface WeekViewProps {
  readonly entries: readonly MyHoursEntry[];
  readonly today: string;
  readonly myUserId: string | undefined;
  readonly writes: Writes;
  readonly openEntry: MyHoursEntry | null;
  readonly suggestEndFor: (entry: MyHoursEntry) => string | null;
  /** The add-hours BUTTON, which rides in the week pager. Owned by the page because the
   *  first-run screen opens the same form. */
  readonly addButton: ReactNode;
  /** The add-hours FORM, in flow under the pager when it is open — never inside the pager itself,
   *  which is a single flex row. */
  readonly addForm: ReactNode;
  /** Days with visits stamped and no hours submitted — see UnreportedDayCard. */
  readonly unreported: readonly { userId: string; date: string; visits: number; firstStampAt: string | null; lastStampAt: string | null }[];
  readonly onAcceptDay: (date: string, startTime: string, endTime: string) => void;
  readonly onEnterOwn: (date: string) => void;
  readonly overtimePolicy: OvertimePolicy;
  /** Does the org let technicians correct their own hours? Default OFF (#457). */
  readonly canEditOwnTimes: boolean;
}

/** The populated surface. Owns which week is shown and which row is open — nothing else needs it. */
function WeekView({ entries, today, myUserId, writes, openEntry, suggestEndFor, addButton, addForm, unreported, onAcceptDay, onEnterOwn, overtimePolicy, canEditOwnTimes }: WeekViewProps) {
  const [weekStartISO, setWeekStartISO] = useState(() => weekStart(today));
  const [editingId, setEditingId] = useState<string | null>(null);
  /**
   * PAID and OVERTIME come from the shop's own rule, not a compiled-in forty. This page reported
   * five ten-hour days as zero overtime in a daily-overtime state — ten hours the technician is
   * owed, absent from the only screen that tells him what he earned.
   *
   * Paid = regular + overtime: every hour the shop owes, including paid time off, which is paid but
   * never worked and so can never create overtime.
   */
  const summary = weekSummary({
    entries: weekEntries(entries, weekStartISO),
    policy: overtimePolicy,
    // Missing-day naming needs each date's standard length, which is a batched read this page does
    // not make yet; an empty map asks about no day rather than guessing at one. The summary's
    // missing figure comes from `unreported` instead — see below.
    standardMinutesByDate: EMPTY_STANDARD,
    todayISO: today,
  });
  /**
   * The days this week that are missing hours, and the ONE definition of that on this screen: the
   * summary counts exactly the days the cards below call out, because they read this same array.
   * Two definitions of "missing" on one page is how a man ends up not believing either.
   *
   * Evidence-based, not schedule-based: visits stamped with no hours recorded. A shop that never
   * told Mallet who works Saturdays gets no invented accusations.
   */
  const weekMissing = unreported.filter((d) => weekDates(weekStartISO).includes(d.date));

  /**
   * What the week's hours were SPENT ON — the visit taps, for the attribution panel under each
   * shift. ONE read for the whole week, keyed by the week on show, rather than one per expanded row:
   * the taps are already in memory by the time he opens a shift, so the panel does not flash.
   *
   * A separate read from the clock on purpose. `list` answers "what am I paid for" and this answers
   * "which jobs did that go to", and the two do not have to agree — drive time is paid and belongs
   * to no job. Fusing them into one endpoint would invite exactly that reconciliation.
   */
  const stampsQ = api.v1.timesheets.visitStamps.useQuery(
    { fromDate: weekStartISO, toDate: addDaysISO(weekStartISO, DAYS_PER_WEEK - 1) },
    { enabled: Boolean(myUserId), refetchOnWindowFocus: false },
  );
  const stamps = stampsQ.data?.items ?? [];

  /**
   * His own sign-off for the week on show. Submitting LOCKS the week — the server has refused edits
   * to a submitted week since #457 — so the register has to read this before it draws a pencil, or
   * it is offering a correction the server will reject.
   */
  const submission = useWeekSubmission(weekStartISO, Boolean(myUserId) && canEditOwnTimes);
  const weekLocked = submission.submitted;

  return (
    <>
      {openEntry !== null ? (
        <StillOpenBanner
          entry={openEntry}
          suggestedEnd={suggestEndFor(openEntry)}
          saving={writes.saving}
          error={writes.updateError}
          onEnd={(endTime) => writes.endOpenDay(openEntry.id, endTime)}
        />
      ) : null}
      <HoursSummary
        regularHours={summary.regularHours}
        overtimeHours={summary.overtimeHours}
        weeklyThresholdHours={overtimePolicy.weeklyThresholdMinutes / MINUTES_PER_HOUR}
        rulePhrase={summary.rulePhrase}
        missingDays={weekMissing.map((d) => d.date)}
        canEditOwnTimes={canEditOwnTimes}
      />
      <HoursWeekNav
        weekStartISO={weekStartISO}
        thisWeekISO={weekStart(today)}
        onNav={(weeks) => setWeekStartISO((prev) => addDaysISO(prev, weeks * DAYS_PER_WEEK))}
        onThisWeek={() => setWeekStartISO(weekStart(today))}
        actions={
          <>
            {weekLocked ? null : addButton}
            <HoursSubmit
              state={submission}
              canSubmit={canEditOwnTimes}
              empty={weekEntries(entries, weekStartISO).length === 0}
            />
          </>
        }
      />
      {/* The office handed it back and said why. Above the submitted note deliberately: this is the
          only thing on the screen he has to act on, and it names the day so he is not re-reading a
          whole week to find what they meant. */}
      {submission.changesRequested !== null ? (
        <p className="mh-changes" role="status">
          <b>The office sent this week back.</b> {submission.changesRequested}
        </p>
      ) : null}
      {canEditOwnTimes && weekLocked ? (
        <p className="mh-officeonly">
          You submitted this week. The office has it now — ask them if something needs changing.
        </p>
      ) : null}
      {canEditOwnTimes ? null : (
        <p className="mh-officeonly">
          Your shop keeps timesheet changes with the office. Anything that looks wrong here — tell
          them and they will correct it.
        </p>
      )}
      {addForm}
      {/* Above the register, not inside it: a day with NO rows has no row to sit under, and this is
          the one thing on the screen that costs money to ignore. */}
      {weekMissing.map((d) => (
        <UnreportedDayCard
          key={d.date}
          date={d.date}
          visits={d.visits}
          firstStampAt={d.firstStampAt}
          lastStampAt={d.lastStampAt}
          busy={writes.adding}
          canRecord={canEditOwnTimes}
          onAccept={(start, end) => onAcceptDay(d.date, start, end)}
          onEnterOwn={onEnterOwn}
        />
      ))}
      <HoursSheet
        entries={weekEntries(entries, weekStartISO)}
        stamps={stamps}
        canEditOwnTimes={canEditOwnTimes && !weekLocked}
        today={today}
        myUserId={myUserId}
        editingId={editingId}
        saving={writes.saving || writes.removing}
        saveError={writes.updateError ?? writes.removeError}
        suggestEndFor={suggestEndFor}
        onEdit={setEditingId}
        onSave={(entryId, patch) => writes.saveEntry(entryId, patch, () => setEditingId(null))}
        onDelete={(entryId) => writes.removeEntry(entryId, () => setEditingId(null))}
      />
    </>
  );
}

export default function MyHoursPage() {
  const today = todayISO();
  const myUserId = useMe().data?.userId;
  // The shop's own rule, from the field surface's one settings window. Federal weekly-40 while it
  // loads — the same value the column defaults to, so the figure never jumps for a shop that has
  // not set a daily rule.
  const overtimePolicy = useOvertimePolicy();
  /**
   * Most shops keep hand edits OFF (#457, the Housecall Pro model). The server has always refused
   * the write; this is the surface finally asking, so the controls match what is possible.
   */
  const canEditOwnTimes = useTechEditsTimes();

  // Same builder — and therefore the same query key — as the field hydrator's idle prefetch.
  // Scoped to ME: without it an owner-operator is served every technician's rows (the list
  // endpoint only forces scoping on a TECH caller), and My hours showed other people's work.
  // Disabled until `me` resolves rather than firing unscoped once and then correcting itself.
  const query = api.v1.timesheets.list.useQuery(myHoursListInput(myUserId ?? ""), {
    enabled: Boolean(myUserId),
    staleTime: MY_HOURS_STALE_MS,
    refetchOnWindowFocus: false,
  });
  const writes = useMyHoursWrites();
  const [addOpen, setAddOpen] = useState(false);
  const hasClock = useTimesheetClock();

  /**
   * Days he evidently worked and sent nothing in. Its own query rather than derived from the rows
   * above, because the whole point is days that have NO rows — there is nothing here to derive it
   * from. Scoped server-side to the caller (a tech is forced to their own id).
   */
  const unreportedQ = api.v1.timesheets.unreportedDays.useQuery(
    { fromDate: addDaysISO(weekStart(today), -DAYS_PER_WEEK), toDate: addDaysISO(weekStart(today), DAYS_PER_WEEK) },
    { enabled: Boolean(myUserId), refetchOnWindowFocus: false },
  );
  const unreported = unreportedQ.data?.items ?? [];

  /** Accept the suggested window. Written as ONE worked block, exactly as if he had typed it. */
  const acceptDay = (date: string, startTime: string, endTime: string): void => {
    if (!myUserId) return;
    writes.addBlock(
      { techUserId: myUserId, workDate: date, kind: "shop", startTime, endTime, note: "" },
      () => void unreportedQ.refetch(),
    );
  };

  const entries = query.data?.items ?? [];
  const listState = { isFetched: query.isFetched, isError: query.isError, count: entries.length };
  const suggestEndFor = (entry: MyHoursEntry): string | null =>
    suggestEndTime(entries.filter((e) => e.techUserId === entry.techUserId), entry);

  const addBlock = (
    <AddBlockForm
      today={today}
      techUserId={myUserId}
      saving={writes.adding}
      error={writes.createError}
      onAdd={writes.addBlock}
      onCancel={() => setAddOpen(false)}
    />
  );

  if (isFirstLoad(listState)) {
    return (
      <Screen>
        <ListLoading label="Loading your hours…" />
      </Screen>
    );
  }

  if (shouldShowLoadFailed(listState)) {
    return (
      <Screen>
        <LoadFailed noun="hours" onRetry={() => void query.refetch()} retrying={query.isRefetching} />
      </Screen>
    );
  }

  if (shouldShowFirstRun(listState)) {
    return (
      <Screen>
        <NoHoursYet onAdd={canEditOwnTimes ? () => setAddOpen(true) : null} />
        {addOpen && canEditOwnTimes ? addBlock : null}
      </Screen>
    );
  }

  return (
    <Screen>
      <WeekView
        entries={entries}
        today={today}
        myUserId={myUserId}
        writes={writes}
        openEntry={openEntryOf(entries, myUserId, new Date())}
        suggestEndFor={suggestEndFor}
        unreported={unreported}
        onAcceptDay={acceptDay}
        onEnterOwn={() => setAddOpen(true)}
        overtimePolicy={overtimePolicy}
        canEditOwnTimes={canEditOwnTimes}
        addButton={
          /* In the week pager, not at the foot of the page: in a SHEET shop this is not a
             correction path, it is the only way hours ever get recorded, so it belongs beside the
             week it writes into. It says what it does rather than apologising for being after the
             fact. Hidden while the form is open — the form IS the control then, and hidden entirely
             when the shop keeps changes with the office, because the server would refuse the write. */
          addOpen || !canEditOwnTimes ? null : (
            <Button variant={hasClock ? "quiet" : "primary"} onClick={() => setAddOpen(true)}>
              {hasClock ? "Add hours" : "Add a day"}
            </Button>
          )
        }
        addForm={addOpen && canEditOwnTimes ? addBlock : null}
      />
    </Screen>
  );
}
