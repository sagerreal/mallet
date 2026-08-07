/**
 * components/modals/tech-job-modal/visit-seq.tsx
 * WHICH stop this is — "Visit 1 of 2".
 *
 * The section header has always said "Visits" on a job with more than one, and the rows under it
 * said nothing: two steppers, two dates, and no way to tell the first call from the return trip
 * except by reading both dates and working it out. A technician standing in a kitchen wants to
 * know which of the two rows is the one he is in, at a glance, and the numbering is the whole
 * answer — the stepper already says what state each is in.
 *
 * NOTHING IS PRINTED ON A ONE-VISIT JOB. "Visit 1 of 1" is a label for a distinction that does not
 * exist, and this sheet is read one-handed on a doorstep; a line that carries no information is a
 * line in the way. `seqAt` returns undefined and every consumer renders nothing.
 *
 * The number is also the stepper's accessible NAME. Two lists both announced as "Visit progress"
 * leave a screen-reader user with exactly the problem the caption fixes for everyone else.
 */

"use client";

/** One row's place in the section: the nth of `of` visits. */
export interface VisitSeq {
  readonly n: number;
  readonly of: number;
}

/**
 * Number a row — or don't. `total` counts EVERY visit the section renders, placed and
 * awaiting-a-slot alike: a return trip with no date yet is still the job's second visit, and
 * numbering only the placed ones would tell a technician there is one visit while two are on
 * screen.
 */
export function seqAt(index: number, total: number): VisitSeq | undefined {
  return total > 1 ? { n: index + 1, of: total } : undefined;
}

/** The stepper's accessible name for this row. Undefined keeps the component's own default. */
export function seqStepperLabel(seq: VisitSeq | undefined): string | undefined {
  return seq ? `Visit ${seq.n} progress` : undefined;
}

/**
 * The visible caption. One tier quieter than the section head above it: the row's record is the
 * content, and this is only its index.
 */
export function VisitCaption({ seq }: { seq: VisitSeq | undefined }) {
  if (!seq) return null;
  return (
    <div className="vseq">
      Visit {seq.n} of {seq.of}
    </div>
  );
}
