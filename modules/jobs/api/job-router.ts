import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOffice } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asJobId, asLeadId, asEstimateId, asUserId, toPage } from "@mallet/shared/types";
import { DrizzleJobRepository } from "../infra/drizzle-job-repository";
import { DrizzleLeadRepository } from "@mallet/customers";
import { JOB_SORTS } from "../infra/job-sorts";
import { JOB_VIEWS } from "../infra/job-views";
import { DrizzleEstimateReader } from "../infra/drizzle-estimate-reader";
import { ScheduleJobUseCase } from "../app/schedule-job";
import { CreateJobFromEstimateUseCase } from "../app/create-job-from-estimate";
import { RescheduleJobUseCase } from "../app/reschedule-job";
import { AssignJobUseCase } from "../app/assign-job";
import { StartJobUseCase } from "../app/start-job";
import { CompleteJobUseCase } from "../app/complete-job";
import { CancelJobUseCase } from "../app/cancel-job";
import { ListJobsUseCase } from "../app/list-jobs";
import { CreateManualJobUseCase } from "../app/create-manual-job";
import { UpdateJobUseCase } from "../app/update-job";
import {
  JOB_CHECKLIST_MAX_ITEMS,
  JOB_CHECKLIST_NAME_MAX,
  JOB_CHECKLIST_ITEM_TEXT_MAX,
} from "../domain/job";
import { ArchiveJobUseCase } from "../app/archive-job";
import { ListCallbackCandidatesUseCase } from "../app/list-callback-candidates";
import { ConfirmCallbackUseCase } from "../app/confirm-callback";
import { DismissCallbackUseCase } from "../app/dismiss-callback";
import { CallbackAutopsyUseCase } from "../app/callback-autopsy";
import { statusEnum, jobDTO, jobSummaryDTO, toJobDTO, toJobDTOWithExecution, toJobSummaryDTO, setVerifyAnswerInput, callbackCandidateDTO, callbackReasonEnum, autopsyClusterDTO } from "./job-dto";
import {
  AddJobLineUseCase,
  UpdateJobLineUseCase,
  RemoveJobLineUseCase,
  SetJobLinesUseCase,
  AddJobAddonUseCase,
  SetAddonStatusUseCase,
  SetAddonInvoiceSkipUseCase,
  SetVerifyAnswerUseCase,
  AddJobPhotoUseCase,
  RemoveJobPhotoUseCase,
} from "../app/job-execution-use-cases";

const paginatedSummaryDTO = z.object({
  items: z.array(jobSummaryDTO),
  nextCursor: z.string().nullable(),
});

const scheduleDirectInput = z.object({
  leadId: z.string().uuid(),
  title: z.string().optional(),
  scheduledStart: z.string().datetime().optional(),
  scheduledEnd: z.string().datetime().optional(),
  assigneeUserId: z.string().uuid().optional(),
});
const rescheduleInput = z.object({
  jobId: z.string().uuid(),
  scheduledStart: z.string().datetime(),
  scheduledEnd: z.string().datetime(),
});
const assignInput = z.object({
  jobId: z.string().uuid(),
  assigneeUserId: z.string().uuid().nullable(),
});
const jobIdInput = z.object({ jobId: z.string().uuid() });
const cancelInput = z.object({ jobId: z.string().uuid(), reason: z.string().min(1) });
const fromEstimateInput = z.object({ estimateId: z.string().uuid() });
/**
 * `view` is date-relative, so it is meaningless without the client's local date. Silently dropping
 * the filter — which is what the repository does when `today` is missing — returns the whole book
 * wearing a filtered label, so the boundary rejects it instead.
 */
const requiresTodayWithView = <T extends { view?: string; today?: string }>(i: T): boolean =>
  !i.view || Boolean(i.today);
// A fresh object per call: zod stores the `path` array it is handed, and sharing one mutable array
// between two schemas is how a later zod version quietly reports the error on the wrong field.
const todayRequired = () => ({
  message: "today is required when view is set — the date-relative views cannot be evaluated without the client's local date",
  path: ["today"],
});

