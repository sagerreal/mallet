import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOffice, anyRole } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asTimeEntryId, asUserId, asJobId, toPage } from "@mallet/shared/types";
import type { OrgId } from "@mallet/shared/types";
import type { TenantTx } from "@mallet/shared/db/tx";
import { logger } from "@mallet/shared/observability";
import { DrizzleSettingsRepository } from "@mallet/settings";
import { DrizzleTimeEntryRepository } from "../infra/drizzle-time-entry-repository";
import { DrizzleWeekSubmissionRepository } from "../infra/drizzle-week-submission-repository";
import { DrizzleVisitStampsReader } from "../infra/drizzle-visit-stamps-reader";
import { DrizzleUnreportedDaysReader } from "../infra/drizzle-unreported-days-reader";
import { CreateTimeEntryUseCase } from "../app/create-time-entry";
import { ListTimeEntriesUseCase } from "../app/list-time-entries";
import { CountTimeEntriesUseCase } from "../app/count-time-entries";
import { TIMESHEET_SORTS } from "../infra/timesheet-sorts";
import { UpdateTimeEntryUseCase } from "../app/update-time-entry";
import { RemoveTimeEntryUseCase } from "../app/remove-time-entry";
import { ApproveWeekUseCase } from "../app/approve-week";
import { SetClockStateUseCase } from "../app/set-clock-state";
import { SubmitWeekUseCase, SUBMITTED_WEEK_MESSAGE } from "../app/submit-week";
import { RequestChangesUseCase } from "../app/request-changes";
import { weekStartOf } from "../domain/week-submission";
import type { ClockTap } from "../domain/clock";
import { timeEntryDTO, toTimeEntryDTO } from "./time-entry-dto";

const paginatedDTO = z.object({
  items: z.array(timeEntryDTO),
  nextCursor: z.string().nullable(),
});

const listInput = z.object({
  techUserId: z.string().uuid().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  limit: z.number().int().positive().max(500).optional(),
  cursor: z.string().nullish(),
  /** Named sort — never a column name. Absent means work date ascending. */
  sort: z.enum(TIMESHEET_SORTS).optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
});

const ENTRY_KINDS = ["job", "travel", "break", "shop", "pto", "vacation", "sick", "holiday"] as const;

const createInput = z.object({
  id: z.string().uuid().optional(),
  techUserId: z.string().uuid(),
  jobId: z.string().uuid().nullable().optional(),
  // The shape is enforced HERE because the value reaches weekStartOf (Date arithmetic) in the
  // edit guard — an unparseable string would surface as an uncaught RangeError, not a refusal.
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  kind: z.enum(ENTRY_KINDS),
  // Nullable since the time-off kinds — the domain's shape matrix decides what each kind needs.
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  minutes: z.number().int().nullable().optional(),
  note: z.string().optional(),
  src: z.enum(["manual", "clock", "timer"]).optional(),
  running: z.boolean().optional(),
});

