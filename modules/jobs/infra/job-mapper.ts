import { asJobId, asOrgId, asLeadId, asEstimateId, asUserId, asVisitId, money } from "@mallet/shared/types";
import { jobs, jobVisits } from "@mallet/shared/db/schema";
import { Job, JobVisit, isJobKind, isJobStatus, isVisitStatus, type CallbackReason } from "../domain/job";

export type JobRow = typeof jobs.$inferSelect;
export type JobVisitRow = typeof jobVisits.$inferSelect;

// Postgres `time` columns come back as "HH:MM:SS", but the app's canonical visit-time
// format is "HH:MM" (what the domain writes, what hourToHHMM produces, what the store/UI use).
// Present HH:MM at the read boundary so a written "09:00" round-trips as "09:00", not "09:00:00".
const toHHMM = (t: string | null): string | null => (t ? t.slice(0, 5) : null);

const toVisit = (row: JobVisitRow): JobVisit => {
  if (!isVisitStatus(row.status)) {
    throw new Error(`corrupt job_visit ${row.id}: unknown status "${row.status}"`);
  }
  const result = JobVisit.create({
    id: asVisitId(row.id),
    assigneeUserId: row.assigneeUserId ? asUserId(row.assigneeUserId) : null,
    scheduledDate: row.scheduledDate ?? null,
    scheduledStart: toHHMM(row.scheduledStart ?? null),
    scheduledEnd: toHHMM(row.scheduledEnd ?? null),
    durationMinutes: row.durationMinutes ?? null,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    status: row.status,
    enrouteAt: row.enrouteAt ?? null,
    startedAt: row.startedAt ?? null,
    completedAt: row.completedAt ?? null,
    notes: row.notes ?? null,
    position: row.position,
  });
  if (!result.ok) throw new Error(`corrupt job_visit ${row.id}: ${result.error.message}`);
  return result.value;
};

// Reconstruct the aggregate from a header row + its (already deleted-filtered) visit rows.
// Corrupt data fails loud rather than silently coercing (mirrors estimate-mapper).
export const toDomain = (row: JobRow, visitRows: readonly JobVisitRow[] = []): Job => {
  if (!isJobStatus(row.status)) {
    throw new Error(`corrupt job ${row.id}: unknown status "${row.status}"`);
  }
  if (!isJobKind(row.kind)) {
    throw new Error(`corrupt job ${row.id}: unknown kind "${row.kind}"`);
  }
  const visits = [...visitRows].sort((a, b) => a.position - b.position).map(toVisit);

  const result = Job.create({
    id: asJobId(row.id),
    orgId: asOrgId(row.orgId),
    num: row.num,
    leadId: asLeadId(row.leadId),
    sourceEstimateId: row.sourceEstimateId ? asEstimateId(row.sourceEstimateId) : null,
    assigneeUserId: row.assigneeUserId ? asUserId(row.assigneeUserId) : null,
    title: row.title,
    svc: row.svc ?? null,
    kind: row.kind,
    status: row.status,
    scheduledStart: row.scheduledStart,
    scheduledEnd: row.scheduledEnd,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    canceledAt: row.canceledAt,
    cancelReason: row.cancelReason,
    total: money(row.totalCents),
    taxBps: row.taxBps,
    discBps: row.discBps,
    tax: money(row.taxCents),
    notes: row.notes,
    addr: row.addr ?? null,
    phone: row.phone ?? null,
    completion: row.completion ?? null,
    invRequested: row.invRequested,
    scope: row.scope ?? null,
    callbackOf: row.callbackOf ? asJobId(row.callbackOf) : null,
    callbackReason: row.callbackReason as CallbackReason | null,
    // jsonb passes through Job.create, which runtime-validates the shape —
    // corrupt checklist data fails loud below rather than silently coercing.
    checklist: row.checklist ?? null,
    requiredCerts: (row.requiredCerts as string[] | null) ?? null,
    signerName: row.signerName ?? null,
    signatureSvg: row.signatureSvg ?? null,
    signedAt: row.signedAt ?? null,
    signedSnapshot: row.signedSnapshot ?? null,
    signedByUserId: row.signedByUserId ?? null,
    visits,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  if (!result.ok) throw new Error(`corrupt job ${row.id}: ${result.error.message}`);
  return result.value;
};
