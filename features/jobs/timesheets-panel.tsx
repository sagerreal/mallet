"use client";

/**
 * features/jobs/timesheets-panel.tsx
 * The Timesheets tab — owns the week + selection + edit UI state and wires the
 * store. The week toolbar is inline; the crew chips and the selected crew's
 * week card are presentational leaves (timesheets-crew), the row UI another
 * (timesheets-entries), and all math/labels live in timesheet-derive.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { todayISO } from "@/lib/clock";
import { useAppStore } from "@/lib/store/app-store";
import { api } from "@/lib/trpc/client";
import { useTimesheetsWeek } from "@/features/timesheets/use-timesheets-week";
import { shouldShowFirstRun, isFirstLoad, shouldShowLoadFailed } from "@/lib/first-run";
import { FirstRunEmptyState } from "@/components/shared/first-run-empty-state";
import type { TimeEntry } from "@/lib/store/types";
import { techById } from "./jobs-helpers";
import {
  tsAddDays,
  tsWeekStart,
  tsWeekDates,
  tsMoney,
  tsRollup,
  tsWeekEntries,
} from "./timesheet-derive";
import { type TsPick } from "./timesheets-entries";
import { TsCrewChips, TsTechWeekCard } from "./timesheets-crew";
import { JobCostingView } from "./job-costing-view";
import { TimesheetExceptions } from "./timesheet-exceptions";
import { LoadFailed } from "@/components/shared/load-failed";
import { ListLoading } from "@/components/shared/list-loading";

// Fields the office is allowed to edit (mirrors prototype tsSetField whitelist).
// crew reassignment not supported here — techId is intentionally excluded.
const TS_EDITABLE: ReadonlySet<string> = new Set(["kind", "jobId", "date", "start", "end", "note"]);

// First-run empty-state copy. Timesheets are DOWNSTREAM — hours only exist once field crew clock
// into jobs (or the office adds one by hand). Shown when there are no time entries at all.
//
// It says something DIFFERENT depending on whether a crew exists, because there are two genuinely
// different situations behind "no hours" and only one of them is about setting up a crew. Telling a
// shop with two field crew to "set up your crew" reads as software that does not know its own state,
// and it puts an already-finished step in front of the one thing they can actually do.
const FIRST_RUN = {
  heading: "No hours logged yet",
  /** Nobody is marked field crew yet — hours have nobody to belong to. */
  noCrew: {
    subtext: "Hours show up here once your field crew clock into jobs. Mark someone field crew to get started.",
    crew: {
      title: "Add field crew",
      description: "Invite a team member and mark them field crew — their hours land here.",
      actionLabel: "Set up crew",
    },
  },
  /** A crew exists; they simply have not clocked in yet. The real next action is a manual entry. */
  hasCrew: {
    subtext: "Your crew's hours land here as soon as they start a job on their phone. You can also log time yourself.",
    entry: {
      title: "Add an entry by hand",
      description: "Log time for a crew member yourself — then edit the hours and job right in the grid.",
      actionLabel: "+ Add entry",
    },
  },
} as const;

