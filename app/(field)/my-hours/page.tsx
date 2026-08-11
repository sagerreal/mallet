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
import {
  weekStart,
  weekDates,
  weekEntries,
  rollup,
  shortDayLabel,
  DAYS_PER_WEEK,
  HOURS_PRECISION,
  type MyHoursEntry,
} from "@/features/field/my-hours-derive";
import { openEntryOf, suggestEndTime } from "@/features/field/my-hours-edit";
import { MyHoursWeek } from "@/features/field/my-hours-entries";
import { UnreportedDayCard } from "@/features/field/unreported-day-card";
import { useTimesheetClock } from "@/features/settings/use-timesheet-clock";
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

interface WeekNavProps {
  readonly weekStartISO: string;
  readonly thisWeekISO: string;
  readonly paid: number;
  readonly overtime: number;
  readonly onNav: (weeks: number) => void;
  readonly onThisWeek: () => void;
}

function WeekNav({ weekStartISO, thisWeekISO, paid, overtime, onNav, onThisWeek }: WeekNavProps) {
  return (
    <div className="mh-nav">
      <Button variant="quiet" size="sm" onClick={() => onNav(-1)} aria-label="Previous week">
        ‹ Prev
      </Button>
      <b>
        {shortDayLabel(weekStartISO)} – {shortDayLabel(addDaysISO(weekStartISO, DAYS_PER_WEEK - 1))}
      </b>
      <Button variant="quiet" size="sm" onClick={() => onNav(1)} aria-label="Next week">
        Next ›
      </Button>
      {weekStartISO !== thisWeekISO ? (
        <Button variant="quiet" size="sm" onClick={onThisWeek}>
          This week
        </Button>
      ) : null}
      <span className="mh-total">
        {paid.toFixed(HOURS_PRECISION)} paid h
        {overtime > 0 ? ` · ${overtime.toFixed(HOURS_PRECISION)} OT` : ""}
      </span>
    </div>
  );
}

/** Nothing has ever been recorded for this technician — an invitation to act, not a dead end. */
function NoHoursYet({ onAdd }: { onAdd: () => void }) {
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
  /** The add-a-block affordance, owned by the page because the first-run screen opens it too. */
  readonly addSlot: ReactNode;
  /** Days with visits stamped and no hours submitted — see UnreportedDayCard. */
  readonly unreported: readonly { userId: string; date: string; visits: number; firstAt: string | null; lastAt: string | null }[];
  readonly onAcceptDay: (date: string, startTime: string, endTime: string) => void;
  readonly onEnterOwn: (date: string) => void;
}

/** The populated surface. Owns which week is shown and which row is open — nothing else needs it. */
function WeekView({ entries, today, myUserId, writes, openEntry, suggestEndFor, addSlot, unreported, onAcceptDay, onEnterOwn }: WeekViewProps) {
  const [weekStartISO, setWeekStartISO] = useState(() => weekStart(today));
  const [editingId, setEditingId] = useState<string | null>(null);
  const week = rollup(entries, weekStartISO);

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
      <WeekNav
        weekStartISO={weekStartISO}
        thisWeekISO={weekStart(today)}
        paid={week.paid}
        overtime={week.overtime}
        onNav={(weeks) => setWeekStartISO((prev) => addDaysISO(prev, weeks * DAYS_PER_WEEK))}
        onThisWeek={() => setWeekStartISO(weekStart(today))}
      />
      {/* Above the week, not inside it: a day with NO rows has no group to sit under, and this is
          the one thing on the screen that costs money to ignore. Scoped to the week on show, so
          navigating away from it does not carry somebody else's Wednesday along. */}
      {unreported
        .filter((d) => weekDates(weekStartISO).includes(d.date))
        .map((d) => (
          <UnreportedDayCard
            key={d.date}
            date={d.date}
            visits={d.visits}
            firstAt={d.firstAt}
            lastAt={d.lastAt}
            busy={writes.adding}
            onAccept={(start, end) => onAcceptDay(d.date, start, end)}
            onEnterOwn={onEnterOwn}
          />
        ))}
      <MyHoursWeek
        entries={weekEntries(entries, weekStartISO)}
        weekStartISO={weekStartISO}
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
      {addSlot}
    </>
  );
}

export default function MyHoursPage() {
  const today = todayISO();
  const myUserId = useMe().data?.userId;

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
        <NoHoursYet onAdd={() => setAddOpen(true)} />
        {addOpen ? addBlock : null}
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
        addSlot={
          addOpen ? (
            addBlock
          ) : (
            <div className="mh-acts">
              {/* In a SHEET shop this is not a correction path, it is the only way hours ever get
                  recorded — so it leads rather than sits quietly at the bottom, and it says what
                  it does rather than apologising for being after the fact. */}
              <Button variant={hasClock ? "quiet" : "primary"} onClick={() => setAddOpen(true)}>
                {hasClock ? "Add hours" : "Add a day"}
              </Button>
            </div>
          )
        }
      />
    </Screen>
  );
}
