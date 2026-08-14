"use client";

/**
 * features/jobs/timesheets-batch-bar.tsx
 * Approve several weeks at once.
 *
 * Approving used to be one week at a time behind one open card. A shop with eight people ran the
 * same three actions eight times on payroll day, and the grid made that obvious by putting all
 * eight in front of you at once.
 *
 * THE SERVER STILL DECIDES EACH WEEK ON ITS OWN. This loops the same approve use case per selected
 * technician; a week with hours still on the clock is refused exactly as it is refused singly, and
 * the bar reports how many were held rather than claiming a success it did not get. Batch is a way
 * of asking, never a way of overriding.
 *
 * Anchored in flow above the grid, not floating over it — a bar that hovers covers the rows the
 * count refers to.
 */

export interface TimesheetsBatchBarProps {
  readonly count: number;
  readonly busy: boolean;
  readonly onApprove: () => void;
  readonly onClear: () => void;
}

export function TimesheetsBatchBar({ count, busy, onApprove, onClear }: TimesheetsBatchBarProps) {
  if (count === 0) return null;
  return (
    <div className="tsg-batch" role="status">
      <b>
        {count} selected
      </b>
      <button className="btn sm primary" onClick={onApprove} disabled={busy}>
        {busy ? "Approving…" : "Approve"}
      </button>
      <span className="tsg-batch-gap" />
      <button className="btn sm ghost" onClick={onClear} disabled={busy}>
        Cancel
      </button>
    </div>
  );
}

export interface TimesheetsBatchResultProps {
  /** null while nothing has been run since the last selection change. */
  readonly result: { approved: number; held: string[] } | null;
}

/**
 * What the batch actually did.
 *
 * Named people, not a count, for the ones that were refused: "3 approved, 2 held" leaves an office
 * manager hunting for which two. The refusal reason lives on each row's own card, which is where
 * the fix is.
 */
export function TimesheetsBatchResult({ result }: TimesheetsBatchResultProps) {
  if (result === null) return null;
  const { approved, held } = result;
  if (held.length === 0) {
    return (
      <p className="tsg-batch-note" role="status">
        Approved {approved} timesheet{approved === 1 ? "" : "s"}.
      </p>
    );
  }
  return (
    <p className="tsg-batch-note tsg-batch-held" role="status">
      {approved > 0 ? `Approved ${approved}. ` : ""}
      Still on the clock, so not approved: {held.join(", ")}. Open each one and stop the day.
    </p>
  );
}
