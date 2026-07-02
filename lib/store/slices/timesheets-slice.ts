/**
 * lib/store/slices/timesheets-slice.ts
 * Timesheet entries (payroll punches) + mutations. Immutable updates only.
 * Seeded empty — the sample logs no time, so the empty state is faithful
 * (crew clock in from My day). Approved entries are locked: update/delete are
 * no-ops once approved. Mirrors the prototype's tsAddEntry / tsSetField /
 * tsDelEntry / tsApproveTech actions.
 */

import type { StateCreator } from "zustand";
import type { TimeEntry } from "../types";

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
  timeEntries: [],

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
