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
import type { JobId } from "@mallet/shared/types";

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
  // "On my way" stamp. The client derives its own "enroute" word from
  // (status = pending AND this set) — there is no fifth status value.
  enrouteAt: z.string().nullable(),
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
  /** Does this line take sales tax — carried from the quote, carried on to the invoice line. */
  taxable: z.boolean(),
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

// Photo upload inputs shared between the office job-router and the tech field-router so
// the contract stays consistent across both surfaces.
export const photoUploadUrlInput = z.object({
  jobId: z.string().uuid(),
  objectId: z.string().uuid(),
  ext: z.enum(["jpg", "jpeg", "png", "webp"]),
});
export const addPhotoInput = z.object({
  jobId: z.string().uuid(),
  id: z.string().uuid().optional(),
  storagePath: z.string().min(1).max(1024),
  caption: z.string().max(2000).nullable().optional(),
  verifyPass: z.boolean().optional(),
});
export const photoUploadUrlDTO = z.object({ signedUrl: z.string(), token: z.string(), storagePath: z.string() });

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
  // Nullable: the tech-facing field surface redacts total server-side when the
  // org's techSeesPrice is off. Office/owner responses are never null.
  total: moneyDTO.nullable(),
  notes: z.string().nullable(),
  // The address the crew drives to and a job-specific contact, when they differ from the
  // customer's on file. Both were accepted by the create input and dropped for want of a column.
  addr: z.string().nullable(),
  phone: z.string().nullable(),
  // What the tech did, shown to the customer on the invoice; and their "ready to bill" tap.
  completion: z.string().nullable(),
  invRequested: z.boolean(),
  scope: z.string().nullable(),
  callbackOf: z.string().uuid().nullable(),
  callbackReason: callbackReasonEnum.nullable(),
  checklist: jobChecklistDTO.nullable(),
  requiredCerts: z.array(z.string()).nullable(),
  /**
   * The on-glass signature, or null when nobody signed on site.
   *
   * Same shape the estimate DTO uses, so ONE SignatureRecord renders both. Gated on name AND
   * timestamp AND snapshot together — a row with only some of them is corruption, and rendering
   * it would put a confident-looking empty block in front of a shop about to chase money.
   *
   * Full DTO only. The summary omits it: a board of thirty jobs does not need thirty frozen
   * documents to draw a card.
   */
  signature: z
    .object({
      signerName: z.string(),
      signatureSvg: z.string().nullable(),
      signerIp: z.string().nullable(),
      signerUserAgent: z.string().nullable(),
      signedAt: z.string(),
      snapshot: z.object({
        estimateNum: z.string(),
        totalCents: z.number().int(),
        depositCents: z.number().int(),
        chosenTier: z.string().nullable(),
        authorizationText: z.string(),
        lines: z.array(
          z.object({ description: z.string(), quantity: z.number(), rateCents: z.number().int() }),
        ),
      }),
    })
    .nullable(),
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
  /**
   * The customer's name, resolved SERVER-side.
   *
   * The list used to look this up in the store's leads collection. That works only while every
   * lead is loaded — and leads hit the same 500-row page ceiling as jobs, so a paginated job list
   * would render "—" for any customer past the first page. Null only when the join finds nothing,
   * which a composite FK makes near-impossible.
   */
  customerName: z.string().nullable(),
  sourceEstimateId: z.string().uuid().nullable(),
  title: z.string().nullable(),
  svc: z.string().nullable(),
  kind: kindEnum,
  status: statusEnum,
  assigneeUserId: z.string().uuid().nullable(),
  scheduledStart: z.string().nullable(),
  // Nullable: the tech-facing field surface redacts total server-side when the
  // org's techSeesPrice is off. Office/owner responses are never null.
  total: moneyDTO.nullable(),
  notes: z.string().nullable(),
  // The address the crew drives to and a job-specific contact, when they differ from the
  // customer's on file. Both were accepted by the create input and dropped for want of a column.
  addr: z.string().nullable(),
  phone: z.string().nullable(),
  // What the tech did, shown to the customer on the invoice; and their "ready to bill" tap.
  completion: z.string().nullable(),
  invRequested: z.boolean(),
  scope: z.string().nullable(),
  callbackOf: z.string().uuid().nullable(),
  callbackReason: callbackReasonEnum.nullable(),
  checklist: jobChecklistDTO.nullable(),
  requiredCerts: z.array(z.string()).nullable(),
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
  return { id: p.id, description: p.description, quantity: p.quantity, rate: money(p.rate), cost: money(p.cost), taxable: p.taxable, position: p.position };
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
    enrouteAt: iso(v.enrouteAt),
    startedAt: iso(v.startedAt),
    completedAt: iso(v.completedAt),
    notes: v.notes,
    position: v.position,
  };
};

/**
 * The on-glass signature for the wire, or null.
 *
 * Same three-part gate as the estimate side (name AND timestamp AND snapshot): the domain writes
 * all of them in one transition, so a row with only some is corruption rather than a partial
 * record, and it must not render as evidence.
 */