export function TimesheetsPanel() {
  const router = useRouter();
  const techs = useAppStore((s) => s.techs);
  const jobs = useAppStore((s) => s.jobs);
  const leads = useAppStore((s) => s.leads);
  const timeEntries = useAppStore((s) => s.timeEntries);
  const addTimeEntry = useAppStore((s) => s.addTimeEntry);
  const updateTimeEntry = useAppStore((s) => s.updateTimeEntry);
  const deleteTimeEntry = useAppStore((s) => s.deleteTimeEntry);
  const approveTechWeek = useAppStore((s) => s.approveTechWeek);
  const reopenEntry = useAppStore((s) => s.reopenEntry);

  // Week nav — local weekStart state, normalized to the Monday of today's week.
  const today = todayISO();
  const [weekStart, setWeekStart] = useState<string>(() => tsWeekStart(today));
  /**
   * Which reading of the week is on screen. TWO LEDGERS, and this tab is the guardrail between
   * them: Timesheet changes what people are PAID and syncs to QuickBooks; Job costing changes a
   * REPORT. Keeping them on one screen behind a tab is what stops an approver thinking a costing
   * edit moved somebody's pay.
   */
  const [ledger, setLedger] = useState<"timesheet" | "costing">("timesheet");
  // Loads the week ON SCREEN into the store, which the grid below reads. Previously a hydrator
  // fetched a flat, unscoped page of the newest 500 entries and this panel filtered it down — so
  // any week older than that window rendered empty, indistinguishable from "nobody logged hours".
  const week = useTimesheetsWeek({ weekStart });

  /**
   * Days somebody worked and sent no hours for. Its own query, not derived from the rows below:
   * the whole point is days that have NO rows, so there is nothing here to derive it from.
   */
  const exceptionsQ = api.v1.timesheets.unreportedDays.useQuery(
    { fromDate: weekStart, toDate: tsAddDays(weekStart, 6) },
    { refetchOnWindowFocus: false },
  );
  const exceptions = exceptionsQ.data?.items ?? [];
  const toFix = exceptions.reduce<Record<string, number>>((acc, x) => {
    acc[x.userId] = (acc[x.userId] ?? 0) + 1;
    return acc;
  }, {});
  const [selectedTechId, setSelectedTechId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [pick, setPick] = useState<TsPick>(null);
  const [crewQ, setCrewQ] = useState("");
  // The days the server refused to approve over. Cleared whenever the view moves, so a stale
  // refusal can never sit above a week it doesn't describe.
  const [unfinishedDays, setUnfinishedDays] = useState<readonly string[] | null>(null);

  const weekDates = tsWeekDates(weekStart);
  const wkEnd = tsAddDays(weekStart, 6);
  const thisWeek = tsWeekStart(today);
  const dl = (iso: string) =>
    new Date(iso + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const totals = techs.map((t) => tsRollup(timeEntries, t.id, weekDates));
  const anyEntries = totals.some((r) => r.count > 0);
  const totPaid = tsMoney(totals.reduce((s, r) => s + r.paid, 0));
  const totOt = tsMoney(totals.reduce((s, r) => s + r.ot, 0));

  // Selected tech: sticky choice if it still has a chip, else first-with-entries or first crew.
  const selId =
    selectedTechId != null && techs.some((t) => t.id === selectedTechId)
      ? selectedTechId
      : (techs.find((t, i) => (totals[i]?.count ?? 0) > 0) ?? techs[0])?.id ?? null;

  function weekNav(delta: number) {
    setWeekStart((w) => tsWeekStart(tsAddDays(w, delta * 7)));
    clearRowState();
  }

  function clearRowState() {
    setEditId(null);
    setPick(null);
    setUnfinishedDays(null);
  }

  function handleSelect(id: string) {
    setSelectedTechId(id);
    clearRowState();
  }

  function handleEdit(id: string) {
    // A running entry IS editable here — it is the only place a forgotten clock-out can be fixed.
    const e = timeEntries.find((x) => x.id === id);
    if (!e || e.status === "approved") return;
    setEditId((cur) => (cur === id ? null : id));
    setPick(null);
  }

  // Stop opens the row's out-time picker rather than stamping a time: nobody knows when the
  // technician actually finished except the shop, and inventing hours is what this refuses to do.
  function handleStop(id: string) {
    const e = timeEntries.find((x) => x.id === id);
    if (!e || e.status === "approved") return;
    setEditId(id);
    setPick("end");
  }

  function handleCloseEdit() {
    setEditId(null);
    setPick(null);
  }

  function handleSetField(id: string, field: keyof TimeEntry, val: string | number) {
    if (!TS_EDITABLE.has(String(field))) return;
    const e = timeEntries.find((x) => x.id === id);
    if (!e || e.status === "approved") return;
    if (field === "jobId") {
      // jobId is string | null — pass through directly (empty string → null).
      const strVal = val === "" || val == null ? null : String(val);
      updateTimeEntry(id, { jobId: strVal });
      return;
    }
    if (field === "end") {
      // An out time finishes the entry, so the clock must stop with it. Leaving `running` set would
      // show a complete span the week still can't be approved on — and QuickBooks would reject it.
      updateTimeEntry(id, { end: String(val), running: false });
      return;
    }
    updateTimeEntry(id, { [field]: val } as Partial<TimeEntry>);
  }

  async function handleApprove(techId: string) {
    const outcome = await approveTechWeek(techId, weekDates);
    setUnfinishedDays(outcome.status === "unfinished" ? outcome.days : null);
  }

  function handleAdd(techId: string) {
    // Anchor a fresh draft on today if today is in view, else the week's Monday. That anchor is a
    // guess, so the editor opens straight away with the day picker in it — otherwise the new row
    // sits collapsed on a day nobody chose and the next step is not obvious.
    const day = weekDates.includes(today) ? today : weekStart;
    const created = addTimeEntry(techId, day);
    setSelectedTechId(techId);
    setEditId(created.id);
  }

  // Reopen: un-approve every approved entry this week for the given tech.
  function handleReopen(entries: TimeEntry[]) {
    entries.forEach((e) => {
      if (e.status === "approved") reopenEntry(e.id);
    });
  }

  const selTech = selId != null ? techById(techs, selId) : undefined;

  // No-flash first-run gate on the ALL-TIME entry count, counted in the database — NOT on the rows
  // loaded for the week. A shop that took last week off has hours; offering it the set-up screen
  // would read as data loss. Full early return — the grid below is untouched.
  const gate = { isFetched: week.isFetched, isError: week.isError, count: week.everCount ?? 0 };
  const firstRun = shouldShowFirstRun(gate);
  const loadFailed = shouldShowLoadFailed(gate);
  const loading = isFirstLoad(gate);

  if (loadFailed) {
    return <LoadFailed noun="hours" onRetry={week.refetch} retrying={week.isRefetching} />;
  }
  if (loading) {
    return <ListLoading />;
  }
  // Field crew only — the techs slice is already filtered to isFieldCrew (techs-hydrator).
  const hasCrew = techs.length > 0;
  if (firstRun) {
    return (
      <>
        <h1>Timesheets</h1>
        <FirstRunEmptyState
          heading={FIRST_RUN.heading}
          subtext={hasCrew ? FIRST_RUN.hasCrew.subtext : FIRST_RUN.noCrew.subtext}
          paths={
            hasCrew
              ? // A crew already exists, so the only thing left to do here is log time. Offering
                // "Set up crew" as the primary action would hand them a step they have finished.
                [
                  {
                    ...FIRST_RUN.hasCrew.entry,
                    onAction: () => handleAdd(techs[0]!.id),
                    variant: "primary" as const,
                  },
                ]
              : // No crew: a manual entry has nobody to belong to, so it is not offered at all.
                [
                  {
                    ...FIRST_RUN.noCrew.crew,
                    onAction: () => router.push("/settings?tab=team"),
                    variant: "primary" as const,
                  },
                ]
          }
        />
      </>
    );
  }

  return (
    <>
      <h1>Timesheets</h1>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", margin: "var(--space-3) 0", flexWrap: "wrap" }}>
        <button className="btn sm" onClick={() => weekNav(-1)}>
          ‹ Prev
        </button>
        <b style={{ fontWeight: 700 }}>
          {dl(weekStart)} – {dl(wkEnd)}
        </b>
        <button className="btn sm" onClick={() => weekNav(1)}>
          Next ›
        </button>
        {weekStart !== thisWeek && (
          <button
            className="btn sm ghost"
            onClick={() => {
              setWeekStart(thisWeek);
              setEditId(null);
              setPick(null);
            }}
          >
            This week
          </button>
        )}
        {anyEntries && (
          <>
            <span style={{ flex: 1 }} />
            <span className="muted" style={{ fontSize: "var(--type-sm)", fontVariantNumeric: "tabular-nums" }}>
              {totPaid.toFixed(2)} paid h{totOt ? ` · ${totOt.toFixed(2)} OT` : ""}
            </span>
          </>
        )}
      </div>

      <div className="otabs" role="tablist" aria-label="Timesheets view">
        <button
          id="ts-tab-timesheet"
          className={ledger === "timesheet" ? "otab on" : "otab"}
          role="tab"
          type="button"
          aria-selected={ledger === "timesheet"}
          aria-controls="ts-panel-timesheet"
          onClick={() => setLedger("timesheet")}
        >
          Timesheet
        </button>
        <button
          id="ts-tab-costing"
          className={ledger === "costing" ? "otab on" : "otab"}
          role="tab"
          type="button"
          aria-selected={ledger === "costing"}
          aria-controls="ts-panel-costing"
          onClick={() => setLedger("costing")}
        >
          Job costing
        </button>
      </div>

      {ledger === "costing" ? (
        <div id="ts-panel-costing" role="tabpanel" aria-labelledby="ts-tab-costing">
          <JobCostingView weekStart={weekStart} weekEnd={wkEnd} paidHours={totPaid} />
        </div>
      ) : (
      <div id="ts-panel-timesheet" role="tabpanel" aria-labelledby="ts-tab-timesheet">
      <TimesheetExceptions
        items={exceptions}
        nameOf={(id) => techById(techs, id)?.name ?? "Crew"}
        onReview={(id) => handleSelect(id)}
      />

      <TsCrewChips
        techs={techs}
        totals={totals}
        selId={selId}
        crewQ={crewQ}
        onCrewQ={setCrewQ}
        onSelect={handleSelect}
        toFix={toFix}
      />

      {selTech &&
        (() => {
          const rollup = tsRollup(timeEntries, selTech.id, weekDates);
          const es = tsWeekEntries(timeEntries, selTech.id, weekDates);
          return (
            <TsTechWeekCard
              tech={selTech}
              rollup={rollup}
              entries={es}
              jobs={jobs}
              leads={leads}
              techs={techs}
              weekDates={weekDates}
              editId={editId}
              pick={pick}
              onSetPick={setPick}
              onEdit={handleEdit}
              onStop={handleStop}
              onDelete={deleteTimeEntry}
              onSetField={handleSetField}
              onCloseEdit={handleCloseEdit}
              onAddEntry={() => handleAdd(selTech.id)}
              onApprove={() => void handleApprove(selTech.id)}
              onReopen={() => handleReopen(es)}
              unfinishedDays={unfinishedDays}
            />
          );
        })()}
      </div>
      )}
    </>
  );
}