const listInput = z.object({
  limit: z.number().int().positive().max(500).optional(),
  cursor: z.string().nullish(),
  status: statusEnum.optional(),
  assigneeUserId: z.string().uuid().optional(),
  /**
   * Open work only — excludes complete and canceled. What the Jobs list's "Active" tab means, and
   * what the nav badge counts. Not expressible as `status`, which is a single value.
   */
  activeOnly: z.boolean().optional(),
  /**
   * Named sort — never a column name. A client-supplied column is an injection surface and it
   * welds the public API to the table layout. Absent keeps the historical newest-first order, so
   * every existing caller is unaffected.
   */
  sort: z.enum(JOB_SORTS).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  /** Free-text over job title and number. Runs in the database, not over a loaded page. */
  search: z.string().trim().min(1).max(200).optional(),
  /** One scoped view (Needs a slot / Today / …). Requires `today` when date-relative. */
  view: z.enum(JOB_VIEWS).optional(),
  /** The CLIENT's local date, YYYY-MM-DD — see job-views.ts on why this is not server-derived. */
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** The dispatch board's window: jobs with a live visit in [visitFrom, visitTo], inclusive. */
  visitFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  visitTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine(requiresTodayWithView, todayRequired());
const listByLeadInput = z.object({
  leadId: z.string().uuid(),
  limit: z.number().int().positive().max(100).optional(),
  cursor: z.string().nullish(),
});

// Named input schemas for the manual-job mutation surface (exported so the store can
// reuse them for client-side validation without duplicating the bounds).
const kindInputEnum = z.enum(["work", "estimate"]);

export const createJobInput = z.object({
  id: z.string().uuid().optional(),
  leadId: z.string().uuid(),
  title: z.string().max(200).optional(),
  svc: z.string().min(1).max(60).optional(),
  addr: z.string().max(1000).optional(),
  phone: z.string().max(50).optional(),
  notes: z.string().max(10_000).optional(),
  // 'estimate' = a scoping visit, no price yet. The office modal used to encode this as
  // svc='estimate', squatting in the free-text trade-label column; kind is the enum built for it.
  kind: kindInputEnum.optional(),
  // Priced lines arriving WITH the create — a booked flat price the customer was already quoted.
  // Optional: absent → today's behavior (a zero-total job, no lines).
  lines: z
    .array(
      z.object({
        description: z.string().min(1),
        quantity: z.number().min(0),
        rateCents: z.number().int().min(0),
        costCents: z.number().int().min(0).optional(),
        taxable: z.boolean().optional(),
      }),
    )
    .max(200)
    .optional(),
});
// Before-you-leave checklist payload — bounds come from the domain constants
// (name ≤ 200, item text ≤ 500, ≤ 50 items — matched to the checklist TEMPLATE
// bounds so any valid template attaches). Exported for store-side reuse.
export const jobChecklistInput = z.object({
  name: z.string().min(1).max(JOB_CHECKLIST_NAME_MAX),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        text: z.string().min(1).max(JOB_CHECKLIST_ITEM_TEXT_MAX),
        type: z.enum(["check", "photo"]),
        required: z.boolean().default(false),
      }),
    )
    .max(JOB_CHECKLIST_MAX_ITEMS),
});
export const updateJobInput = z.object({
  jobId: z.string().uuid(),
  title: z.string().max(200).nullable().optional(),
  svc: z.string().min(1).max(60).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
  addr: z.string().max(1000).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  completion: z.string().max(2000).nullable().optional(),
  invRequested: z.boolean().optional(),
  // The office Type toggle: estimate ↔ flat rate. Terminal jobs still refuse (patchFields gate).
  kind: kindInputEnum.optional(),
  // undefined = keep; null = detach; object = attach/replace.
  checklist: jobChecklistInput.nullable().optional(),
});
export const archiveJobInput = z.object({ jobId: z.string().uuid() });

// ── Execution input schemas ───────────────────────────────────────────────────

