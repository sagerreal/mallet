import { asJobId, asOrgId, asLeadId, asEstimateId, asUserId, money } from "@mallet/shared/types";
import { jobs } from "@mallet/shared/db/schema";
import { Job, isJobStatus } from "../domain/job";

export type JobRow = typeof jobs.$inferSelect;

// Reconstruct the aggregate from a row. Corrupt data fails loud rather than coercing.
export const toDomain = (row: JobRow): Job => {
  if (!isJobStatus(row.status)) {
    throw new Error(`corrupt job ${row.id}: unknown status "${row.status}"`);
  }
  const result = Job.create({
    id: asJobId(row.id),
    orgId: asOrgId(row.orgId),
    num: row.num,
    leadId: asLeadId(row.leadId),
    sourceEstimateId: row.sourceEstimateId ? asEstimateId(row.sourceEstimateId) : null,
    assigneeUserId: row.assigneeUserId ? asUserId(row.assigneeUserId) : null,
    title: row.title,
    status: row.status,
    scheduledStart: row.scheduledStart,
    scheduledEnd: row.scheduledEnd,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    canceledAt: row.canceledAt,
    cancelReason: row.cancelReason,
    total: money(row.totalCents),
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) throw new Error(`corrupt job ${row.id}: ${result.error.message}`);
  return result.value;
};
