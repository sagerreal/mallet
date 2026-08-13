"use client";

/**
 * features/field/hours-submit.tsx
 * "These are my hours" — the technician's own sign-off, in the week pager beside the week it signs.
 *
 * ONE CONTROL, TWO STATES. Before he submits it is a button; after, it is the FACT, with the time he
 * did it. Keeping a live Submit button next to "Submitted ✓" would invite the question of what a
 * second tap does, and the honest answer is nothing.
 *
 * IT NAMES WHAT SUBMITTING COSTS HIM. A control that locks a week without saying so is a trap, and
 * this one locks the week he is paid from — so the sentence under it is not decoration.
 *
 * THE SERVER'S REFUSALS ARE SHOWN VERBATIM. There is one that matters and it is not an error so much
 * as a next step: a day still on the clock ("End the day before submitting the week."). Rewording it
 * here would give the same rule two spellings, and the field's would be the one nobody maintains.
 */

import { Button } from "@/components/ui/button";
import { stampLabel } from "./job-time-derive";
import type { WeekSubmissionState } from "./use-week-submission";

export interface HoursSubmitProps {
  readonly state: WeekSubmissionState;
  /** False when the shop keeps timesheet changes with the office — then there is nothing to attest. */
  readonly canSubmit: boolean;
  /** Nothing recorded at all: an attestation for an empty week is a claim about nothing. */
  readonly empty: boolean;
}

export function HoursSubmit({ state, canSubmit, empty }: HoursSubmitProps) {
  // On a shop where the office owns the timesheet, HIS attestation is not part of the flow — the
  // office reads the hours and approves them. A Submit button there would be ceremony.
  if (!canSubmit) return null;
  // Waiting, rather than flashing a Submit button onto a week that turns out to be signed already.
  if (state.loading) return null;

  if (state.submitted) {
    return (
      <span className="wk-sent">
        Submitted{state.submittedAt ? ` · ${stampLabel(state.submittedAt)}` : ""}
      </span>
    );
  }

  if (empty) return null;

  return (
    <span className="wk-submit">
      <Button size="sm" disabled={state.submitting} onClick={state.submit}>
        {state.submitting ? "Submitting…" : "Submit week"}
      </Button>
      {state.error !== null ? <span className="wk-submit-err">{state.error}</span> : null}
    </span>
  );
}
