// The follow-up reminder cadence. Pure value object — no clock, no I/O. A target (a sent invoice
// or estimate) gets reminder stage 1 after REMINDER_OFFSETS_DAYS[0] days, stage 2 after [1], and
// then the sequence is exhausted. The sequence stops entirely once the target reaches a terminal
// state (paid / accepted / void / declined).

const REMINDER_OFFSET_DAYS: readonly number[] = [3, 6]; // stage 1 at day 3, stage 2 at day 6
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ReminderTargetStatus = string;

const TERMINAL_STATUSES: readonly string[] = ["paid", "void", "accepted", "declined"];

export class FollowUpPolicy {
  // Stages that could ever be due, highest first (so we return the most-overdue unsent stage).
  private readonly stages = REMINDER_OFFSET_DAYS.map((offsetDays, i) => ({
    stage: i + 1,
    offsetDays,
  })).reverse();

  isSequenceComplete(status: ReminderTargetStatus): boolean {
    return TERMINAL_STATUSES.includes(status);
  }

  // The next reminder stage due now, or null if none is due (too soon, all sent, or sequence
  // complete). alreadySent lists stages already delivered for this target.
  nextReminderDue(
    status: ReminderTargetStatus,
    sentAt: Date | null,
    alreadySent: readonly number[],
    now: Date,
  ): number | null {
    if (sentAt === null || this.isSequenceComplete(status)) return null;
    const ageDays = (now.getTime() - sentAt.getTime()) / MS_PER_DAY;
    // Monotonic: never return a stage <= the highest already sent, so the sequence never walks
    // backward to a gentler message (a late first run still catches up to the most-overdue stage).
    const maxSent = alreadySent.length ? Math.max(...alreadySent) : 0;
    for (const { stage, offsetDays } of this.stages) {
      if (ageDays >= offsetDays && stage > maxSent) return stage;
    }
    return null;
  }
}
