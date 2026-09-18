"use client";

/**
 * features/field/use-week-submission.ts
 * The technician's attestation for one week: "these are my hours."
 *
 * WHY IT IS A STATE AND NOT A BUTTON. Before this, the office grid could tell a week that was
 * APPROVED from one that was not, and nothing else — so an approver could not distinguish a week the
 * technician considers finished from one he is still filling in on Thursday afternoon. Approving the
 * second kind is how a man gets paid for four days of a five-day week. Submitted is the state that
 * makes approval safe, and it only means something if he is the one who sets it.
 *
 * IT LOCKS HIS OWN WEEK, which is the point: an attestation he can quietly edit afterwards is not an
 * attestation. The server has enforced that since #457 (`assertTechMayEditTimes` answers CONFLICT on
 * a submitted week); this is the surface finally asking, so the controls match what is possible
 * instead of producing a refusal.
 *
 * REOPENING IS THE OFFICE'S. A submission the technician could withdraw is a lock with a handle on
 * the inside — so `reopenedAt` is set by the office (and by his own CLOCK taps, deliberately: tapping
 * Start day on a submitted week reopens it rather than refusing, because the clock must never refuse
 * a man who is standing at a customer's door).
 */

import { api } from "@/lib/trpc/client";
import { track } from "@/lib/analytics/track";
import { ANALYTICS_EVENTS } from "@/lib/analytics/events";

export interface WeekSubmissionState {
  /** True when this week carries a live attestation — submitted and not reopened since. */
  readonly submitted: boolean;
  /** When he submitted it, ISO. Null when he has not. */
  readonly submittedAt: string | null;
  /**
   * Why the office handed this week back, when they did.
   *
   * Without it a returned week is indistinguishable from one he never submitted — the Submit button
   * simply reappears and he is left to work out what changed. The reason IS the request.
   */
  readonly changesRequested: string | null;
  /** True while the read is still in flight — the button waits rather than guessing. */
  readonly loading: boolean;
  readonly submitting: boolean;
  /** The server's refusal, verbatim (e.g. a day still on the clock). */
  readonly error: string | null;
  readonly submit: () => void;
}

export function useWeekSubmission(weekStartISO: string, enabled: boolean): WeekSubmissionState {
  const utils = api.useUtils();
  const query = api.v1.timesheets.submissionFor.useQuery(
    { weekStart: weekStartISO },
    { enabled, refetchOnWindowFocus: false },
  );
  const mutation = api.v1.timesheets.submitWeek.useMutation({
    onSuccess: () => {
      // The register locks on this answer, so it has to be re-read rather than assumed: the office
      // may have reopened the week between the render and the tap.
      void utils.v1.timesheets.submissionFor.invalidate();
      // No week date and no hours count: which weeks a named person worked is not a question
      // analytics needs to answer, and the event only exists to say the habit stuck.
      track(ANALYTICS_EVENTS.hoursSubmitted);
    },
  });

  const submission = query.data?.submission ?? null;

  return {
    submitted: submission !== null && submission.reopenedAt === null,
    submittedAt: submission?.submittedAt ?? null,
    // Only while it is actually reopened: once he resubmits, the reason is history and showing it
    // above a week he has just signed off again reads as an outstanding complaint.
    changesRequested:
      submission !== null && submission.reopenedAt !== null ? submission.reopenReason : null,
    loading: !query.isFetched,
    submitting: mutation.isPending,
    error: mutation.error?.message ?? null,
    submit: () => mutation.mutate({ weekStart: weekStartISO }),
  };
}