const updateInput = z.object({
  entryId: z.string().uuid(),
  jobId: z.string().uuid().nullable().optional(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  kind: z.enum(ENTRY_KINDS).optional(),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  minutes: z.number().int().nullable().optional(),
  note: z.string().optional(),
  src: z.enum(["manual", "clock", "timer"]).optional(),
  running: z.boolean().optional(),
});

const removeInput = z.object({
  entryId: z.string().uuid(),
});

const approveWeekInput = z.object({
  techUserId: z.string().uuid(),
  dates: z.array(z.string()).min(1),
});

const reopenInput = z.object({
  entryId: z.string().uuid(),
});

/**
 * The DAY-level taps — the two-tap punch on My day, plus the break either side of lunch.
 *
 * The job-level taps (On my way / Arrived / Done) are deliberately absent: they name a job, and a
 * job tap must be gated by "is this job assigned to you" and written in the same transaction as the
 * visit. That is v1.field.*; routing them through here would hand a technician a way to file job
 * hours against a job they were never sent to.
 */
const DAY_CLOCK_TAPS = ["start_day", "break", "end_break", "end_day"] as const satisfies readonly ClockTap[];

const clockTapInput = z.object({
  tap: z.enum(DAY_CLOCK_TAPS),
  /**
   * When the tap happened, per the DEVICE. A tap made in a crawlspace with no signal is retried
   * when the van reaches the road, and the original moment is the one that should be recorded.
   * Never trusted: the domain bounds it against server time in both directions before it becomes
   * hours, so a wrong phone clock cannot backdate a payroll record.
   */
  at: z.string().datetime(),
});

/**
 * What the caller's clock is doing now: the single running entry, or null when they are off the
 * clock. Every clock endpoint answers with this same shape so the client has exactly one thing to
 * render and no way to drift from the database.
 */
const clockStateDTO = z.object({
  open: timeEntryDTO.nullable(),
});

const weekSubmissionDTO = z.object({
  /** Whose attestation this is. Single-tech callers already know; the crew list has to be told. */
  techUserId: z.string(),
  weekStart: z.string(),
  submittedAt: z.string(),
  reopenedAt: z.string().nullable(),
  reopenReason: z.string().nullable(),
});

const toWeekSubmissionDTO = (sub: import("../domain/week-submission").WeekSubmission) => ({
  techUserId: sub.props.techUserId,
  weekStart: sub.props.weekStart,
  submittedAt: sub.props.submittedAt.toISOString(),
  reopenedAt: sub.props.reopenedAt ? sub.props.reopenedAt.toISOString() : null,
  reopenReason: sub.props.reopenReason,
});

/**
 * The tech-edit boundary, phrased ONCE so create/update/remove cannot drift.
 *
 * Office callers pass untouched. A tech caller is refused when the org keeps hand edits off
 * (the HCP model — the clock and the visit taps are the field's only writers), or when any
 * touched week is already SUBMITTED (the attestation is with the office; the clock path is
 * exempt and reopens the submission instead — see SetClockStateUseCase).
 */
async function assertTechMayEditTimes(
  ctx: { tx: TenantTx; principal: { role: string; userId: string; orgId: OrgId } },
  workDates: readonly string[],
): Promise<void> {
  if (ctx.principal.role !== "tech") return;
  const allowed = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getTechEditsTimes();
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Hand edits are off for technicians on this account — ask the office to change the hours.",
    });
  }
  const submissions = new DrizzleWeekSubmissionRepository(ctx.tx, ctx.principal.orgId);
  const weeks = [...new Set(workDates.map(weekStartOf))];
  for (const weekStart of weeks) {
    const sub = await submissions.findFor(asUserId(ctx.principal.userId), weekStart);
    if (sub !== null && sub.isActive()) {
      throw new TRPCError({ code: "CONFLICT", message: SUBMITTED_WEEK_MESSAGE });
    }
  }
}

