import { z } from "zod";
import { JOB_STATUSES, type Job, type JobStatus } from "../domain/job";

// Shared DTOs for the jobs module. Both the office-facing job-router and the tech-facing
// field-router import from here. Kept in one place so a schema change stays consistent.

export const statusEnum = z.enum(JOB_STATUSES as unknown as [JobStatus, ...JobStatus[]]);
export const moneyDTO = z.object({ cents: z.number().int(), currency: z.literal("USD") });

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
  createdAt: z.string(),
});

const money = (cents: number) => ({ cents, currency: "USD" as const });
const iso = (d: Date | null) => d?.toISOString() ?? null;

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
    createdAt: p.createdAt.toISOString(),
  };
};
