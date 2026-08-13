import { asTimeEntryId, asUserId, asOrgId, asJobId } from "@mallet/shared/types";
import { timeEntries } from "@mallet/shared/db/schema";
import { TimeEntry, type TimeEntryKind } from "../domain/time-entry";

// The persistence row shape inferred from the schema.
export type TimeEntryRow = typeof timeEntries.$inferSelect;

// Reconstruct a domain TimeEntry from a DB row. Corrupt data throws rather than silently coercing.
export const toDomain = (row: TimeEntryRow): TimeEntry => {
  const result = TimeEntry.create({
    id: asTimeEntryId(row.id),
    orgId: asOrgId(row.orgId),
    techUserId: asUserId(row.techUserId),
    jobId: row.jobId ? asJobId(row.jobId) : null,
    workDate: row.workDate,
    kind: row.kind as TimeEntryKind,
    // Drizzle time columns return strings like "HH:MM:SS" — normalize to "HH:MM".
    // Nullable since the time-off kinds: a PTO row has no punch times at all.
    startTime: row.startTime ? row.startTime.slice(0, 5) : null,
    endTime: row.endTime ? row.endTime.slice(0, 5) : null,
    minutes: row.minutes,
    note: row.note,
    src: row.src as "manual" | "clock" | "timer",
    status: row.status as "draft" | "approved",
    running: row.running,
    approvedAt: row.approvedAt ?? null,
    editedByUserId: row.editedByUserId ? asUserId(row.editedByUserId) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) {
    throw new Error(`corrupt time_entry ${row.id}: ${result.error.message}`);
  }
  return result.value;
};
