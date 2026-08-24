"use client";

/**
 * features/field/use-my-hours-writes.ts
 * The writes My hours makes — correct a row, add a block the clock missed, record a day off.
 *
 * Deliberately NOT optimistic and deliberately not routed through the Zustand timesheets slice:
 * that slice is hydrated only under the office layout, and a payroll row is the wrong place to
 * show a change that may not have landed. The mutation settles, the list refetches, and what the
 * technician sees afterwards is what the shop will approve.
 */

import { api } from "@/lib/trpc/client";

/** The `src` a hand-typed row is recorded under — the office reads this column when deciding
 *  how much to trust an entry it is about to sign for, so a typed row must never claim to be a
 *  clock tap. */
const MANUAL_SRC = "manual" as const;

export interface AddBlockInput {
  readonly techUserId: string;
  readonly workDate: string;
  readonly kind: "job" | "travel" | "break" | "shop";
  /** The job these hours went to. Required on the "job" kind, null on every other. */
  readonly jobId: string | null;
  readonly startTime: string;
  readonly endTime: string;
  readonly note: string;
}

/**
 * A day of paid absence. The OTHER shape a time entry comes in: a length and no clock.
 *
 * No startTime/endTime by TYPE, not by convention — the domain's shape matrix refuses a time-off
 * row that carries punch times, and a day off genuinely has none. It is also why these rows never
 * meet the overlap gate (CreateTimeEntryUseCase gates only punched rows) and never create
 * overtime (weekSummary splits overtime out of WORKED hours alone).
 */
export interface AddTimeOffInput {
  readonly techUserId: string;
  readonly workDate: string;
  readonly kind: "pto" | "vacation" | "sick" | "holiday";
  /** Whole minutes, 1..1440. One row is one day; a week off is five rows. */
  readonly minutes: number;
  readonly note: string;
}

export function useMyHoursWrites() {
  const utils = api.useUtils();
  // One refetch seam for both writes: the page's own query is the only reader.
  const reload = (): void => {
    void utils.v1.timesheets.list.invalidate();
  };

  const update = api.v1.timesheets.update.useMutation({ onSuccess: reload });
  const create = api.v1.timesheets.create.useMutation({ onSuccess: reload });
  const remove = api.v1.timesheets.remove.useMutation({ onSuccess: reload });

  return {
    /**
     * Correct a draft row: what it was, which job it was on, and when.
     *
     * Setting an end also STOPS the row: a row with an end time that still claims to be running
     * holds the technician's one running slot and is rejected by the QuickBooks push as unfinished.
     *
     * kind and jobId travel together. Everything the clock cannot attribute lands as "shop", and
     * re-filing it as a job is the whole reason a technician opens this editor.
     */
    saveEntry: (
      entryId: string,
      patch: { kind: "job" | "travel" | "break" | "shop"; jobId: string | null; startTime: string; endTime: string },
      onDone: () => void,
    ): void => {
      // The editor stays open until the write lands — closing it on click would hide a refusal
      // (an approved row, a bad range) behind a row that looks like it saved.
      update.mutate(
        {
          entryId,
          kind: patch.kind,
          // Only a job carries a job. The server treats null as "clear it".
          jobId: patch.kind === "job" ? patch.jobId : null,
          startTime: patch.startTime,
          endTime: patch.endTime,
          running: false,
        },
        { onSuccess: onDone },
      );
    },
    /** Close a day the technician left open, at a time he confirmed. */
    endOpenDay: (entryId: string, endTime: string): void => {
      update.mutate({ entryId, endTime, running: false });
    },
    addBlock: (input: AddBlockInput, onDone: () => void): void => {
      create.mutate({ ...input, src: MANUAL_SRC, running: false }, { onSuccess: onDone });
    },
    /**
     * Record a day of paid absence.
     *
     * The nulls are explicit rather than omitted: `create`'s input treats an absent field and a
     * null one alike, but writing them out is what makes the shape of this row readable next to
     * addBlock's — and a time-off row carrying times is the one thing the server will refuse.
     */
    addTimeOff: (input: AddTimeOffInput, onDone: () => void): void => {
      create.mutate(
        {
          techUserId: input.techUserId,
          workDate: input.workDate,
          kind: input.kind,
          minutes: input.minutes,
          jobId: null,
          startTime: null,
          endTime: null,
          note: input.note,
          src: MANUAL_SRC,
          running: false,
        },
        { onSuccess: onDone },
      );
    },
    /** Soft-delete a draft row. The server refuses approved rows — that refusal surfaces
     *  through removeError on the still-open editor, never as a silent no-op. */
    removeEntry: (entryId: string, onDone: () => void): void => {
      remove.mutate({ entryId }, { onSuccess: onDone });
    },
    updateError: update.error?.message ?? null,
    createError: create.error?.message ?? null,
    removeError: remove.error?.message ?? null,
    saving: update.isPending,
    adding: create.isPending,
    removing: remove.isPending,
  };
}
