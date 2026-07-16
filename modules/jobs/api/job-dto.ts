import { z } from "zod";
import {
  JOB_STATUSES,
  JOB_VISIT_STATUSES,
  JOB_KINDS,
  CALLBACK_REASONS,
  type Job,
  type JobStatus,
  type VisitStatus,
  type JobKind,
  type CallbackReason,
  type JobChecklistProps,
} from "../domain/job";
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
export const kindEnum = z.enum(JOB_KINDS as unknown as [JobKind, ...JobKind[]]);
export const callbackReasonEnum = z.enum(
  CALLBACK_REASONS as unknown as [CallbackReason, ...CallbackReason[]],
);
export const moneyDTO = z.object({ cents: z.number().int(), currency: z.literal("USD") });

export const visitDTO = z.object({
  id: z.string().uuid(),
  assigneeUserId: z.string().uuid().nullable(),
  scheduledDate: z.string().nullable(),
  scheduledStart: z.string().nullable(),
  scheduledEnd: z.string().nullable(),
  // Authoritative length in minutes; null only for legacy rows (client falls back
  // to the start→end window).
  durationMinutes: z.number().int().nullable(),
  status: visitStatusEnum,
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  notes: z.string().nullable(),
  position: z.number().int(),
});

// rate/cost are nullable because the tech-facing field-router REDACTS them server-side
// (cost always for techs; rate too when the org's techSeesPrice is off). Office routers
// never emit null — they serve the full figures to owner/office only.
export const jobLineDTO = z.object({
  id: z.string().uuid(),
  description: z.string(),
  quantity: z.number(),
  rate: moneyDTO.nullable(),
  cost: moneyDTO.nullable(),
  position: z.number().int(),
});

export const jobAddonDTO = z.object({
  id: z.string().uuid(),
  description: z.string(),
  quantity: z.number(),
  rate: moneyDTO.nullable(),
  cost: moneyDTO.nullable(),
  isOptional: z.boolean(),
  invoiceSkip: z.boolean(),
  status: z.enum(["proposed", "approved", "declined"]),
  position: z.number().int(),
});

export const jobVerifyAnswerDTO = z.object({
  itemId: z.string().min(1),
  state: z.enum(["pass", "override"]),
  via: z.string().nullable(),
  reason: z.string().nullable(),
});

// Input for writing one verify answer. Shared by BOTH surfaces — the office
// job-router and the tech field-router — so the contract can't drift between them.
export const setVerifyAnswerInput = z.object({
  jobId: z.string().uuid(),
  // Bounded like checklist item ids (jobChecklistInput) — the use-case additionally
  // validates membership against the job's attached checklist.
  itemId: z.string().min(1).max(100),
  state: z.enum(["pass", "override", "clear"]),
  via: z.string().max(50).nullable().optional(),
  reason: z.string().max(2000).nullable().optional(),
});

// Before-you-leave checklist snapshot on the job (order = array order). Crew
// ANSWERS ride jobVerifyAnswerDTO — this is only the attached list itself.
export const jobChecklistDTO = z.object({
  name: z.string(),
  items: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      type: z.enum(["check", "photo"]),
      required: z.boolean(),
    }),
  ),
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
  kind: kindEnum,
  status: statusEnum,
  scheduledStart: z.string().nullable(),
  scheduledEnd: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  canceledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  total: moneyDTO,
  notes: z.string().nullable(),
  scope: z.string().nullable(),
  callbackOf: z.string().uuid().nullable(),
  callbackReason: callbackReasonEnum.nullable(),
  checklist: jobChecklistDTO.nullable(),
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
  sourceEstimateId: z.string().uuid().nullable(),
  title: z.string().nullable(),
  svc: z.string().nullable(),
  kind: kindEnum,
  status: statusEnum,
  assigneeUserId: z.string().uuid().nullable(),
  scheduledStart: z.string().nullable(),
  total: moneyDTO,
  notes: z.string().nullable(),
  scope: z.string().nullable(),
  callbackOf: z.string().uuid().nullable(),
  callbackReason: callbackReasonEnum.nullable(),
  checklist: jobChecklistDTO.nullable(),
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

const toChecklistDTO = (cl: JobChecklistProps | null) =>
  cl
    ? {
        name: cl.name,
        items: cl.items.map((it) => ({
          id: it.id,
          text: it.text,
          type: it.type,
          required: it.required,
        })),
      }
    : null;

export const toVisitDTO = (visit: import("../domain/job").JobVisit) => {
  const v = visit.props;
  return {
    id: v.id,
    assigneeUserId: v.assigneeUserId,
    scheduledDate: v.scheduledDate,
    scheduledStart: v.scheduledStart,
    scheduledEnd: v.scheduledEnd,
    durationMinutes: v.durationMinutes,
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
    kind: p.kind,
    status: p.status,
    scheduledStart: iso(p.scheduledStart),
    scheduledEnd: iso(p.scheduledEnd),
    startedAt: iso(p.startedAt),
    completedAt: iso(p.completedAt),
    canceledAt: iso(p.canceledAt),
    cancelReason: p.cancelReason,
    total: money(p.total),
    notes: p.notes,
    scope: p.scope,
    callbackOf: p.callbackOf,
    callbackReason: p.callbackReason,
    checklist: toChecklistDTO(p.checklist),
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
    sourceEstimateId: p.sourceEstimateId,
    title: p.title,
    svc: p.svc,
    kind: p.kind,
    status: p.status,
    assigneeUserId: p.assigneeUserId,
    scheduledStart: iso(p.scheduledStart),
    total: money(p.total),
    notes: p.notes,
    scope: p.scope,
    callbackOf: p.callbackOf,
    callbackReason: p.callbackReason,
    checklist: toChecklistDTO(p.checklist),
    visits: p.visits.map(toVisitDTO),
    createdAt: p.createdAt.toISOString(),
    ...executionFields(execution),
  };
};
