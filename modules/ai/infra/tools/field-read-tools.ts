// Field copilot read-only tool registry.
//
// Design: each tool is closed over a verified { orgId, jobId, seesPrice } triple — the
// model never supplies ids. The factory `buildFieldTools(deps)` returns plain ToolMeta +
// ExecuteTool pairs so the B3 router can wire them with per-call withTenant tx.
//
// MONEY RULES (enforced here, not by the model):
//  - cost is NEVER present (always stripped by redactMoneyForTech)
//  - rate is present only when seesPrice === true
//  - total is NEVER present in get_my_job output (stripped after redaction)
//  - ballpark is NEVER present in get_org_service_context (owner-spoken price)
//  - price / serviceFee NEVER present in get_org_service_context
//
// FOUND WORK marker contract (one place, read by PR3 UI parser):
//   A copilot reply MAY end with exactly one line:
//     FOUND WORK: {description}
//   - one per reply max
//   - description ≤ 80 chars
//   - description must NOT include prices when seesPrice === false
//   The system prompt enforces this; this file documents it as the canonical reference.

import { z } from "zod";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId, JobId, UserId } from "@mallet/shared/types";
import { asJobId, toPage } from "@mallet/shared/types";
import type { ToolMeta } from "../../app/run-agent-turn";
import type { ToolOutcome } from "../../domain/tool";
import { jsonSchema, invalid } from "./shared";
import { DrizzleJobRepository } from "@mallet/jobs";
import { DrizzleSettingsRepository } from "@mallet/settings";
import { toJobSummaryDTO } from "@mallet/jobs";
// Deep imports, deliberately — same reason the redaction helper below is one. The `@mallet/customers`
// barrel re-exports its tRPC router, which pulls the config validator and throws in a unit test
// with no DB env. These three files are pure app/api logic with no transport in their import graph.
import { DrizzleLeadRepository } from "../../../customers/infra/drizzle-lead-repository";
import { ListJobsUseCase } from "../../../jobs/app/list-jobs";
import { byVisitOn } from "../../../jobs/api/my-day-order";
import { redactMoneyForTech } from "../../../jobs/api/money-redaction";
import type { BookingService } from "@mallet/settings";
import type { JobChecklistProps } from "../../../jobs/domain/job";

// ---------------------------------------------------------------------------
// Closure scope — the B3 router resolves these before building tools
// ---------------------------------------------------------------------------

export interface FieldToolScope {
  readonly orgId: OrgId;
  readonly jobId: JobId;
  /** true when the org's techSeesPrice setting is on — already resolved before buildFieldTools */
  readonly seesPrice: boolean;
  /** The caller. get_my_day is scoped to THEIR route — never the shop's whole book. */
  readonly userId: UserId;
  /**
   * The caller's own calendar date, `YYYY-MM-DD`, sent by the client.
   *
   * "Today" is a statement about where the van is, and there is no org timezone column for the
   * server to reproduce it — the same reasoning as myDayInput's client-supplied instants. A tech
   * in PDT at 6pm is already on tomorrow's date in UTC, so deriving this from the server clock
   * would answer the wrong day for the entire evening.
   */
  readonly today: string;
}

// Deps the tools need: tx factories per call (mirrors the NoTx pattern in ai-router).
// The B3 router passes `withTenant(orgId, tx => ...)` as the runner.
export interface FieldToolDeps {
  /** Run a short tenant-scoped transaction for one tool call. */
  readonly withTx: <T>(orgId: OrgId, fn: (tx: TenantTx) => Promise<T>) => Promise<T>;
}

// ---------------------------------------------------------------------------
// Return type of buildFieldTools
// ---------------------------------------------------------------------------

export interface FieldTool {
  readonly meta: ToolMeta;
  readonly execute: (input: unknown) => Promise<ToolOutcome>;
}

// ---------------------------------------------------------------------------
// Input schemas (model supplies near-zero args — all closure-scoped)
// ---------------------------------------------------------------------------

const noInput = z.object({});

/** The one tool that takes an argument: which day. Absent means the caller's own today. */
const myDayInput = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "expected a YYYY-MM-DD date")
    .optional()
    .describe("The day to read, YYYY-MM-DD. Omit for today."),
});

/** One page IS the agenda — a day with more stops than this is not a day one person drives. */
const AGENDA_LIMIT = 100;

/** The day pager's reach, measured from the CALLER's today rather than a server clock. */
const AGENDA_REACH_DAYS = 15;
const MS_PER_DAY = 86_400_000;

/**
 * Whether a `YYYY-MM-DD` date is close enough to the caller's own today to be a real question.
 *
 * Impossible-but-well-formed dates ("2026-02-30") roll over in the Date constructor; the
 * round-trip check rejects them rather than admitting them through a NaN comparison.
 */
