import { z } from "zod";
import { JOB_STATUSES, JOB_VISIT_STATUSES, type Job, type JobStatus, type VisitStatus } from "../domain/job";

// Shared DTOs for the jobs module. Both the office-facing job-router and the tech-facing
// field-router import from here. Kept in one place so a schema change stays consistent.

export const statusEnum = z.enum(JOB_STATUSES as unknown as [JobStatus, ...JobStatus[]]);
export const visitStatusEnum = z.enum(JOB_VISIT_STATUSES as unknown as [VisitStatus, ...VisitStatus[]]);
export const moneyDTO = z.object({ cents: z.number().int(), currency: z.literal("USD") });

export const visitDTO = z.object({
  id: z.string().uuid(),
  assigneeUserId: z.string().uuid().nullable(),
  scheduledDate: z.string().nullable(),
  scheduledStart: z.string().nullable(),
  scheduledEnd: z.string().nullable(),
  status: visitStatusEnum,
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  notes: z.string().nullable(),
  position: z.number().int(),
});

export const jobDTO = z.object({
  id: z.string().uuid(),
  num: z.string(),
  leadId: z.string().uuid(),
  sourceEstimateId: z.string().uuid().nullable(),
  assigneeUserId: z.string().uuid().nullable(),
  title: z.string().nullable(),
  status: statusEnum,
  scheduledStart: z.string().nullable(),
  scheduledEnd: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  canceledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  total: moneyDTO,
  notes: z.string().nullable(),
  visits: z.array(visitDTO),
  createdAt: z.string(),
});

export const jobSummaryDTO = z.object({
  id: z.string().uuid(),
  num: z.string(),
  leadId: z.string().uuid(),
  title: z.string().nullable(),
  status: statusEnum,
  assigneeUserId: z.string().uuid().nullable(),
  scheduledStart: z.string().nullable(),
  total: moneyDTO,
  notes: z.string().nullable(),
  visits: z.array(visitDTO),
  createdAt: z.string(),
});

const money = (cents: number) => ({ cents, currency: "USD" as const });
const iso = (d: Date | null) => d?.toISOString() ?? null;

export const toVisitDTO = (visit: import("../domain/job").JobVisit) => {
  const v = visit.props;
  return {
    id: v.id,
    assigneeUserId: v.assigneeUserId,
    scheduledDate: v.scheduledDate,
    scheduledStart: v.scheduledStart,
    scheduledEnd: v.scheduledEnd,
    status: v.status,
    startedAt: iso(v.startedAt),
    completedAt: iso(v.completedAt),
    notes: v.notes,
    position: v.position,
  };
};

export const toJobDTO = (job: Job) => {
  const p = job.props;
  return {
    id: p.id,
    num: p.num,
    leadId: p.leadId,
    sourceEstimateId: p.sourceEstimateId,
    assigneeUserId: p.assigneeUserId,
    title: p.title,
    status: p.status,
    scheduledStart: iso(p.scheduledStart),
    scheduledEnd: iso(p.scheduledEnd),
    startedAt: iso(p.startedAt),
    completedAt: iso(p.completedAt),
    canceledAt: iso(p.canceledAt),
    cancelReason: p.cancelReason,
    total: money(p.total),
    notes: p.notes,
    visits: p.visits.map(toVisitDTO),
    createdAt: p.createdAt.toISOString(),
  };
};

export const toJobSummaryDTO = (job: Job) => {
  const p = job.props;
  return {
    id: p.id,
    num: p.num,
    leadId: p.leadId,
    title: p.title,
    status: p.status,
    assigneeUserId: p.assigneeUserId,
    scheduledStart: iso(p.scheduledStart),
    total: money(p.total),
    notes: p.notes,
    visits: p.visits.map(toVisitDTO),
    createdAt: p.createdAt.toISOString(),
  };
};
