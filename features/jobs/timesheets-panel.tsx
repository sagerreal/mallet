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
import { HYDRATOR_PAGE_LIMIT, HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import { shouldShowFirstRun, shouldShowLoadFailed } from "@/lib/first-run";
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
import { LoadFailed } from "@/components/shared/load-failed";

// Fields the office is allowed to edit (mirrors prototype tsSetField whitelist).
// crew reassignment not supported here — techId is intentionally excluded.
const TS_EDITABLE: ReadonlySet<string> = new Set(["kind", "jobId", "date", "start", "end", "note"]);

// First-run empty-state copy. Timesheets are DOWNSTREAM — hours only exist once field crew clock
// into jobs (or the office adds one by hand). Shown when there are no time entries at all.
const FIRST_RUN = {
  heading: "No hours logged yet",
  subtext: "Hours show up here once your field crew clock into jobs. Set up your crew, or add an entry by hand.",
  crew: {
    title: "Add field crew",
    description: "Invite a team member and mark them field crew — their hours land here.",
    actionLabel: "Set up crew",
  },
  entry: {
    title: "Add an entry by hand",
    description: "Log time for a crew member yourself — edit the hours and job right in the grid.",
    actionLabel: "+ Add entry",
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
  const [selectedTechId, setSelectedTechId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [pick, setPick] = useState<TsPick>(null);
  const [crewQ, setCrewQ] = useState("");

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
    setEditId(null);
    setPick(null);
  }

  function handleSelect(id: string) {
    setSelectedTechId(id);
    setEditId(null);
    setPick(null);
  }

  function handleEdit(id: string) {
    const e = timeEntries.find((x) => x.id === id);
    if (!e || e.status === "approved" || e.running) return;
    setEditId((cur) => (cur === id ? null : id));
    setPick(null);
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
    updateTimeEntry(id, { [field]: val } as Partial<TimeEntry>);
  }

  function handleAdd(techId: string) {
    // Anchor a fresh draft on today if today is in view, else the week's Monday.
    const day = weekDates.includes(today) ? today : weekStart;
    addTimeEntry(techId, day);
    setSelectedTechId(techId);
  }

  // Reopen: un-approve every approved entry this week for the given tech.
  function handleReopen(entries: TimeEntry[]) {
    entries.forEach((e) => {
      if (e.status === "approved") reopenEntry(e.id);
    });
  }

  const selTech = selId != null ? techById(techs, selId) : undefined;

  // No-flash first-run gate on the TOTAL time-entry count (not the week-scoped `anyEntries`).
  // Dedupes the TimesheetsHydrator query (same key → no extra fetch). Full early return — the grid
  // below is untouched.
  const tsQuery = api.v1.timesheets.list.useQuery(
    { limit: HYDRATOR_PAGE_LIMIT },
    { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false },
  );
  const firstRun = shouldShowFirstRun({ isFetched: tsQuery.isFetched, isError: tsQuery.isError, count: timeEntries.length });
  const loadFailed = shouldShowLoadFailed({ isFetched: tsQuery.isFetched, isError: tsQuery.isError, count: timeEntries.length });

  if (loadFailed) {
    return <LoadFailed noun="hours" onRetry={() => void tsQuery.refetch()} retrying={tsQuery.isRefetching} />;
  }
  if (firstRun) {
    return (
      <>
        <h1>Timesheets</h1>
        <FirstRunEmptyState
          heading={FIRST_RUN.heading}
          subtext={FIRST_RUN.subtext}
          paths={[
            { ...FIRST_RUN.crew, onAction: () => router.push("/settings?tab=team"), variant: "primary" },
            // Only offer a manual entry once there's a crew member to attribute it to (no dead button).
            ...(techs.length > 0 ? [{ ...FIRST_RUN.entry, onAction: () => handleAdd(techs[0]!.id) }] : []),
          ]}
        />
      </>
    );
  }

  return (
    <>
      <h1>Timesheets</h1>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0", flexWrap: "wrap" }}>
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
            <span className="muted" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
              {totPaid.toFixed(2)} paid h{totOt ? ` · ${totOt.toFixed(2)} OT` : ""}
            </span>
          </>
        )}
      </div>

      <TsCrewChips
        techs={techs}
        totals={totals}
        selId={selId}
        crewQ={crewQ}
        onCrewQ={setCrewQ}
        onSelect={handleSelect}
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
              onDelete={deleteTimeEntry}
              onSetField={handleSetField}
              onCloseEdit={handleCloseEdit}
              onAddEntry={() => handleAdd(selTech.id)}
              onApprove={() => approveTechWeek(selTech.id, weekDates)}
              onReopen={() => handleReopen(es)}
            />
          );
        })()}
    </>
  );
}