const withinAgendaReach = (date: string, today: string): boolean => {
  const parsed = new Date(`${date}T00:00:00Z`);
  const ref = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || Number.isNaN(ref.getTime())) return false;
  if (parsed.toISOString().slice(0, 10) !== date) return false;
  return Math.abs(parsed.getTime() - ref.getTime()) / MS_PER_DAY <= AGENDA_REACH_DAYS;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noArgs = jsonSchema(noInput);

/** Strip storagePaths from photos — metadata only (caption, verifyPass, position). */
const stripPhotoPaths = (
  photos: Array<{ id: string; storagePath: string; caption: string | null; verifyPass: boolean; position: number }>,
): Array<{ id: string; caption: string | null; verifyPass: boolean; position: number }> =>
  photos.map(({ id, caption, verifyPass, position }) => ({ id, caption, verifyPass, position }));

/** Build a redacted job summary for the copilot — no total, no paths, no cost, no rate when !seesPrice. */
const buildRedactedJobContext = (
  dto: ReturnType<typeof toJobSummaryDTO>,
  seesPrice: boolean,
): Record<string, unknown> => {
  const redacted = redactMoneyForTech(dto, seesPrice);
  // Strip total entirely — the copilot has no use for it even when seesPrice=true.
  // It's already null for !seesPrice techs but we always exclude it from the field context.
  const { total: _total, photos, ...rest } = redacted;
  return {
    ...rest,
    photos: stripPhotoPaths(photos),
  };
};

/** Summarise a checklist's missed steps (items with no "pass" answer) for callback context. */
const findMissedSteps = (
  checklist: JobChecklistProps,
  verifyAnswers: Array<{ itemId: string; state: string }>,
): string[] => {
  const passed = new Set(
    verifyAnswers.filter((a) => a.state === "pass").map((a) => a.itemId),
  );
  return checklist.items
    .filter((item) => !passed.has(item.id))
    .map((item) => item.text);
};

// ---------------------------------------------------------------------------
// Tool 1: get_my_job
// ---------------------------------------------------------------------------

const buildGetMyJobTool = (scope: FieldToolScope, deps: FieldToolDeps): FieldTool => ({
  meta: {
    name: "get_my_job",
    description:
      "Returns the full context for the tech's current job: checklist items and answers, scope and notes, lines and add-ons (descriptions and rates when visible), visits, photos metadata (caption and pass/fail — no storage paths), callback reason, and required certifications. Call this first to ground your advice in what was sold and what the office expects.",
    inputSchema: noArgs,
    mutating: false,
  },
  execute: async (input) => {
    const parsed = noInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);

    return deps.withTx(scope.orgId, async (tx) => {
      const repo = new DrizzleJobRepository(tx, scope.orgId);
      const job = await repo.findById(scope.jobId);
      if (!job) return { ok: false as const, error: "job not found" };

      const execution = await repo.listExecution(scope.jobId);
      const dto = toJobSummaryDTO(job, execution);
      const context = buildRedactedJobContext(dto, scope.seesPrice);

      return { ok: true as const, summary: JSON.stringify(context) };
    });
  },
});

// ---------------------------------------------------------------------------
// Tool 2: get_org_service_context
// ---------------------------------------------------------------------------

/** Safe service view — name/lane/triggers/emergencyTriggers/requiredCerts only. NO price/ballpark/serviceFee. */
const toSafeServiceView = (
  svc: BookingService,
): Record<string, unknown> => ({
  name: svc.name,
  lane: svc.lane,
  // A boolean, not an owner-spoken amount, so the price-redaction rationale below does not cover
  // it — and without it a fee visit and a free estimate are indistinguishable to the field AI.
  ...(svc.feeApplies ? { feeApplies: true } : {}),
  triggers: svc.triggers,
  ...(svc.emergencyTriggers ? { emergencyTriggers: svc.emergencyTriggers } : {}),
  ...(svc.requiredCerts && svc.requiredCerts.length > 0
    ? { requiredCerts: [...svc.requiredCerts] }
    : {}),
  // price, ballpark, serviceFee intentionally excluded — owner-spoken values must not reach tech transcript
});

