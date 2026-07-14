// Pure formatting for a lead's "open work" one-liner spoken/shown in the caller-context prompt
// section. Kept separate from the drizzle reader so it is unit-testable without a DB. Produces
// e.g. "job #142 scheduled Jul 16 (drain clear)" or null when there is no active job.

// The raw fields a lead-summary query returns for the single most-recent active job (or nulls).
export interface OpenWorkRow {
  readonly jobNum: string | null;
  readonly jobStatus: string | null;
  readonly scheduledStart: Date | null;
  // First non-empty of title / svc — the human label for the job.
  readonly jobLabel: string | null;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

// "Jul 16" — month abbreviation + day, no year (a one-liner, current-season context).
const formatShortDate = (d: Date): string => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;

/**
 * Formats one open-work line. Returns null when there is no active job (jobNum absent). Every
 * segment is optional except the job number: status, date, and label are appended only when
 * present so a bare "job #142" still reads cleanly.
 */
export const formatOpenWork = (row: OpenWorkRow): string | null => {
  if (!row.jobNum) return null;
  const parts: string[] = [`job #${row.jobNum}`];
  if (row.jobStatus) parts.push(row.jobStatus);
  if (row.scheduledStart) parts.push(formatShortDate(row.scheduledStart));
  const head = parts.join(" ");
  const label = row.jobLabel?.trim();
  return label ? `${head} (${label})` : head;
};