const lineFields = {
  description: z.string().min(1).max(2000),
  quantity: z.number().min(0),
  rateCents: z.number().int().min(0),
  costCents: z.number().int().min(0),
  /** Omitted reads as TRUE — the column default and what every pre-taxability line meant. */
  taxable: z.boolean().optional(),
};
const addLineInput = z.object({ jobId: z.string().uuid(), id: z.string().uuid().optional(), ...lineFields, position: z.number().int().min(0).optional() });
const updateLineInput = z.object({ jobId: z.string().uuid(), lineId: z.string().uuid(), ...lineFields, position: z.number().int().min(0) });
const removeLineInput = z.object({ jobId: z.string().uuid(), lineId: z.string().uuid() });
const setLinesInput = z.object({
  jobId: z.string().uuid(),
  lines: z.array(z.object({ id: z.string().uuid().optional(), ...lineFields })).max(200),
});
const addAddonInput = z.object({ jobId: z.string().uuid(), id: z.string().uuid().optional(), description: z.string().min(1).max(2000), quantity: z.number().min(0).default(1), rateCents: z.number().int().min(0), costCents: z.number().int().min(0).default(0), isOptional: z.boolean().optional() });
const setAddonStatusInput = z.object({ jobId: z.string().uuid(), addonId: z.string().uuid(), status: z.enum(["proposed", "approved", "declined"]) });
const setAddonInvSkipInput = z.object({ jobId: z.string().uuid(), addonId: z.string().uuid(), invoiceSkip: z.boolean() });
// setVerifyAnswerInput moved to job-dto.ts — shared with the tech field-router.
const photoUploadUrlInput = z.object({ jobId: z.string().uuid(), objectId: z.string().uuid(), ext: z.string().min(1).max(10) });
const addPhotoInput = z.object({ jobId: z.string().uuid(), id: z.string().uuid().optional(), storagePath: z.string().min(1).max(1024), caption: z.string().max(2000).nullable().optional(), verifyPass: z.boolean().optional() });
const removePhotoInput = z.object({ jobId: z.string().uuid(), photoId: z.string().uuid() });

const photoUploadUrlDTO = z.object({ signedUrl: z.string(), token: z.string(), storagePath: z.string() });