const buildGetOrgServiceContextTool = (scope: FieldToolScope, deps: FieldToolDeps): FieldTool => ({
  meta: {
    name: "get_org_service_context",
    description:
      "Returns the org's configured booking services — name, lane (estimate/flat, estimate optionally with feeApplies), trigger phrases, emergency triggers, and required certifications. No prices or ballparks. Use this to understand what services this org offers, which situations trigger which service type, and what credentials a tech must have for each service.",
    inputSchema: noArgs,
    mutating: false,
  },
  execute: async (input) => {
    const parsed = noInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);

    return deps.withTx(scope.orgId, async (tx) => {
      const repo = new DrizzleSettingsRepository(tx, scope.orgId);
      const settings = await repo.getConfig(scope.orgId, () => ({
        services: [],
        notServices: "",
        serviceFee: 89,
        feeCredited: true,
      }));

      const services = settings.props.booking.services.map(toSafeServiceView);

      if (services.length === 0) {
        return { ok: true as const, summary: "No services configured for this org." };
      }

      return { ok: true as const, summary: JSON.stringify({ services }) };
    });
  },
});

// ---------------------------------------------------------------------------
// Tool: get_my_day — the caller's own route for a named day
// ---------------------------------------------------------------------------

/**
 * A stop, as the model should read it. Deliberately NOT the job DTO: the agenda question is
 * "where am I going and what is it", and a full summary per stop would spend the context window
 * on checklist answers and photo metadata for jobs the tech has not opened.
 *
 * Money follows the same rule as everywhere else — the total rides only when seesPrice is on.
 */
const toAgendaStop = (
  dto: ReturnType<typeof toJobSummaryDTO>,
  seesPrice: boolean,
): Record<string, unknown> => {
  // The stop's own clock. `scheduledStart` is a wall-clock HH:MM on `scheduledDate` — the board's
  // grammar — so it needs no timezone conversion to be read back to the person driving there.
  const next = (dto.visits ?? []).find((v) => v.status !== "canceled");
  return {
    num: dto.num,
    title: dto.title,
    customer: dto.customerName ?? null,
    address: dto.addr ?? null,
    status: dto.status,
    ...(next?.scheduledStart ? { scheduledStart: next.scheduledStart } : {}),
    ...(next?.durationMinutes ? { durationMinutes: next.durationMinutes } : {}),
    ...(seesPrice && dto.total ? { total: dto.total } : {}),
  };
};

const buildGetMyDayTool = (scope: FieldToolScope, deps: FieldToolDeps): FieldTool => ({
  meta: {
    name: "get_my_day",
    description:
      "Returns the CALLER'S OWN route for one day: each stop's job number, title, customer, address, scheduled time and status, earliest first. Defaults to today. Pass a YYYY-MM-DD date for another day (tomorrow, yesterday, a named weekday) within about two weeks either side. Use this for any question about what work the tech has, where they are going, how many stops are left, or what is next.",
    inputSchema: jsonSchema(myDayInput),
    mutating: false,
  },
  execute: async (input) => {
    const parsed = myDayInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);

    const date = parsed.data.date ?? scope.today;
    // A model-supplied date is client input: bound it, or "what did I do last year" becomes a
    // scan of the shop's whole history. The caller's own `today` is the reference point.
    if (!withinAgendaReach(date, scope.today)) {
      return {
        ok: false as const,
        error: `${date} is out of reach — this covers about two weeks either side of ${scope.today}.`,
      };
    }

    return deps.withTx(scope.orgId, async (tx) => {
      const repo = new DrizzleJobRepository(tx, scope.orgId);
      const page = await new ListJobsUseCase(repo).exec({
        page: toPage({ limit: AGENDA_LIMIT, cursor: null }),
        // The board's own predicate, narrowed to one date and to THIS caller. excludeCanceled
        // closes the visit-outlives-its-job gap — a called-off job is not a stop.
        filter: {
          assignedUserId: scope.userId,
          visitFrom: date,
          visitTo: date,
          excludeCanceled: true,
        },
      });

      if (page.items.length === 0) {
        return {
          ok: true as const,
          summary: `No stops scheduled for ${date}${date === scope.today ? " (today)" : ""}.`,
        };
      }

      const ordered = [...page.items].sort(byVisitOn(date));
      const jobIds = ordered.map((j) => j.props.id);
      // Both reads batched — an agenda is the screen a tech reloads most, and a per-job or
      // per-lead query here would be exactly the N+1 the field router already avoids.
      const [executionByJob, leads] = await Promise.all([
        repo.listExecutionForJobs(jobIds),
        new DrizzleLeadRepository(tx, scope.orgId).findByIds([
          ...new Set(ordered.map((j) => j.props.leadId)),
        ]),
      ]);
      const nameByLead = new Map(leads.map((l) => [l.props.id, l.props.name]));

      const stops = ordered.map((j) =>
        toAgendaStop(
          toJobSummaryDTO(j, executionByJob.get(j.props.id), nameByLead.get(j.props.leadId) ?? null),
          scope.seesPrice,
        ),
      );

      return { ok: true as const, summary: JSON.stringify({ date, stops }) };
    });
  },
});