const toJobSignatureDTO = (job: Job) => {
  const p = job.props;
  const snap = p.signedSnapshot as
    | {
        estimateNum: string;
        totalCents: number;
        depositCents: number;
        chosenTier: string | null;
        authorizationText: string;
        lines: { description: string; quantity: number; rateCents: number }[];
      }
    | null
    | undefined;
  if (!p.signedAt || !p.signerName || !snap) return null;
  return {
    signerName: p.signerName,
    // "" means they signed by typing their name — a real signature, and a different record from a
    // drawing that failed to save. Normalised so the UI branches on presence.
    signatureSvg: p.signatureSvg && p.signatureSvg.length > 0 ? p.signatureSvg : null,
    // Always null on this path, and deliberately so: on a tech's tablet the IP would be the same
    // device for every signature that tech ever takes. See modules/jobs/domain/job-signature.ts.
    signerIp: null,
    signerUserAgent: null,
    signedAt: p.signedAt.toISOString(),
    snapshot: {
      estimateNum: snap.estimateNum,
      totalCents: snap.totalCents,
      depositCents: snap.depositCents,
      chosenTier: snap.chosenTier,
      authorizationText: snap.authorizationText,
      lines: snap.lines.map((l) => ({ description: l.description, quantity: l.quantity, rateCents: l.rateCents })),
    },
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
    addr: p.addr,
    phone: p.phone,
    completion: p.completion,
    invRequested: p.invRequested,
    scope: p.scope,
    callbackOf: p.callbackOf,
    callbackReason: p.callbackReason,
    checklist: toChecklistDTO(p.checklist),
    requiredCerts: p.requiredCerts ? [...p.requiredCerts] : null,
    signature: toJobSignatureDTO(job),
    visits: p.visits.map(toVisitDTO),
    createdAt: p.createdAt.toISOString(),
    ...executionFields(execution),
  };
};

/**
 * The full job DTO with the job's OWN execution, loaded rather than left empty.
 *
 * `toJobDTO(job)` defaults to `emptyExecution`, which puts `lines: []` on the wire — and the store
 * reconciles a mutation response by REPLACING the job it holds. So every endpoint that answered a
 * visit tap, a reschedule, an assign or an office field edit was telling the client "this job has
 * no lines", and the client believed it. On the technician's done card that reads as literally
 * "No price set — the office invoices it" on a job the customer had already agreed $185 for; the
 * next list refetch (which DOES carry lines) put the price back, the next tap took it away again,
 * and the card flapped between the two in front of the customer.
 *
 * An empty execution is a real answer for a job with no lines and an indistinguishable lie for a
 * job that has them, which is why this is fixed by loading rather than by guessing client-side.
 * One batched read (four IN-clause selects) on top of a write that already did several.
 *
 * Use this for any response the store reconciles from. `toJobDTO(job, execution)` stays for the
 * use-cases that already return their own refreshed execution — no second read needed there.
 */
export const toJobDTOWithExecution = async (
  repo: { listExecution(jobId: JobId): Promise<Execution> },
  job: Job,
) => toJobDTO(job, await repo.listExecution(job.props.id));

export const callbackCandidateDTO = z.object({
  jobId: z.string(),
  jobNum: z.string(),
  original: z.object({
    jobId: z.string(),
    num: z.string(),
    svc: z.string().nullable(),
    completedAt: z.string().datetime().nullable(),
  }),
});

export const autopsyTopMissDTO = z.object({
  itemText: z.string(),
  checklistName: z.string(),
  missCount: z.number().int(),
  ofAnswered: z.number().int(),
  alreadyRequired: z.boolean(),
});

export const autopsyClusterDTO = z.object({
  service: z.string(),
  callbackCount: z.number().int(),
  originalNums: z.array(z.string()),
  answeredOriginals: z.number().int(),
  topMiss: autopsyTopMissDTO.nullable(),
});

export const toJobSummaryDTO = (job: Job, execution: Execution = emptyExecution, customerName: string | null = null) => {
  const p = job.props;
  return {
    id: p.id,
    num: p.num,
    leadId: p.leadId,
    customerName,
    sourceEstimateId: p.sourceEstimateId,
    title: p.title,
    svc: p.svc,
    kind: p.kind,
    status: p.status,
    assigneeUserId: p.assigneeUserId,
    scheduledStart: iso(p.scheduledStart),
    total: money(p.total),
    notes: p.notes,
    addr: p.addr,
    phone: p.phone,
    completion: p.completion,
    invRequested: p.invRequested,
    scope: p.scope,
    callbackOf: p.callbackOf,
    callbackReason: p.callbackReason,
    checklist: toChecklistDTO(p.checklist),
    requiredCerts: p.requiredCerts ? [...p.requiredCerts] : null,
    visits: p.visits.map(toVisitDTO),
    createdAt: p.createdAt.toISOString(),
    ...executionFields(execution),
  };
};
