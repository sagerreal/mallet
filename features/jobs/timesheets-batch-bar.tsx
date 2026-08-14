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
 * count refers to. The reason field expands inside the bar for the same reason.
 */

import { useState } from "react";

export interface TimesheetsBatchBarProps {
  readonly count: number;
  readonly busy: boolean;
  readonly onApprove: () => void;
  readonly onRequestChanges: (reason: string) => void;
  readonly onClear: () => void;
  /**
   * Whether anything selected has actually been signed off.
   *
   * Handing a week back means retracting an attestation, so there has to be one. A shop that keeps
   * timesheet edits with the office is the common case here — its technicians never submit, so this
   * control would refuse every time. It says why rather than failing.
   */
  readonly canRequestChanges: boolean;
}

export function TimesheetsBatchBar({
  count,
  busy,
  onApprove,
  onRequestChanges,
  onClear,
  canRequestChanges,
}: TimesheetsBatchBarProps) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  if (count === 0) return null;

  const send = () => {
    if (reason.trim().length === 0) return;
    onRequestChanges(reason.trim());
    setReason("");
    setAsking(false);
  };

  return (
    <div className="tsg-batch" role="status">
      <b>{count} selected</b>
      <button className="btn sm primary" onClick={onApprove} disabled={busy || asking}>
        {busy ? "Working…" : "Approve"}
      </button>
      <button
        className="btn sm ghost"
        onClick={() => setAsking((v) => !v)}
        disabled={busy || !canRequestChanges}
        title={canRequestChanges ? undefined : "Nothing selected has been submitted, so there is nothing to hand back."}
      >
        Request changes
      </button>
      <span className="tsg-batch-gap" />
      <button
        className="btn sm ghost"
        onClick={() => {
          setAsking(false);
          setReason("");
          onClear();
        }}
        disabled={busy}
      >
        Cancel
      </button>

      {/* Expands in the bar, in flow — no popover. The reason is REQUIRED: sending a week back
          with nothing to go on makes a man re-read his own hours guessing which day is wrong. */}
      {asking && (
        <div className="tsg-batch-ask">
          <label htmlFor="tsg-reason" className="tsg-batch-lbl">
            What needs changing?
          </label>
          <input
            id="tsg-reason"
            className="field-compact tsg-batch-input"
            value={reason}
            autoFocus
            placeholder="e.g. Wednesday never clocked out"
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
              if (e.key === "Escape") setAsking(false);
            }}
            maxLength={300}
          />
          <button className="btn sm primary" onClick={send} disabled={reason.trim().length === 0 || busy}>
            Send back
          </button>
        </div>
      )}
    </div>
  );
}

/** What the last batch did. Two shapes because approving and sending back fail differently. */
export type BatchOutcome =
  | { readonly approved: number; readonly held: string[] }
  | { readonly sentBack: number; readonly notSubmitted: string[] };

export interface TimesheetsBatchResultProps {
  /** null while nothing has been run since the last selection change. */
  readonly result: BatchOutcome | null;
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

  if ("sentBack" in result) {
    const { sentBack, notSubmitted } = result;
    if (notSubmitted.length === 0) {
      return (
        <p className="tsg-batch-note" role="status">
          Sent {sentBack} week{sentBack === 1 ? "" : "s"} back.
        </p>
      );
    }
    return (
      <p className="tsg-batch-note tsg-batch-held" role="status">
        {sentBack > 0 ? `Sent ${sentBack} back. ` : ""}
        Never submitted, so there was nothing to hand back: {notSubmitted.join(", ")}.
      </p>
    );
  }

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
