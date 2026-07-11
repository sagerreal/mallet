import { z } from "zod";
import { JOB_STATUSES, JOB_VISIT_STATUSES, type Job, type JobStatus, type VisitStatus } from "../domain/job";
import type {
  JobLine,
  JobAddon,
  JobVerifyAnswer,
  JobPhoto,
} from "../domain/job-execution";

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

export const jobLineDTO = z.object({
  id: z.string().uuid(),
  description: z.string(),
  quantity: z.number(),
  rate: moneyDTO,
  cost: moneyDTO,
  position: z.number().int(),
});

export const jobAddonDTO = z.object({
  id: z.string().uuid(),
  description: z.string(),
  quantity: z.number(),
  rate: moneyDTO,
  cost: moneyDTO,
  isOptional: z.boolean(),
  invoiceSkip: z.boolean(),
  status: z.enum(["proposed", "approved", "declined"]),
  position: z.number().int(),
});

export const jobVerifyAnswerDTO = z.object({
  itemId: z.number().int(),
  state: z.enum(["pass", "override"]),
  via: z.string().nullable(),
  reason: z.string().nullable(),
});

export const jobPhotoDTO = z.object({
  id: z.string().uuid(),
  storagePath: z.string(),
  caption: z.string().nullable(),
  verifyPass: z.boolean(),
  position: z.number().int(),
});

export const jobDTO = z.object({
  id: z.string().uuid(),
  num: z.string(),
  leadId: z.string().uuid(),
  sourceEstimateId: z.string().uuid().nullable(),
  assigneeUserId: z.string().uuid().nullable(),
  title: z.string().nullable(),
  svc: z.string().nullable(),
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
  lines: z.array(jobLineDTO),
  addons: z.array(jobAddonDTO),
  verifyAnswers: z.array(jobVerifyAnswerDTO),
  photos: z.array(jobPhotoDTO),
});

export const jobSummaryDTO = z.object({
  id: z.string().uuid(),
  num: z.string(),
  leadId: z.string().uuid(),
  title: z.string().nullable(),
  svc: z.string().nullable(),
  status: statusEnum,
  assigneeUserId: z.string().uuid().nullable(),
  scheduledStart: z.string().nullable(),
  total: moneyDTO,
  notes: z.string().nullable(),
  visits: z.array(visitDTO),
  createdAt: z.string(),
  lines: z.array(jobLineDTO),
  addons: z.array(jobAddonDTO),
  verifyAnswers: z.array(jobVerifyAnswerDTO),
  photos: z.array(jobPhotoDTO),
});

const money = (cents: number) => ({ cents, currency: "USD" as const });
const iso = (d: Date | null) => d?.toISOString() ?? null;

interface Execution {
  lines: readonly JobLine[];
  addons: readonly JobAddon[];
  verifyAnswers: readonly JobVerifyAnswer[];
  photos: readonly JobPhoto[];
}

const emptyExecution: Execution = { lines: [], addons: [], verifyAnswers: [], photos: [] };

const toLineDTO = (l: JobLine) => {
  const p = l.props;
  return { id: p.id, description: p.description, quantity: p.quantity, rate: money(p.rate), cost: money(p.cost), position: p.position };
};

const toAddonDTO = (a: JobAddon) => {
  const p = a.props;
  return {
    id: p.id,
    description: p.description,
    quantity: p.quantity,
    rate: money(p.rate),
    cost: money(p.cost),
    isOptional: p.isOptional,
    invoiceSkip: p.invoiceSkip,
    status: p.status,
    position: p.position,
  };
};

const toVerifyDTO = (v: JobVerifyAnswer) => {
  const p = v.props;
  return { itemId: p.itemId, state: p.state, via: p.via, reason: p.reason };
};

const toPhotoDTO = (ph: JobPhoto) => {
  const p = ph.props;
  return { id: p.id, storagePath: p.storagePath, caption: p.caption, verifyPass: p.verifyPass, position: p.position };
};

const executionFields = (execution: Execution) => ({
  lines: execution.lines.map(toLineDTO),
  addons: execution.addons.map(toAddonDTO),
  verifyAnswers: execution.verifyAnswers.map(toVerifyDTO),
  photos: execution.photos.map(toPhotoDTO),
});

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

export const toJobDTO = (job: Job, execution: Execution = emptyExecution) => {
  const p = job.props;
  return {
    id: p.id,
    num: p.num,
    leadId: p.leadId,
    sourceEstimateId: p.sourceEstimateId,
    assigneeUserId: p.assigneeUserId,
    title: p.title,
    svc: p.svc,
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
    ...executionFields(execution),
  };
};

export const toJobSummaryDTO = (job: Job, execution: Execution = emptyExecution) => {
  const p = job.props;
  return {
    id: p.id,
    num: p.num,
    leadId: p.leadId,
    title: p.title,
    svc: p.svc,
    status: p.status,
    assigneeUserId: p.assigneeUserId,
    scheduledStart: iso(p.scheduledStart),
    total: money(p.total),
    notes: p.notes,
    visits: p.visits.map(toVisitDTO),
    createdAt: p.createdAt.toISOString(),
    ...executionFields(execution),
  };
};