// ---------------------------------------------------------------------------
// Tool 3: get_callback_history
// ---------------------------------------------------------------------------

const buildGetCallbackHistoryTool = (scope: FieldToolScope, deps: FieldToolDeps): FieldTool => ({
  meta: {
    name: "get_callback_history",
    description:
      "If this job is a callback (a repeat visit because the original job had a problem), returns the original job's redacted context and which checklist steps were missed on the original. Use this to understand what went wrong last time and avoid repeating the same miss. Returns 'not a callback' if this job is not linked to a prior job.",
    inputSchema: noArgs,
    mutating: false,
  },
  execute: async (input) => {
    const parsed = noInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);

    return deps.withTx(scope.orgId, async (tx) => {
      const repo = new DrizzleJobRepository(tx, scope.orgId);
      const job = await repo.findById(scope.jobId);
      if (!job) return { ok: false as const, error: "job not found" };

      const callbackOf = job.props.callbackOf;
      if (!callbackOf) {
        return { ok: true as const, summary: "This job is not a callback — no prior job history." };
      }

      const originalJob = await repo.findById(asJobId(callbackOf));
      if (!originalJob) {
        return {
          ok: true as const,
          summary: `This is a callback (reason: ${job.props.callbackReason ?? "unspecified"}) but the original job could not be found.`,
        };
      }

      const originalExecution = await repo.listExecution(asJobId(callbackOf));
      const originalDto = toJobSummaryDTO(originalJob, originalExecution);
      const originalContext = buildRedactedJobContext(originalDto, scope.seesPrice);

      // Find missed steps from the original job's checklist
      const checklist = originalJob.props.checklist;
      const missedSteps =
        checklist !== null
          ? findMissedSteps(checklist, originalExecution.verifyAnswers.map((a) => a.props))
          : [];

      const result: Record<string, unknown> = {
        callbackReason: job.props.callbackReason ?? null,
        originalJob: originalContext,
      };

      if (missedSteps.length > 0) {
        result.missedStepsOnOriginal = missedSteps;
      } else if (checklist !== null) {
        result.missedStepsOnOriginal = [];
      }

      return { ok: true as const, summary: JSON.stringify(result) };
    });
  },
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build the three read-only field copilot tools, closed over the assignment-verified
 * { orgId, jobId, seesPrice } and the tx factory from deps.
 *
 * The B3 router constructs deps with withTenant as the tx runner and passes the
 * resolved scope after calling assertOnJobIfTech + getTechSeesPrice.
 *
 * Contract:
 *   buildFieldTools(deps)(scope) → FieldTool[]
 *   where FieldTool = { meta: ToolMeta, execute: (input) => Promise<ToolOutcome> }
 *
 * All three tools are mutating: false. The model supplies no id arguments.
 */
export const buildFieldTools = (deps: FieldToolDeps) =>
  (scope: FieldToolScope): FieldTool[] => [
    buildGetMyJobTool(scope, deps),
    buildGetMyDayTool(scope, deps),
    buildGetOrgServiceContextTool(scope, deps),
    buildGetCallbackHistoryTool(scope, deps),
  ];

/**
 * The tools a conversation gets when NO job is open — the Ask tab's general chat.
 *
 * `get_my_job` and `get_callback_history` close over a verified jobId; handing them a placeholder
 * would either read the wrong job or fail at the first call, and offering the model a tool that
 * cannot work is worse than not offering it. Both are withheld.
 *
 * `get_my_day` is NOT job-scoped and belongs here. It is keyed on the CALLER, and "what have I got
 * today" is the most obvious question a tech opens this tab to ask — without it the model correctly
 * but uselessly reports that it cannot see anything, which is exactly what the general chat is for.
 *
 * The scope keeps `orgId`, `userId`, `today` and `seesPrice` — the price guardrail is about the
 * ROLE, not the job, and applies to a general answer exactly as it does to a job-specific one.
 */
export const buildOrgOnlyFieldTools = (deps: FieldToolDeps) =>
  (scope: Omit<FieldToolScope, "jobId">): FieldTool[] => {
    const scoped = { ...scope, jobId: NO_JOB } as FieldToolScope;
    return [buildGetMyDayTool(scoped, deps), buildGetOrgServiceContextTool(scoped, deps)];
  };

/**
 * A structurally-valid JobId the org-scoped tool never reads.
 *
 * `get_org_service_context` queries by org alone — it takes the scope for `orgId` and
 * `seesPrice`. Rather than widen `FieldToolScope.jobId` to nullable and push a null check into
 * every tool that genuinely needs one, the one tool that ignores it gets a value it ignores.
 */
const NO_JOB = "00000000-0000-0000-0000-000000000000";