// Layer 5: thin transport. Build org-scoped use-cases from the request's tx + ports, delegate,
// map the result. No business logic here.
export const createJobRouter = () =>
  router({
    scheduleDirect: ownerOrOffice
      .input(scheduleDirectInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ScheduleJobUseCase(repo, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec({
          orgId: ctx.principal.orgId,
          leadId: asLeadId(input.leadId),
          title: input.title ?? null,
          scheduledStart: input.scheduledStart ? new Date(input.scheduledStart) : null,
          scheduledEnd: input.scheduledEnd ? new Date(input.scheduledEnd) : null,
          assigneeUserId: input.assigneeUserId ? asUserId(input.assigneeUserId) : null,
        });
        return toJobDTOWithExecution(repo, orThrow(result));
      }),

    createFromEstimate: ownerOrOffice
      .input(fromEstimateInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const reader = new DrizzleEstimateReader(ctx.tx, ctx.principal.orgId);
        const useCase = new CreateJobFromEstimateUseCase(
          repo,
          reader,
          ctx.deps.bus,
          ctx.deps.clock,
          ctx.deps.ids,
        );
        return toJobDTOWithExecution(
          repo,
          orThrow(
            await useCase.exec({ orgId: ctx.principal.orgId, estimateId: asEstimateId(input.estimateId) }),
          ),
        );
      }),

    // Create a manual (unscheduled) job for a lead. addr/phone accepted for modal parity
    // but are not job columns — the use-case intentionally drops them.
    create: ownerOrOffice
      .input(createJobInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CreateManualJobUseCase(repo, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
        return toJobDTOWithExecution(
          repo,
          orThrow(
            await useCase.exec({
              id: input.id,
              orgId: ctx.principal.orgId,
              leadId: asLeadId(input.leadId),
              title: input.title ?? null,
              svc: input.svc ?? null,
              kind: input.kind,
              addr: input.addr ?? null,
              phone: input.phone ?? null,
              notes: input.notes ?? null,
              lines: input.lines,
            }),
          ),
        );
      }),

    get: ownerOrOffice
      .input(jobIdInput)
      .output(jobDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const job = await repo.findById(asJobId(input.jobId));
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
        return toJobDTOWithExecution(repo, job);
      }),

    list: ownerOrOffice
      .input(listInput)
      .output(paginatedSummaryDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const page = await new ListJobsUseCase(repo).exec({
          sort: input.sort,
          sortDir: input.sortDir,
          page: toPage({ limit: input.limit, cursor: input.cursor ?? null }),
          filter: {
            status: input.status,
            activeOnly: input.activeOnly,
            assigneeUserId: input.assigneeUserId ? asUserId(input.assigneeUserId) : undefined,
            search: input.search,
            view: input.view,
            today: input.today,
            visitFrom: input.visitFrom,
            visitTo: input.visitTo,
          },
        });
        // Resolve the page's customer names in ONE batched read. The list cannot look them up in
        // the store any more: leads hit the same page ceiling as jobs, so a paginated list would
        // render "—" for every customer past the first page. Same pattern as loadCustomersFor in
        // the field router — never a per-row query.
        const names = await new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId).findByIds(
          [...new Set(page.items.map((j) => j.props.leadId))],
        );
        const nameById = new Map<string, string>(names.map((l) => [String(l.props.id), l.props.name]));

        // Execution data for the whole page in one batched read. Without it toJobSummaryDTO
        // returns empty lines[], and the list's Amount column reads jobTotal() — which SUMS THE
        // LINES. That is why every row showed $0 while the jobs carried real prices: the money was
        // in the database and simply never fetched. The field router's myDay already does this
        // for the same reason.
        const execution = await repo.listExecutionForJobs(page.items.map((j) => j.props.id));
        return {
          items: page.items.map((j) =>
            toJobSummaryDTO(j, execution.get(j.props.id), nameById.get(j.props.leadId) ?? null),
          ),
          nextCursor: page.nextCursor,
        };
      }),

    /**
     * The TRUE number of jobs matching a filter.
     *
     * Separate from list on purpose. The list returns one page; the header needs the whole count,
     * and deriving it from a page is exactly the lie this fixes — the app was reporting
     * "220 of 220" against 1,521 real jobs because 220 was all it had ever loaded.
     *
     * Its own query so a caller can ask for the count without paying for the rows, and so the
     * count survives the client switching pages.
     */
    /**
     * Every scoped view's count, in one query.
     *
     * This is what makes the filter dropdown honest: "Needs a slot (13)" counts thirteen jobs in
     * the business, where the grouped list it replaces counted thirteen of whatever had loaded.
     */
    viewCounts: ownerOrOffice
      .input(
        z.object({
          today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          search: z.string().trim().min(1).max(200).optional(),
          assigneeUserId: z.string().uuid().optional(),
        }),
      )
            .output(
        z.object({
          counts: z.record(z.enum(JOB_VIEWS), z.number().int()),
          todayCents: z.number().int(),
          /** Dollars of won work with no slot, and of finished work with no invoice — in cents. */
          needsSlotCents: z.number().int(),
          needsInvoiceCents: z.number().int(),
        }),
      )
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        return repo.viewCounts(input.today, {
          search: input.search,
          assigneeUserId: input.assigneeUserId ? asUserId(input.assigneeUserId) : undefined,
        });
      }),

    count: ownerOrOffice
      .input(
        z
          .object({
            status: statusEnum.optional(),
            assigneeUserId: z.string().uuid().optional(),
            search: z.string().trim().min(1).max(200).optional(),
            /** Open jobs only — excludes complete and canceled. What the nav badge means. */
            activeOnly: z.boolean().optional(),
            /**
             * The same scoped view the list is showing.
             *
             * The header reads "50 of N", and N is only worth printing if it counts the set on
             * screen. Without these the count answered a DIFFERENT question from the rows beneath
             * it — the whole book, on every tab and every filter.
             */
            view: z.enum(JOB_VIEWS).optional(),
            today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          })
          .refine(requiresTodayWithView, todayRequired()),
      )
      .output(z.object({ total: z.number().int() }))
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        return {
          total: await repo.count({
            status: input.status,
            assigneeUserId: input.assigneeUserId ? asUserId(input.assigneeUserId) : undefined,
            search: input.search,
            activeOnly: input.activeOnly,
            view: input.view,
            today: input.today,
          }),
        };
      }),

    listByLead: ownerOrOffice
      .input(listByLeadInput)
      .output(paginatedSummaryDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const page = await repo.listByLead(
          asLeadId(input.leadId),
          toPage({ limit: input.limit, cursor: input.cursor ?? null }),
        );
        return { items: page.items.map((j) => toJobSummaryDTO(j)), nextCursor: page.nextCursor };
      }),

    schedule: ownerOrOffice
      .input(rescheduleInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new RescheduleJobUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toJobDTOWithExecution(
          repo,
          orThrow(
            await useCase.exec({
              jobId: asJobId(input.jobId),
              scheduledStart: new Date(input.scheduledStart),
              scheduledEnd: new Date(input.scheduledEnd),
            }),
          ),
        );
      }),

    assign: ownerOrOffice
      .input(assignInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new AssignJobUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toJobDTOWithExecution(
          repo,
          orThrow(
            await useCase.exec({
              jobId: asJobId(input.jobId),
              assigneeUserId: input.assigneeUserId ? asUserId(input.assigneeUserId) : null,
            }),
          ),
        );
      }),

    start: ownerOrOffice
      .input(jobIdInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new StartJobUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toJobDTOWithExecution(repo, orThrow(await useCase.exec({ jobId: asJobId(input.jobId) })));
      }),

    complete: ownerOrOffice
      .input(jobIdInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CompleteJobUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toJobDTOWithExecution(repo, orThrow(await useCase.exec({ jobId: asJobId(input.jobId) })));
      }),

    cancel: ownerOrOffice
      .input(cancelInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CancelJobUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toJobDTOWithExecution(
          repo,
          orThrow(await useCase.exec({ jobId: asJobId(input.jobId), reason: input.reason })),
        );
      }),

    // ── Job execution procedures ──────────────────────────────────────────────

    addLine: ownerOrOffice
      .input(addLineInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new AddJobLineUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const r = orThrow(
          await useCase.exec(
            { jobId: asJobId(input.jobId), id: input.id, description: input.description, quantity: input.quantity, rateCents: input.rateCents, costCents: input.costCents, taxable: input.taxable, position: input.position },
            ctx.principal.orgId,
          ),
        );
        return toJobDTO(r.job, r.execution);
      }),

    updateLine: ownerOrOffice
      .input(updateLineInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new UpdateJobLineUseCase(repo, ctx.deps.clock);
        const r = orThrow(
          await useCase.exec(
            { jobId: asJobId(input.jobId), lineId: input.lineId, description: input.description, quantity: input.quantity, rateCents: input.rateCents, costCents: input.costCents, taxable: input.taxable, position: input.position },
            ctx.principal.orgId,
          ),
        );
        return toJobDTO(r.job, r.execution);
      }),

    removeLine: ownerOrOffice
      .input(removeLineInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new RemoveJobLineUseCase(repo, ctx.deps.clock);
        const r = orThrow(await useCase.exec({ jobId: asJobId(input.jobId), lineId: input.lineId }, ctx.principal.orgId));
        return toJobDTO(r.job, r.execution);
      }),

    // Bulk-replace the job's lines in one atomic swap. On-site pricing (tech quote sign /
    // office price builder) builds a full line set at once, so it persists via one round-trip
    // that returns the reconciled full jobDTO rather than diffing add/update/remove.
    setLines: ownerOrOffice
      .input(setLinesInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SetJobLinesUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const r = orThrow(await useCase.exec({ jobId: asJobId(input.jobId), lines: input.lines }, ctx.principal.orgId));
        return toJobDTO(r.job, r.execution);
      }),

    addAddon: ownerOrOffice
      .input(addAddonInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new AddJobAddonUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const r = orThrow(
          await useCase.exec(
            { jobId: asJobId(input.jobId), id: input.id, description: input.description, quantity: input.quantity, rateCents: input.rateCents, costCents: input.costCents, isOptional: input.isOptional },
            ctx.principal.orgId,
          ),
        );
        return toJobDTO(r.job, r.execution);
      }),

    setAddonStatus: ownerOrOffice
      .input(setAddonStatusInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SetAddonStatusUseCase(repo, ctx.deps.clock);
        const r = orThrow(await useCase.exec({ jobId: asJobId(input.jobId), addonId: input.addonId, status: input.status }, ctx.principal.orgId));
        return toJobDTO(r.job, r.execution);
      }),

    setAddonInvSkip: ownerOrOffice
      .input(setAddonInvSkipInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SetAddonInvoiceSkipUseCase(repo, ctx.deps.clock);
        const r = orThrow(await useCase.exec({ jobId: asJobId(input.jobId), addonId: input.addonId, invoiceSkip: input.invoiceSkip }, ctx.principal.orgId));
        return toJobDTO(r.job, r.execution);
      }),

    setVerifyAnswer: ownerOrOffice
      .input(setVerifyAnswerInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new SetVerifyAnswerUseCase(repo, ctx.deps.clock);
        const r = orThrow(
          await useCase.exec(
            { jobId: asJobId(input.jobId), itemId: input.itemId, state: input.state, via: input.via ?? null, reason: input.reason ?? null },
            ctx.principal.orgId,
          ),
        );
        return toJobDTO(r.job, r.execution);
      }),

    photoUploadUrl: ownerOrOffice
      .input(photoUploadUrlInput)
      .output(photoUploadUrlDTO)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.deps.photoStorageGateway) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "photo storage is not configured" });
        }
        // Confirm the job exists in this org before minting an upload URL (fail-closed).
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const job = await repo.findById(asJobId(input.jobId));
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
        const result = await ctx.deps.photoStorageGateway.createUploadUrl({
          orgId: ctx.principal.orgId,
          jobId: asJobId(input.jobId),
          objectId: input.objectId,
          ext: input.ext,
        });
        if (!result.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: "could not create upload url" });
        return result.value;
      }),

    addPhoto: ownerOrOffice
      .input(addPhotoInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new AddJobPhotoUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const r = orThrow(
          await useCase.exec(
            { jobId: asJobId(input.jobId), id: input.id, storagePath: input.storagePath, caption: input.caption ?? null, verifyPass: input.verifyPass ?? false },
            ctx.principal.orgId,
          ),
        );
        return toJobDTO(r.job, r.execution);
      }),

    removePhoto: ownerOrOffice
      .input(removePhotoInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new RemoveJobPhotoUseCase(repo, ctx.deps.clock);
        const r = orThrow(await useCase.exec({ jobId: asJobId(input.jobId), photoId: input.photoId }, ctx.principal.orgId));
        return toJobDTO(r.job, r.execution);
      }),

    // Patch title/svc/notes/checklist on a non-terminal job. undefined fields are kept
    // as-is; explicit null clears an optional field. org isolation enforced by RLS via ctx.tx.
    update: ownerOrOffice
      .input(updateJobInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new UpdateJobUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toJobDTOWithExecution(
          repo,
          orThrow(
            await useCase.exec({
              jobId: asJobId(input.jobId),
              title: input.title,
              svc: input.svc,
              notes: input.notes,
              checklist: input.checklist,
              addr: input.addr,
              phone: input.phone,
              completion: input.completion,
              invRequested: input.invRequested,
              kind: input.kind,
            }),
          ),
        );
      }),

    // Soft-delete a job. Returns NOT_FOUND when the job is unknown or already archived.
    archive: ownerOrOffice
      .input(archiveJobInput)
      .output(z.object({ ok: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ArchiveJobUseCase(repo, ctx.deps.clock);
        return orThrow(await useCase.exec({ jobId: asJobId(input.jobId) }));
      }),

    callbackCandidates: ownerOrOffice
      .output(z.array(callbackCandidateDTO))
      .query(async ({ ctx }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ListCallbackCandidatesUseCase(repo, ctx.deps.clock);
        const result = await useCase.exec();
        return orThrow(result).map((v) => ({
          jobId: v.jobId,
          jobNum: v.jobNum,
          original: {
            jobId: v.original.jobId,
            num: v.original.num,
            svc: v.original.svc,
            completedAt: v.original.completedAt?.toISOString() ?? null,
          },
        }));
      }),

    confirmCallback: ownerOrOffice
      .input(z.object({ jobId: z.string().uuid(), originalJobId: z.string().uuid(), reason: callbackReasonEnum }))
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ConfirmCallbackUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toJobDTOWithExecution(repo, orThrow(await useCase.exec({ jobId: asJobId(input.jobId), originalJobId: asJobId(input.originalJobId), reason: input.reason })));
      }),

    dismissCallback: ownerOrOffice
      .input(z.object({ jobId: z.string().uuid() }))
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new DismissCallbackUseCase(repo, ctx.deps.bus, ctx.deps.clock);
        return toJobDTOWithExecution(repo, orThrow(await useCase.exec({ jobId: asJobId(input.jobId) })));
      }),

    callbackAutopsy: ownerOrOffice
      .output(z.array(autopsyClusterDTO))
      .query(async ({ ctx }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CallbackAutopsyUseCase(repo, ctx.deps.clock);
        const clusters = orThrow(await useCase.exec());
        // AutopsyCluster.originalNums is readonly; spread to satisfy the mutable DTO shape.
        return clusters.map((c) => ({ ...c, originalNums: [...c.originalNums] }));
      }),
  });
