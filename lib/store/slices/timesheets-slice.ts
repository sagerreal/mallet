/**
 * lib/store/slices/timesheets-slice.ts
 * Timesheet entries (payroll punches) + mutations. Immutable updates only.
 * Seeded from the prototype's SAMPLE_TIME_ENTRIES (the denormalized jobTitle is
 * dropped — the store resolves the label from jobId). Approved entries are
 * locked: update/delete are no-ops once approved. Mirrors the prototype's
 * tsAddEntry / tsSetField / tsDelEntry / tsApproveTech actions.
 */

import type { StateCreator } from "zustand";
import { SAMPLE_TIME_ENTRIES } from "@/lib/prototype-sample";
import type { TimeEntry } from "../types";

// Sample entries carry a denormalized jobTitle for the prototype's inline port;
// the store keeps only the normalized shape and resolves the label from jobId.
const SEED_TIME_ENTRIES: TimeEntry[] = SAMPLE_TIME_ENTRIES.map(
  ({ jobTitle: _jobTitle, ...e }) => ({ ...e })
);

// Fresh id counter for entries created in-session (mirrors state.nextId growth).
let _nextEntryId = 7000;

export interface TimesheetsSlice {
  timeEntries: TimeEntry[];
  addTimeEntry: (techId: number, date: string) => TimeEntry;
  updateTimeEntry: (id: number, patch: Partial<TimeEntry>) => void;
  deleteTimeEntry: (id: number) => void;
  approveTechWeek: (techId: number, weekDates: string[]) => void;
}

export const createTimesheetsSlice: StateCreator<TimesheetsSlice, [], [], TimesheetsSlice> = (set) => ({
  timeEntries: SEED_TIME_ENTRIES,

  addTimeEntry: (techId, date) => {
    const entry: TimeEntry = {
      id: ++_nextEntryId,
      techId,
      date,
      kind: "job",
      jobId: null,
      start: "13:00",
      end: "15:00",
      note: "",
      src: "manual",
      status: "draft",
    };
    set((s) => ({ timeEntries: [entry, ...s.timeEntries] }));
    return entry;
  },

  updateTimeEntry: (id, patch) =>
    set((s) => ({
      timeEntries: s.timeEntries.map((e) =>
        e.id === id && e.status !== "approved" ? { ...e, ...patch } : e
      ),
    })),

  deleteTimeEntry: (id) =>
    set((s) => ({
      timeEntries: s.timeEntries.filter((e) => !(e.id === id && e.status !== "approved")),
    })),

  approveTechWeek: (techId, weekDates) =>
    set((s) => ({
      timeEntries: s.timeEntries.map((e) =>
        e.techId === techId && !e.running && e.status !== "approved" && weekDates.includes(e.date)
          ? { ...e, status: "approved", approvedAt: Date.now() }
          : e
      ),
    })),
});
