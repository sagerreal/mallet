/**
 * lib/store/slices/timesheets-slice.ts
 * Timesheet entries (payroll punches) + mutations. Immutable updates only.
 * Seeded from the backend via TimesheetsHydrator (no sample data).
 * Approved entries are locked: update/delete are no-ops once approved.
 * Mirrors the prototype's tsAddEntry / tsSetField / tsDelEntry / tsApproveTech actions.
 *
 * All write actions are OPTIMISTIC + PERSIST + RECONCILE:
 *   1. Apply local change immediately so the UI is instant.
 *   2. Fire the matching v1.timesheets mutation via trpcVanilla.
 *   3. On success, reconcile the returned TimeEntryDTO (or keep optimistic for approveWeek).
 *   4. On error, ROLL BACK to the pre-mutation snapshot and log (dev only).
 */

import type { StateCreator } from "zustand";
import type { TimeEntry } from "../types";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { dtoToTimeEntry } from "@/lib/store/dto-mapper";
import { reportWriteError } from "../write-error";
import { TS_DEFAULT_START, TS_DEFAULT_END } from "@/features/jobs/timesheet-constants";

export interface TimesheetsSlice {
  timeEntries: TimeEntry[];
  setTimeEntries: (entries: TimeEntry[]) => void;
  addTimeEntry: (techId: string, date: string) => TimeEntry;
  updateTimeEntry: (id: string, patch: Partial<TimeEntry>) => void;
  deleteTimeEntry: (id: string) => void;
  approveTechWeek: (techId: string, weekDates: string[]) => void;
  /** Management-only: un-approve an approved entry (ownerOrOffice). Bypasses the approved-entry guard. */
  reopenEntry: (id: string) => void;
}

