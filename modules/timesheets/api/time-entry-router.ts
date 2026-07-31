import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, ownerOrOffice, anyRole } from "@/trpc/init";
import { orThrow } from "@/trpc/errors";
import { asTimeEntryId, asUserId, asJobId, toPage } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { DrizzleSettingsRepository } from "@mallet/settings";
import { DrizzleTimeEntryRepository } from "../infra/drizzle-time-entry-repository";
import { CreateTimeEntryUseCase } from "../app/create-time-entry";
import { ListTimeEntriesUseCase } from "../app/list-time-entries";
import { CountTimeEntriesUseCase } from "../app/count-time-entries";
import { TIMESHEET_SORTS } from "../infra/timesheet-sorts";
import { UpdateTimeEntryUseCase } from "../app/update-time-entry";
import { RemoveTimeEntryUseCase } from "../app/remove-time-entry";
import { ApproveWeekUseCase } from "../app/approve-week";
import { SetClockStateUseCase } from "../app/set-clock-state";
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

const createInput = z.object({
  id: z.string().uuid().optional(),
  techUserId: z.string().uuid(),
  jobId: z.string().uuid().nullable().optional(),
  workDate: z.string().min(1),
  kind: z.enum(["job", "travel", "break", "shop"]),
  startTime: z.string().min(1),
  endTime: z.string().nullable().optional(),
  note: z.string().optional(),
  src: z.enum(["manual", "clock", "timer"]).optional(),
  running: z.boolean().optional(),
});

const updateInput = z.object({
  entryId: z.string().uuid(),
  jobId: z.string().uuid().nullable().optional(),
  workDate: z.string().optional(),
  kind: z.enum(["job", "travel", "break", "shop"]).optional(),
  startTime: z.string().optional(),
  endTime: z.string().nullable().optional(),
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

// Layer 5: thin transport. Parse/normalize input, construct the org-scoped use-case from the
// request's tx + ports, delegate, map the result. No business logic lives here except the
// own-entry authz guard (tech may only touch their own entries; owner/office may touch any).
export const createTimesheetRouter = () =>
  router({
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

    /**
     * One day-level clock tap: Start day, Break, End break, End day.
     *
     * Unlike the clock tap that rides along with a visit write (which is swallowed rather than
     * allowed to fail a dispatch action), this tap IS the user's action. A refusal must reach them:
     * the button rolls back and says so, because a technician who thinks he clocked in and did not
     * is the exact failure this feature exists to prevent.
     */
    clockTap: anyRole
      .input(clockTapInput)
      .output(clockStateDTO)
      .mutation(async ({ ctx, input }) => {
        const orgId = ctx.principal.orgId;
        // The clock records the hours of the person tapping — never an id from the wire. An owner
        // who also runs calls punches his own clock here, exactly as a tech does.
        const techUserId = asUserId(ctx.principal.userId);
        const repo = new DrizzleTimeEntryRepository(ctx.tx, orgId);
        // The shop's zone is read HERE and injected: timesheets must not import the settings
        // module's domain, and a wrong zone files a plumber's evening on tomorrow's sheet, so it
        // belongs where it can be seen being passed in.
        const timeZone = await new DrizzleSettingsRepository(ctx.tx, orgId).getTimezone();
        const useCase = new SetClockStateUseCase(repo, ctx.deps.clock, ctx.deps.ids, timeZone);

        orThrow(
          await useCase.exec(
            { techUserId, tap: input.tap, jobId: null, at: new Date(input.at) },
            orgId,
          ),
        );

        // Re-read rather than reporting the plan's own `opened`: that is null both for End day and
        // for a no-op double tap, and a client told "null" after a double-tapped Break would show
        // the technician as off the clock while the database has him running.
        const entry = await repo.findOpenForTech(techUserId);
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

        const repo = new DrizzleTimeEntryRepository(ctx.tx, ctx.principal.orgId);
        const useCase = new CreateTimeEntryUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const result = await useCase.exec(
          {
            id: input.id,
            techUserId: asUserId(input.techUserId),
            jobId: input.jobId ? asJobId(input.jobId) : null,
            workDate: input.workDate,
            kind: input.kind,
            startTime: input.startTime,
            endTime: input.endTime ?? null,
            note: input.note ?? "",
            src: input.src ?? "manual",
            running: input.running ?? false,
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

        const useCase = new UpdateTimeEntryUseCase(repo, ctx.deps.clock);
        const result = await useCase.exec(
          {
            entryId: asTimeEntryId(input.entryId),
            jobId: input.jobId !== undefined ? (input.jobId ? asJobId(input.jobId) : null) : undefined,
            workDate: input.workDate,
            kind: input.kind,
            startTime: input.startTime,
            endTime: input.endTime,
            note: input.note,
            src: input.src,
            running: input.running,
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
