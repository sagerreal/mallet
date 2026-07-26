"use client";

/**
 * features/field/use-my-hours-writes.ts
 * The two writes My hours makes — correct a row, add a block that was missed.
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
  readonly startTime: string;
  readonly endTime: string;
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
    updateError: update.error?.message ?? null,
    createError: create.error?.message ?? null,
    saving: update.isPending,
    adding: create.isPending,
  };
}