export const createTimesheetsSlice: StateCreator<TimesheetsSlice, [], [], TimesheetsSlice> = (set, get) => ({
  timeEntries: [],

  setTimeEntries: (entries) => set({ timeEntries: entries }),

  addTimeEntry: (techId, date) => {
    const id = crypto.randomUUID();
    // A recorded entry is always COMPLETE — start and end both set.
    //
    // This used to branch on "is `date` today?" and produce an open-ended running timer instead.
    // That was a dead end from two directions: the row editor refuses to open for a running entry
    // (see handleEdit), so the hours could never be filled in; and an entry with no end can't be
    // totalled, can't be approved, and is rejected by the QuickBooks push. Intent belongs to the
    // caller, not to the calendar — and the only caller is the office grid, which records work that
    // already happened.
    const entry: TimeEntry = {
      id,
      techId,
      date,
      kind: "job",
      jobId: null,
      start: TS_DEFAULT_START,
      end: TS_DEFAULT_END,
      note: "",
      src: "manual",
      status: "draft",
      running: false,
    };

    // 1. Optimistic update.
    set((s) => ({ timeEntries: [entry, ...s.timeEntries] }));

    // 2. Persist.
    trpcVanilla.v1.timesheets.create
      .mutate({
        id,
        techUserId: techId,
        workDate: date,
        kind: entry.kind as "job" | "travel" | "break" | "shop",
        startTime: entry.start,
        endTime: entry.end ?? undefined,
        note: entry.note,
        src: entry.src as "manual" | "clock" | "timer",
        running: entry.running ?? false,
      })
      .then((dto) => {
        // 3. Reconcile.
        set((s) => ({
          timeEntries: s.timeEntries.map((e) => (e.id === id ? dtoToTimeEntry(dto) : e)),
        }));
      })
      .catch((err: unknown) => {
        // 4. Rollback.
        set((s) => ({ timeEntries: s.timeEntries.filter((e) => e.id !== id) }));
        reportWriteError("addTimeEntry", err);
      });

    return entry;
  },

  updateTimeEntry: (id, patch) => {
    const prior = get().timeEntries.find((e) => e.id === id);

    // 1. Optimistic update (skip approved entries).
    set((s) => ({
      timeEntries: s.timeEntries.map((e) =>
        e.id === id && e.status !== "approved" ? { ...e, ...patch } : e
      ),
    }));

    if (!prior || prior.status === "approved") return;

    // Map store patch fields → mutation input field names.
    const mutationInput: Parameters<typeof trpcVanilla.v1.timesheets.update.mutate>[0] = {
      entryId: id,
    };
    if ("date" in patch) mutationInput.workDate = patch.date;
    if ("start" in patch && patch.start !== undefined) mutationInput.startTime = patch.start;
    if ("end" in patch) mutationInput.endTime = patch.end ?? null;
    if ("kind" in patch && patch.kind !== undefined) {
      mutationInput.kind = patch.kind as "job" | "travel" | "break" | "shop";
    }
    if ("jobId" in patch) mutationInput.jobId = patch.jobId ?? null;
    if ("note" in patch && patch.note !== undefined) mutationInput.note = patch.note;
    if ("src" in patch && patch.src !== undefined) {
      mutationInput.src = patch.src as "manual" | "clock" | "timer";
    }
    if ("running" in patch) mutationInput.running = patch.running;

    // 2. Persist.
    trpcVanilla.v1.timesheets.update
      .mutate(mutationInput)
      .then((dto) => {
        // 3. Reconcile.
        set((s) => ({
          timeEntries: s.timeEntries.map((e) => (e.id === id ? dtoToTimeEntry(dto) : e)),
        }));
      })
      .catch((err: unknown) => {
        // 4. Rollback.
        set((s) => ({
          timeEntries: s.timeEntries.map((e) => (e.id === id && prior ? prior : e)),
        }));
        reportWriteError("updateTimeEntry", err);
      });
  },

  deleteTimeEntry: (id) => {
    const prior = get().timeEntries.find((e) => e.id === id);

    // 1. Optimistic update (skip approved entries).
    set((s) => ({
      timeEntries: s.timeEntries.filter((e) => !(e.id === id && e.status !== "approved")),
    }));

    if (!prior || prior.status === "approved") return;

    // 2. Persist.
    trpcVanilla.v1.timesheets.remove
      .mutate({ entryId: id })
      .catch((err: unknown) => {
        // 3. Rollback — re-insert the removed entry.
        set((s) => ({ timeEntries: [prior, ...s.timeEntries] }));
        reportWriteError("deleteTimeEntry", err);
      });
  },

  approveTechWeek: (techId, weekDates) => {
    const prior = get().timeEntries.slice();

    // 1. Optimistic update.
    set((s) => ({
      timeEntries: s.timeEntries.map((e) =>
        e.techId === techId && !e.running && e.status !== "approved" && weekDates.includes(e.date)
          ? { ...e, status: "approved", approvedAt: Date.now() }
          : e
      ),
    }));

    // 2. Persist.
    trpcVanilla.v1.timesheets.approveWeek
      .mutate({ techUserId: techId, dates: weekDates })
      .catch((err: unknown) => {
        // 3. Rollback on error.
        set({ timeEntries: prior });
        reportWriteError("approveTechWeek", err);
      });
  },

  reopenEntry: (id) => {
    const prior = get().timeEntries.find((e) => e.id === id);

    // 1. Optimistic update — bypasses the approved-entry guard (reopen is the inverse op).
    set((s) => ({
      timeEntries: s.timeEntries.map((e) =>
        e.id === id ? { ...e, status: "draft", approvedAt: undefined } : e
      ),
    }));

    // 2. Persist.
    trpcVanilla.v1.timesheets.reopen
      .mutate({ entryId: id })
      .then((dto) => {
        // 3. Reconcile with server-returned DTO.
        set((s) => ({
          timeEntries: s.timeEntries.map((e) => (e.id === id ? dtoToTimeEntry(dto) : e)),
        }));
      })
      .catch((err: unknown) => {
        // 4. Rollback.
        set((s) => ({
          timeEntries: s.timeEntries.map((e) => (e.id === id && prior ? prior : e)),
        }));
        reportWriteError("reopenEntry", err);
      });
  },
});