// Layer 5: thin transport. Parse/normalize input, construct the org-scoped use-case from the
// request's tx + ports, delegate, map the result. No business logic lives here except the
// own-entry authz guard (tech may only touch their own entries; owner/office may touch any).
export const createTimesheetRouter = () =>
  router({
    /**
     * Days somebody evidently worked and sent in no hours — the one timesheet gap worth
     * interrupting anyone about.
     *
     * A hole INSIDE a day is usually correct (they got off the clock), and flagging correct
     * behaviour teaches people to ignore the flag. Visits stamped to somebody on a day with no
     * time entry at all is different: they were on jobs and their paycheck is short.
     *
     * Read-only, and it never writes the day it suggests. Inventing hours on a worker's behalf is
     * how a timesheet stops being their own statement of what they did.
     */
    unreportedDays: anyRole
      .input(
        z.object({
          fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          techUserId: z.string().uuid().optional(),
        }),
      )
      .output(
        z.object({
          items: z.array(
            z.object({
              userId: z.string().uuid(),
              date: z.string(),
              visits: z.number().int(),
              // ISO instants — the device renders the wall clock. See the reader.
              firstStampAt: z.string().nullable(),
              lastStampAt: z.string().nullable(),
            }),
          ),
        }),
      )
      .query(async ({ ctx, input }) => {
        // Same guard as `list`, and for the same reason: a tech asking about a colleague's missing
        // days is asking about a colleague's pay.
        const scoped =
          ctx.principal.role === "tech"
            ? asUserId(ctx.principal.userId)
            : input.techUserId
              ? asUserId(input.techUserId)
              : undefined;
        const reader = new DrizzleUnreportedDaysReader(ctx.tx, ctx.principal.orgId);
        return { items: await reader.find(input.fromDate, input.toDate, scoped) };
      }),

    /**
     * What this person's hours were SPENT ON — their visit taps for a date range, job by job.
     *
     * A different question from `list`, and deliberately a different read: `list` returns the CLOCK
     * (what he is paid for) and this returns ATTRIBUTION (which jobs the time went to). They do not
     * have to agree — drive time between calls is paid and belongs to no job — so joining them into
     * one endpoint would invite exactly the reconciliation this model rejects.
     */
    visitStamps: anyRole
      .input(
        z.object({
          fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          techUserId: z.string().uuid().optional(),
        }),
      )
      .output(
        z.object({
          items: z.array(
            z.object({
              visitId: z.string().uuid(),
              jobId: z.string().uuid(),
              jobNum: z.string(),
              jobTitle: z.string().nullable(),
              customerName: z.string().nullable(),
              workDate: z.string(),
              // INSTANTS, not wall clocks: the device renders them in the technician's own
              // timezone. Rendering them in SQL puts them in the database's, which is nobody's.
              startedAt: z.string().nullable(),
              completedAt: z.string().nullable(),
            }),
          ),
        }),
      )
      .query(async ({ ctx, input }) => {
        // Same guard as `list` and `unreportedDays`: a tech asking which jobs a COLLEAGUE was on is
        // asking about a colleague's day, so the answer is always their own.
        const scoped =
          ctx.principal.role === "tech"
            ? asUserId(ctx.principal.userId)
            : input.techUserId
              ? asUserId(input.techUserId)
              : asUserId(ctx.principal.userId);
        const reader = new DrizzleVisitStampsReader(ctx.tx, ctx.principal.orgId);
        return { items: await reader.find(input.fromDate, input.toDate, scoped) };
      }),

    list: anyRole
      .input(listInput)
      .output(paginatedDTO)
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleTimeEntryRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ListTimeEntriesUseCase(repo);

        // Tech callers may only list their own entries; override any techUserId they passed.
        const techUserId =
          ctx.principal.role === "tech"
            ? asUserId(ctx.principal.userId)
            : input.techUserId
              ? asUserId(input.techUserId)
              : undefined;

        const result = await useCase.exec({
          filter: {
            techUserId,
            fromDate: input.fromDate,
            toDate: input.toDate,
          },
          page: toPage({ limit: input.limit, cursor: input.cursor ?? null }),
          sort: input.sort,
          sortDir: input.sortDir,
        });
        return { items: result.items.map(toTimeEntryDTO), nextCursor: result.nextCursor };
      }),

    /**
     * How many entries match — the whole set, not a page of it.
     *
     * The office panel shows ONE WEEK. Without this it could only ask "did the week I fetched come
     * back empty", which is also true of a shop that simply did not work that week, so navigating
     * to a quiet week showed the never-set-this-up screen to a shop with months of history.
     *
     * Same tech override as `list`: a technician counts their own entries and nobody else's.
     */
    count: anyRole
      .input(listInput.pick({ techUserId: true, fromDate: true, toDate: true }))
      .output(z.object({ total: z.number().int() }))
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleTimeEntryRepository(ctx.tx, ctx.principal.orgId);
        const techUserId =
          ctx.principal.role === "tech"
            ? asUserId(ctx.principal.userId)
            : input.techUserId
              ? asUserId(input.techUserId)
              : undefined;

        const total = await new CountTimeEntriesUseCase(repo).exec({
          filter: { techUserId, fromDate: input.fromDate, toDate: input.toDate },
        });
        return { total };
      }),

    /**
     * The caller's own running entry, or null. Takes no input ON PURPOSE: a clock belongs to the
     * person holding the phone, so there is no id to pass and therefore nothing to forge.
     *
     * This is the whole state of the day row on My day, and it is why that row survives a reload —
     * the previous version kept it in React state and lost it on every refresh.
     */
    open: anyRole
      .output(clockStateDTO)
      .query(async ({ ctx }) => {
        const repo = new DrizzleTimeEntryRepository(ctx.tx, ctx.principal.orgId);
        const entry = await repo.findOpenForTech(asUserId(ctx.principal.userId));
        return { open: entry === null ? null : toTimeEntryDTO(entry) };
      }),

    create: anyRole
      .input(createInput)
      .output(timeEntryDTO)
      .mutation(async ({ ctx, input }) => {
        // Tech may only create entries for themselves.
        if (ctx.principal.role === "tech" && input.techUserId !== ctx.principal.userId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "techs may only create their own time entries" });
        }
        await assertTechMayEditTimes(ctx, [input.workDate]);

        const repo = new DrizzleTimeEntryRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CreateTimeEntryUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec(
          {
            id: input.id,
            techUserId: asUserId(input.techUserId),
            jobId: input.jobId ? asJobId(input.jobId) : null,
            workDate: input.workDate,
            kind: input.kind,
            startTime: input.startTime ?? null,
            endTime: input.endTime ?? null,
            minutes: input.minutes ?? null,
            note: input.note ?? "",
            src: input.src ?? "manual",
            running: input.running ?? false,
            // Every row through this endpoint was typed by SOMEBODY's hand — sign it.
            editedBy: asUserId(ctx.principal.userId),
          },
          ctx.principal.orgId,
        );
        return toTimeEntryDTO(orThrow(result));
      }),

    update: anyRole
      .input(updateInput)
      .output(timeEntryDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleTimeEntryRepository(ctx.tx, ctx.principal.orgId);
        // Load first to authz-check ownership.
        const entry = await repo.findById(asTimeEntryId(input.entryId));
        if (!entry) {
          throw new TRPCError({ code: "NOT_FOUND", message: "time entry not found" });
        }
        // Tech may only edit their own entries.
        if (ctx.principal.role === "tech" && entry.props.techUserId !== ctx.principal.userId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "techs may only edit their own time entries" });
        }
        // BOTH weeks: the one the row sits in and the one it may be moving to — moving a row
        // out of a submitted week is as much an edit of that week as changing its hours.
        await assertTechMayEditTimes(
          ctx,
          input.workDate !== undefined
            ? [entry.props.workDate, input.workDate]
            : [entry.props.workDate],
        );

        const useCase = new UpdateTimeEntryUseCase(repo, ctx.deps.clock);
        const result = await useCase.exec(
          {
            entryId: asTimeEntryId(input.entryId),
            jobId: input.jobId !== undefined ? (input.jobId ? asJobId(input.jobId) : null) : undefined,
            workDate: input.workDate,
            kind: input.kind,
            startTime: input.startTime,
            endTime: input.endTime,
            minutes: input.minutes,
            note: input.note,
            src: input.src,
            running: input.running,
            editedBy: asUserId(ctx.principal.userId),
          },
          ctx.principal.orgId,
        );
        return toTimeEntryDTO(orThrow(result));
      }),

    remove: anyRole
      .input(removeInput)
      .output(z.object({ ok: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleTimeEntryRepository(ctx.tx, ctx.principal.orgId);
        // Load first to authz-check ownership.
        const entry = await repo.findById(asTimeEntryId(input.entryId));
        if (!entry) {
          throw new TRPCError({ code: "NOT_FOUND", message: "time entry not found" });
        }
        // Tech may only remove their own entries.
        if (ctx.principal.role === "tech" && entry.props.techUserId !== ctx.principal.userId) {
          throw new TRPCError({ code: "FORBIDDEN", message: "techs may only remove their own time entries" });
        }
        await assertTechMayEditTimes(ctx, [entry.props.workDate]);

        const useCase = new RemoveTimeEntryUseCase(repo, ctx.deps.clock);
        const result = await useCase.exec(
          { entryId: asTimeEntryId(input.entryId) },
          ctx.principal.orgId,
        );
        return orThrow(result);
      }),

    // Reopen is a management action — ownerOrOffice only. Symmetric with approveWeek.
    reopen: ownerOrOffice
      .input(reopenInput)
      .output(timeEntryDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleTimeEntryRepository(ctx.tx, ctx.principal.orgId);
        const entry = await repo.findById(asTimeEntryId(input.entryId));
        if (!entry) {
          throw new TRPCError({ code: "NOT_FOUND", message: "time entry not found" });
        }
        const reopened = entry.reopen(ctx.deps.clock.now());
        await repo.save(reopened);
        logger.info(
          { entryId: input.entryId, orgId: ctx.principal.orgId },
          "time_entry.reopened",
        );
        return toTimeEntryDTO(reopened);
      }),

    /**
     * The technician signs a week off. Self-scoped by construction — the CALLER is the only
     * tech a submit can name, so there is nothing to forge. Idempotent via the unique
     * (org, tech, week); refused only while the caller's clock is running.
     */
    submitWeek: anyRole
      .input(
        z.object({
          // A Monday, checked at the BOUNDARY. The domain enforces it too, but claim() only
          // reaches the domain through the mapper AFTER the INSERT — so a mid-week date used to
          // land a row and then throw "corrupt timesheet_submission".
          weekStart: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .refine((d) => weekStartOf(d) === d, "weekStart must be a Monday"),
        }),
      )
      .output(weekSubmissionDTO)
      .mutation(async ({ ctx, input }) => {
        const useCase = new SubmitWeekUseCase(
          new DrizzleWeekSubmissionRepository(ctx.tx, ctx.principal.orgId),
          new DrizzleTimeEntryRepository(ctx.tx, ctx.principal.orgId),
          ctx.deps.clock,
          ctx.deps.ids,
        );
        const result = await useCase.exec(
          { techUserId: asUserId(ctx.principal.userId), weekStart: input.weekStart },
          ctx.principal.orgId,
        );
        return toWeekSubmissionDTO(orThrow(result));
      }),

    /**
     * The caller's own attestation for one week, or null — what the Submit button renders from.
     * Office callers may ask about any tech (the review chip); techs are pinned to themselves.
     */
    submissionFor: anyRole
      .input(
        z.object({
          weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          techUserId: z.string().uuid().optional(),
        }),
      )
      .output(z.object({ submission: weekSubmissionDTO.nullable() }))
      .query(async ({ ctx, input }) => {
        const techUserId =
          ctx.principal.role === "tech"
            ? asUserId(ctx.principal.userId)
            : asUserId(input.techUserId ?? ctx.principal.userId);
        const repo = new DrizzleWeekSubmissionRepository(ctx.tx, ctx.principal.orgId);
        const sub = await repo.findFor(techUserId, input.weekStart);
        return { submission: sub === null ? null : toWeekSubmissionDTO(sub) };
      }),

    /**
     * Hand a submitted week back to the technician, with a reason.
     *
     * ownerOrOffice: retracting somebody's sign-off is a management act. The alternative the office
     * had was editing his hours for him, which changes his pay without him seeing it.
     */
    requestChanges: ownerOrOffice
      .input(
        z.object({
          techUserId: z.string().uuid(),
          weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          reason: z.string().min(1).max(300),
        }),
      )
      .output(z.object({ reopened: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const uc = new RequestChangesUseCase(
          new DrizzleWeekSubmissionRepository(ctx.tx, ctx.principal.orgId),
          ctx.deps.clock,
        );
        return orThrow(await uc.exec(input, ctx.principal.orgId));
      }),

    /**
     * Every technician's attestation for ONE week — the crew grid's Status column.
     *
     * ownerOrOffice only: this is the whole crew's state, which is a management view. A tech asking
     * about their own week still uses submissionFor above, where the role pins them to themselves.
     */
    submissionsForWeek: ownerOrOffice
      .input(z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
      .output(z.object({ submissions: z.array(weekSubmissionDTO) }))
      .query(async ({ ctx, input }) => {
        const repo = new DrizzleWeekSubmissionRepository(ctx.tx, ctx.principal.orgId);
        const subs = await repo.findForWeek(input.weekStart);
        return { submissions: subs.map(toWeekSubmissionDTO) };
      }),

    // Approval is a management action — ownerOrOffice only.
    approveWeek: ownerOrOffice
      .input(approveWeekInput)
      .output(z.object({ approved: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleTimeEntryRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new ApproveWeekUseCase(repo, ctx.deps.clock, ctx.deps.bus);
        const result = await useCase.exec(
          {
            techUserId: asUserId(input.techUserId),
            dates: input.dates,
          },
          ctx.principal.orgId,
        );
        return orThrow(result);
      }),
  });
