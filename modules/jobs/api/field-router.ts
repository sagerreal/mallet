import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { toPage, asJobId, asVisitId } from "@mallet/shared/types";
import { orThrow } from "@/trpc/errors";
import type { Principal } from "@mallet/identity";
import { logger } from "@mallet/shared/observability";
import { router, anyRole } from "@/trpc/init";
import { DrizzleSettingsRepository } from "@mallet/settings";
import { DrizzleLeadRepository } from "@mallet/customers";
// Through the quoting barrel — the sanctioned seam (lint enforces index-only imports). The
// jobs↔quoting barrel cycle already exists (infra/drizzle-estimate-reader takes the same path)
// and resolves fine because both sides bind lazily inside procedure bodies.
import { RecordFieldSaleUseCase, DrizzleEstimateRepository } from "@mallet/quoting";
import { DrizzleCrewScheduleRepository } from "@mallet/frontdesk";
import { OrgSettings } from "@mallet/settings";
import type { TenantTx } from "@mallet/shared/db/tx";
import type { OrgId, PricingRates } from "@mallet/shared/types";
import { DrizzleJobRepository } from "../infra/drizzle-job-repository";
import { DrizzleCostRateReader } from "../infra/drizzle-cost-rate-reader";
import { DrizzleCardOnFileReader } from "../infra/drizzle-card-on-file-reader";
import { ListJobsUseCase } from "../app/list-jobs";
import { StartJobUseCase } from "../app/start-job";
import { CompleteJobUseCase } from "../app/complete-job";
import { SetVisitStatusUseCase } from "../app/set-visit-status";
import type { VisitStatus } from "../domain/job";
import { SetVisitEnrouteUseCase } from "../app/set-visit-enroute";
import { SetVerifyAnswerUseCase, AddJobPhotoUseCase, AddJobAddonUseCase, SetJobLinesUseCase } from "../app/job-execution-use-cases";
import { PatchVisitScheduleUseCase } from "../app/patch-visit-schedule";
import { AppendJobNoteUseCase } from "../app/append-job-note";
import { CreateVisitUseCase } from "../app/create-visit";
import { AddReturnTripUseCase } from "../app/add-return-trip";
import { ApproveFoundWorkUseCase } from "../app/approve-found-work";
import { DrizzleJobBillingReader } from "../infra/drizzle-job-billing-reader";
import type { JobBillSummary } from "../domain/return-trip";
import { QuotingChangeOrderRecorder } from "../infra/quoting-change-order-recorder";
import type { Job } from "../domain/job";
import type { JobId, VisitId } from "@mallet/shared/types";
import { jobDTO, jobSummaryDTO, toJobDTO, toJobDTOWithExecution, toJobSummaryDTO, setVerifyAnswerInput, photoUploadUrlInput, addPhotoInput, photoUploadUrlDTO } from "./job-dto";
import { redactMoneyForTech, FIELD_SURFACE_REDACTION } from "./money-redaction";
import { byAgenda, byVisitOn } from "./my-day-order";
import { withinDayPagerBound, DAY_PAGER_BOUND_DAYS } from "./day-window";
import { standardDayMinutes, weekdayOf } from "./standard-day";
import { visitToClose } from "./visit-to-close";

/**
 * Just enough of a customer for the field surface to name and reach them: who this job is for and
 * the number to call. Deliberately NOT the lead DTO — a technician has no business holding a
 * customer's value, stage, notes or owner, and this list is scoped to their own jobs anyway.
 *
 * `card` is the ONE addition beyond that, and it is presentational by construction: brand, last
 * four digits and which payment saved it — what the close-out needs to render "Charge Visa ····
 * 4242" and nothing that could charge it (the Stripe pointers never cross any wire; the charge
 * itself is `v1.fieldInvoicing.chargeOnFile`, assignment-gated server-side). This is not money
 * and not subject to techSeesPrice: the customer at the door already knows their own card, and
 * the balance it would charge is the same figure the field invoice DTO already carries.
 */
const fieldCustomerDTO = z.object({
  id: z.string().uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  // Where the customer lives — the card's "where do I drive" line when the job carries no
  // address of its own. As non-sensitive as the name above it: the tech is driving there.
  address: z.string().nullable(),
  card: z
    .object({ brand: z.string(), last4: z.string(), via: z.enum(["payment", "deposit"]) })
    .nullable(),
});

/** The distinct customers behind a page of jobs, in ONE read.
 *
 *  This was a loop of findById per job. myDay is the most-reloaded screen a technician has and the
 *  whole handler is deliberately sequential on one connection, so an N+1 here landed directly on
 *  the time between pressing a button and the screen changing. */
const loadCustomersFor = async (
  tx: TenantTx,
  orgId: OrgId,
  jobsOnPage: readonly Job[],
): Promise<z.infer<typeof fieldCustomerDTO>[]> => {
  const leadIds = [...new Set(jobsOnPage.map((j) => j.props.leadId))];
  const [found, cards] = await Promise.all([
    new DrizzleLeadRepository(tx, orgId).findByIds(leadIds),
    // One batched read, same as the leads themselves — myDay is the most-reloaded screen a
    // technician has, and a per-lead card query would be the N+1 this loader exists to avoid.
    new DrizzleCardOnFileReader(tx, orgId).byLeadIds(leadIds),
  ]);
  return found.map((lead) => ({
    id: lead.props.id,
    name: lead.props.name,
    phone: lead.props.phone,
    address: lead.props.address,
    card: cards.get(lead.props.id) ?? null,
  }));
};

/**
 * What the tap quietly did, for the surface that made it. Null when there is nothing to say.
 *
 * "segment_too_short" is the one that cost a real afternoon: a job worked for under a minute is
 * discarded rather than rounded up, which is right, but nothing said so and the hours simply never
 * appeared. The field response carries it so the person who tapped finds out from the tap.
 */
// Field-surface add-addon input: description 1..200, optional client-authored id for idempotent
// retry (mirrors the office addAddonInput's optional id), optional rate (tech with !seesPrice has
// it zeroed server-side; seesPrice techs and office callers may send a real rate).
/**
 * On-glass sign-off: the priced line set the customer is agreeing to, plus their signature.
 *
 * ONE call, not two. The price and the signature must land in the same transaction — a signature
 * saved against lines that failed to write would point at a number nobody agreed to, and lines
 * saved without the signature leave the customer having signed thin air.
 *
 * Only the name and the mark come from the client. The snapshot, the authorisation sentence, the
 * timestamp, the IP and the witnessing user are all assembled server-side.
 */
/**
 * The price a technician has built but the customer has NOT agreed to yet.
 *
 * WHY THIS EXISTS. `signQuote` was the only way a field-built price could reach the server, and it
 * demands a signature — so a technician who priced a repair and then backed out of the sheet lost
 * every line. The builder held them in local React state and nothing else. On a phone, in a truck,
 * that is a normal thing to do and it silently threw the work away.
 *
 * It writes job LINES, which is the same thing the office's Build the price writes
 * (v1.jobs.setLines → SetJobLinesUseCase). `job.lines` has always meant "the price", not "the
 * accepted quote" — acceptance is the signature, the estimate record and the won stage, none of
 * which this touches. So the office may well see a price the customer has not agreed to; that is
 * the intended trade and the reason the endpoint is named a DRAFT.
 *
 * No signature, no estimate, no lead write, no `signedByUserId` — the three things signQuote does
 * that make a sale a sale are exactly what this omits.
 */
const fieldSaveQuoteDraftInput = z.object({
  jobId: z.string().uuid(),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(2000),
        quantity: z.number().min(0),
        rateCents: z.number().int().min(0),
        costCents: z.number().int().min(0).default(0),
      }),
    )
    // EMPTY IS LEGAL, unlike signQuote's `.min(1)`. Clearing every line is a real edit, and a save
    // that refused it would silently keep a price the technician had just deleted.
    .max(200),
  discBps: z.number().int().min(0).max(10_000).default(0),
  taxBps: z.number().int().min(0).max(10_000).default(0),
  depBps: z.number().int().min(0).max(10_000).default(0),
});

const fieldSignQuoteInput = z.object({
  jobId: z.string().uuid(),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(2000),
        quantity: z.number().min(0),
        rateCents: z.number().int().min(0),
        costCents: z.number().int().min(0).default(0),
      }),
    )
    .min(1, "add at least one line before signing")
    .max(200),
  signerName: z.string().trim().min(1, "type the customer's name to sign").max(120),
  // Optional, exactly as on the web path: a typed name IS the signature, and requiring a drawing
  // would gate approval on the weakest evidence and lock out anyone who cannot draw.
  signatureSvg: z.string().trim().max(100_000).optional(),
  /**
   * Discount / tax / deposit set at the door, in basis points. All three default to zero, which is
   * what every field sale was before these controls existed — an omitting client keeps its exact
   * current behaviour.
   *
   * These are the shop's OWN numbers, decided by a technician the assignment gate above has
   * already established is on this job, so they legitimately come from the client — the office
   * composer sends the same three the same way. What does NOT come from the client is anything
   * derived from them: the total, the tax amount, the deposit and the sentence the customer signs
   * are all computed server-side from these rates and the line set, so a tablet cannot show one
   * figure and store another.
   *
   * Discount and deposit are capped at 100% because either one above that inverts the bill. Tax
   * is capped at 2500 bps for the SAME reason the office setting is (updateConfigInput): no US
   * state, county and city combination reaches half of 25%, so a larger number is a typed "825"
   * that lost its decimal point. One cap, one rationale, both surfaces.
   */
  discBps: z.number().int().min(0).max(10_000).default(0),
  taxBps: z.number().int().min(0).max(2_500).default(0),
  depBps: z.number().int().min(0).max(10_000).default(0),
});

// Scope notes from the walkthrough — the field half of the estimating split. The visit's notes
// column is the SAME field the office pipeline reads (scopedEstimateVisit keys the Quoting
// column's "quote it ›" card on it), so a tech writing here is the handoff signal, with no new
// status. Empty string clears the notes (stored as NULL) — the scope stays editable.
const fieldAppendJobNoteInput = z.object({
  jobId: z.string().uuid(),
  /** ONE line. The feed is stamped lines, not a document — see AppendJobNoteUseCase. */
  text: z.string().min(1).max(2000),
});

const fieldSetVisitNotesInput = z.object({
  jobId: z.string().uuid(),
  visitId: z.string().uuid(),
  notes: z.string().max(2000),
});

/**
 * Booking the return trip. A REASON, not a date.
 *
 * The reason is required and it is the whole value of the row: "waiting on the 40-gal tank" is
 * what lets the office pick a sensible day and what the customer gets told when they ring. An
 * unexplained second visit is a mystery the office has to phone the technician about.
 *
 * `durationHours` defaults to one hour — an honest placeholder the office adjusts when it places
 * the visit, and the only durable record of length on a row with no start/end window.
 */
const fieldAddFollowUpVisitInput = z.object({
  jobId: z.string().uuid(),
  reason: z.string().trim().min(1, "say why you need to come back").max(2000),
  durationHours: z.number().positive().max(24).default(1),
});

const fieldAddAddonInput = z.object({
  jobId: z.string().uuid(),
  id: z.string().uuid().optional(),
  description: z.string().trim().min(1, "description is required").max(200, "description must be 200 characters or fewer"),
  rateCents: z.number().int().min(0).optional(),
});

/**
 * The customer's signature on found work — the addendum to a job they already signed.
 *
 * Only the chosen items, the name and the mark come from the client. The PRICES are not sent: they
 * are read from the add-on rows the tech already recorded, so a tablet cannot sign the customer up
 * at one number and bill at another. The shop name, the authorisation sentence, the snapshot and
 * the timestamp are all assembled server-side, exactly as on signQuote.
 */
const fieldApproveFoundWorkInput = z.object({
  jobId: z.string().uuid(),
  addonIds: z
    .array(z.string().uuid())
    .min(1, "choose at least one item of found work to approve")
    // Bounded like the sign-quote line list — a sheet a customer can read, not a bulk operation.
    .max(200),
  signerName: z.string().trim().min(1, "type the customer's name to sign").max(120),
  // Optional for the same reason as on signQuote: a typed name IS the signature, and requiring a
  // drawing would gate approval on the weakest evidence and lock out anyone who cannot draw.
  signatureSvg: z.string().trim().max(100_000).optional(),
});

// The tech-facing surface. Assignment is the authorization boundary for techs: a tech may act only
// on jobs they are ON — the job-level assignee OR the assignee of any active visit
// (Job.isAssignedTo — the domain owns the rule; the schedule board dispatches crew per visit).
// Owner/office pass (they already hold the office surface). Returns the loaded job for tech
// callers so follow-up gates (job status) don't re-load it; null for owner/office.
const assertOnJobIfTech = async (
  repo: DrizzleJobRepository,
  jobId: JobId,
  principal: Principal,
): Promise<Job | null> => {
  if (principal.role !== "tech") return null;
  const job = await repo.findById(jobId);
  if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
  if (!job.isAssignedTo(principal.userId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "this job isn't assigned to you" });
  }
  return job;
};

/**
 * Visit-scoped authorisation. `assertOnJobIfTech` asks a JOB-level question — is this tech the job's
 * assignee, or the assignee of ANY of its visits — which is right for "may they open this job" and
 * wrong for "may they move this visit". On a two-visit job the job-level assignee would pass for a
 * colleague's visit and could mark it done, moving someone else's work and writing time against it.
 * Visit-scoped mutations must ask about the visit.
 */
const assertOnVisitIfTech = async (
  repo: DrizzleJobRepository,
  jobId: JobId,
  visitId: VisitId,
  principal: Principal,
): Promise<Job | null> => {
  if (principal.role !== "tech") return null;
  const job = await repo.findById(jobId);
  if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
  if (!job.isAssignedToVisit(principal.userId, visitId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "this visit isn't assigned to you" });
  }
  return job;
};

const jobIdInput = z.object({ jobId: z.string().uuid() });

const jobIdVisitIdInput = z.object({
  jobId: z.string().uuid(),
  visitId: z.string().uuid(),
});

// The field surface's own status input. Narrower than the office's on purpose: the enum is the

/**
 * The visit statuses the FIELD surface may set — the two step buttons on a technician's visit row.
 * Reopen and cancel are office moves and are not offered here.
 */
const FIELD_VISIT_STATUSES = ["in_progress", "complete"] as const satisfies readonly VisitStatus[];

// two step buttons a technician has (see FIELD_VISIT_STATUSES), so ↩ Reopen and cancel stay
// office-only at the API, not merely hidden in the UI.
const fieldSetVisitStatusInput = jobIdVisitIdInput.extend({
  status: z.enum(FIELD_VISIT_STATUSES),
});

// Every closed-job refusal on this surface says the same thing, and it names the next step rather
// than the rule that was broken.
const CLOSED_JOB_MESSAGE = "This job is closed — ask the office to change it.";

/**
 * The caller's own day, as two ABSOLUTE INSTANTS.
 *
 * The client sends them because only the client knows what day it is where the van is. There is no
 * org timezone column, so a server-side `completed_at::date = current_date` would be asking UTC:
 * at 5pm Pacific that is already tomorrow, and every job the tech finished after lunch would drop
 * off the list. Sending instants keeps the rule in one place and makes it testable.
 *
 * Bounded because it is client input: a window running backwards is a bug, and an unbounded one
 * turns the agenda into the whole history of the shop.
 */
const MY_DAY_MAX_SPAN_MS = 26 * 60 * 60 * 1000; // 24h + DST slack, generously

// One page IS the agenda: both field reads are a single uncursored fetch, and a route past this
// size is not a day one person drives. Silent-truncation-by-design, mirrored in both queries.
const FIELD_AGENDA_PAGE_LIMIT = 100;

const myDayInput = z
  .object({ dayStart: z.date(), dayEnd: z.date() })
  .refine((v) => v.dayEnd.getTime() > v.dayStart.getTime(), {
    message: "the day must end after it starts",
    path: ["dayEnd"],
  })
  .refine((v) => v.dayEnd.getTime() - v.dayStart.getTime() <= MY_DAY_MAX_SPAN_MS, {
    message: "that is more than one day",
    path: ["dayEnd"],
  });

// The day pager's input: a calendar date in the board's own grammar. A wall-clock date, not an
// instant pair — "Thursday's route" is the same question in every timezone, unlike "today", whose
// edges only the client knows (see myDayInput). The reach check lives in the procedure body where
// the injected clock is, so tests can pin "today".
const dayInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected a YYYY-MM-DD date"),
});

/** The two field agenda reads end identically: execution data in one batched read, tech money
 *  redaction, and the customers behind the page. One tail, so the reads cannot drift apart. */
const fieldAgendaPage = async (
  view: { tx: TenantTx; principal: Principal },
  repo: DrizzleJobRepository,
  ordered: readonly Job[],
): Promise<{
  items: z.infer<typeof jobSummaryDTO>[];
  customers: z.infer<typeof fieldCustomerDTO>[];
}> => {
  // Load execution data (checklist answers, add-ons, photos) for the whole page in one
  // batched read (4 IN-clause queries) — toJobSummaryDTO without it returns empty arrays.
  const jobIds = ordered.map((j) => j.props.id);
  const [executionByJob, billByJob] = await Promise.all([
    repo.listExecutionForJobs(jobIds),
    // The finished card's money slot: Paid / Sent / Take payment, answered on the LIST read
    // instead of a per-card fetch. One IN-clause query, same as the execution batch.
    new DrizzleJobBillingReader(view.tx, view.principal.orgId).readBillsForJobs(jobIds),
  ]);
  const isTech = view.principal.role === "tech";
  const seesPrice = isTech
    ? await new DrizzleSettingsRepository(view.tx, view.principal.orgId).getTechSeesPrice()
    : true;
  // The customers are loaded ANYWAY (the call bar needs them) — resolving each job's
  // customerName from the same read costs nothing. It was left null here, so the card's
  // who-is-this-for line silently never rendered on the field surface.
  const customers = await loadCustomersFor(view.tx, view.principal.orgId, ordered);
  const nameByLead = new Map(customers.map((c) => [c.id, c.name]));
  const billDTO = (bill: JobBillSummary | undefined) =>
    bill
      ? {
          status: bill.status,
          // The paid AMOUNT is money and follows techSeesPrice exactly as the job total does;
          // the STATUS stays — "paid" is a fact about the job, not a price.
          amountPaid:
            isTech && !seesPrice
              ? null
              : { cents: bill.amountPaidCents, currency: "USD" as const },
        }
      : null;
  const items = ordered.map((j) => {
    const dto = {
      ...toJobSummaryDTO(j, executionByJob.get(j.props.id), nameByLead.get(j.props.leadId) ?? null),
      bill: billDTO(billByJob.get(j.props.id)),
    };
    return isTech ? redactMoneyForTech(dto, seesPrice, FIELD_SURFACE_REDACTION) : dto;
  });
  // The customers ride the response too — the technician's reach is their own work, and the
  // field shell's Call control renders from this list.
  return { items, customers };
};

export const createFieldRouter = () =>
  router({
    myDay: anyRole.input(myDayInput).output(z.object({ items: z.array(jobSummaryDTO), customers: z.array(fieldCustomerDTO) })).query(async ({ ctx, input }) => {
      const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
      const useCase = new ListJobsUseCase(repo);
      // Visit-aware assignment (same predicate the write gates use): a tech sees every
      // job they can act on, including jobs where they only hold a visit.
      const mine = { assignedUserId: ctx.principal.userId };
      // ONE read, not two. It was two hard status equalities — scheduled, then in_progress — which
      // is also why a finished job vanished the instant it was completed. Open work plus work
      // finished inside the caller's own day, in a single round trip on the single connection this
      // tx holds.
      const page = await useCase.exec({
        page: toPage({ limit: FIELD_AGENDA_PAGE_LIMIT, cursor: null }),
        filter: { ...mine, openOrCompletedBetween: { from: input.dayStart, to: input.dayEnd } },
      });
      // Earliest live VISIT first — see my-day-order.ts. This used to sort on
      // jobs.scheduled_start, a dead column, so the day came back in random-UUID order.
      const ordered = [...page.items].sort(byAgenda);
      return fieldAgendaPage({ tx: ctx.tx, principal: ctx.principal }, repo, ordered);
    }),

    /**
     * How long the CALLER's working day is, in minutes — the DAY TOTAL ring's denominator.
     *
     * The schedule model the dispatch board and front desk already use answers it: the caller's
     * own crew_schedules row for that weekday, else the org's default day hours, else null (a
     * day off draws an empty ring — never a full one). Same date grammar and bound as `day`.
     */
    standardDay: anyRole
      .input(dayInput)
      .output(z.object({ minutes: z.number().int().positive().nullable() }))
      .query(async ({ ctx, input }) => {
        if (!withinDayPagerBound(input.date, ctx.deps.clock.now())) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `That day is out of reach — the day view covers ${DAY_PAGER_BOUND_DAYS} days either side of today.`,
          });
        }
        const weekday = weekdayOf(input.date);
        const rows = await new DrizzleCrewScheduleRepository(ctx.tx, ctx.principal.orgId).listForOrg();
        const mine = rows.find((r) => r.userId === ctx.principal.userId && r.weekday === weekday) ?? null;
        const settings = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getConfig(
          ctx.principal.orgId,
          OrgSettings.defaultBooking,
        );
        return { minutes: standardDayMinutes(weekday, mine, settings.props) };
      }),

    /**
     * ONE named day of the caller's route — the day pager's read (My day paging to yesterday or
     * next Thursday).
     *
     * NOT myDay with a different window, deliberately. myDay answers "what is my agenda": all open
     * work wherever it lands, plus what I finished today. A paged-to day answers "what does this
     * DAY hold": exactly the stops dated that day — complete ones included (a past day is a record
     * of what ran), unplaced return trips excluded (they belong to no day yet), canceled JOBS
     * excluded even when their visit was never cleaned up (a called-off job is not a stop). Same
     * visit-aware assignment as every field read, same redaction, same customer reach.
     */
    day: anyRole
      .input(dayInput)
      .output(z.object({ items: z.array(jobSummaryDTO), customers: z.array(fieldCustomerDTO) }))
      .query(async ({ ctx, input }) => {
        // The pager's reach, enforced where the injected clock lives. Client input is a date it
        // could have made up; past the bound the answer is a refusal, not a bigger scan.
        if (!withinDayPagerBound(input.date, ctx.deps.clock.now())) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `That day is out of reach — the day view covers ${DAY_PAGER_BOUND_DAYS} days either side of today.`,
          });
        }
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const page = await new ListJobsUseCase(repo).exec({
          page: toPage({ limit: FIELD_AGENDA_PAGE_LIMIT, cursor: null }),
          // visitFrom = visitTo = the day: the board's own EXISTS predicate (non-canceled,
          // non-deleted visits), narrowed to one date. Composes with the same visit-aware
          // assignment myDay uses. excludeCanceled closes the visit-outlives-its-job gap —
          // Job.cancel() leaves visits untouched, and a canceled job is not a stop.
          filter: {
            assignedUserId: ctx.principal.userId,
            visitFrom: input.date,
            visitTo: input.date,
            excludeCanceled: true,
          },
        });
        // That day's own clock, earliest first — NOT byAgenda, which would key a half-done job on
        // its next visit some other day and shuffle it to the wrong slot in this one.
        const ordered = [...page.items].sort(byVisitOn(input.date));
        return fieldAgendaPage({ tx: ctx.tx, principal: ctx.principal }, repo, ordered);
      }),

    /**
     * The jobs this person can put time against — theirs, regardless of status.
     *
     * myDay deliberately returns only scheduled + in-progress work, because it is today's agenda.
     * Attributing hours is the opposite case: you correct a timesheet AFTER the job is finished,
     * so a completed job has to be offered or the correction is impossible. Assignee-scoped, so a
     * technician is never shown the shop's whole book.
     */
    myJobs: anyRole
      .output(z.object({ items: z.array(z.object({ id: z.string().uuid(), num: z.string(), title: z.string().nullable() })) }))
      .query(async ({ ctx }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const page = await repo.list(
          { limit: 50, cursor: null },
          { assignedUserId: ctx.principal.userId },
        );
        return {
          items: page.items.map((j) => ({ id: j.props.id, num: j.props.num, title: j.props.title })),
        };
      }),

    // start/complete return the full jobDTO — redact for techs like every other field
    // response (the client discards the body today, but money must never cross the wire
    // to a redacted tech's device).
    //
    // BOTH drive the clock, exactly as setVisitStatus does. These two are the big buttons on the My
    // day agenda card — the most-used job controls a technician has, reachable without opening the
    // modal at all. While they moved the job without moving the clock, a tech who worked entirely
    // from the agenda recorded ten hours of unattributed `shop` time and ZERO job time: payroll
    // right, job costing empty. The two entry points must not be able to diverge.
    start: anyRole.input(jobIdInput).output(jobDTO).mutation(async ({ ctx, input }) => {
      const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
      const jobId = asJobId(input.jobId);
      await assertOnJobIfTech(repo, jobId, ctx.principal);
      const started = orThrow(await new StartJobUseCase(repo, ctx.deps.bus, ctx.deps.clock).exec({ jobId }));
      const dto = await toJobDTOWithExecution(repo, started);
      // Starting the job = arriving on it: close the drive, open job time. Never fails the write.
      // Job-level, so job-level assignment is the right question — this button is not about one visit.
      if (ctx.principal.role !== "tech") return { ...dto };
      const seesPrice = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getTechSeesPrice();
      return { ...redactMoneyForTech(dto, seesPrice, FIELD_SURFACE_REDACTION) };
    }),

    complete: anyRole.input(jobIdInput).output(jobDTO).mutation(async ({ ctx, input }) => {
      const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
      const jobId = asJobId(input.jobId);
      const techJob = await assertOnJobIfTech(repo, jobId, ctx.principal);
      // FINISHING A JOB NOBODY STARTED IS LEGAL IN THE FIELD.
      //
      // Two Dones existed and they disagreed. The job modal's "✓ Mark done" has always worked
      // straight from scheduled — SetVisitStatusUseCase allows pending → complete deliberately,
      // because a technician may finish without ever tapping On my way or Arrived. But this
      // endpoint went through Job.complete(), which refuses anything but in_progress, so My day's
      // "✓ Complete" card button returned BAD_REQUEST on the same job the modal would close. The
      // technician experienced it as "the card makes me press Start first but the sheet doesn't".
      //
      // The fix is HERE and not in Job.complete(): that domain method is also the OFFICE complete
      // path, where "only an in-progress job can be completed" is a rule worth keeping — a
      // dispatcher closing a job nobody has been to is a mistake, not a shortcut.
      //
      // No clock tap for the implicit start, deliberately. Opening and closing a job segment in
      // the same instant would record a sub-minute stretch the clock then throws away (and
      // announces as "that was under a minute"). Finishing without arriving records no job
      // minutes — the same honest outcome the visit path already produces, and the same one the
      // stepper reports by showing those steps as skipped.
      // AND IT MUST NOT CLOSE A JOB WITH A TRIP STILL TO RUN.
      //
      // That was the other half of the same disagreement, and the damaging half. The sheet's
      // foot runs setVisitStatus, and SetVisitStatusUseCase derives the job from the visit set —
      // finishing visit 1 of 2 correctly leaves the job open. This endpoint went straight to
      // CompleteJobUseCase, which reads no visits at all: it completed the job, emitted
      // `job.completed` (→ ensure-an-invoice), and left visit 2 sitting `pending` underneath a
      // `complete` job. A technician closing out Tuesday's trip billed a job that finishes
      // Thursday. So when the job HAS visits, this now takes the same road the sheet takes and
      // lets the cascade decide; CompleteJobUseCase is kept only for a job with no visits at
      // all, where there is no cascade to run and My day must still be able to close it.
      //
      // assertOnJobIfTech already loaded and returned this job for a tech caller — that is what it
      // returns it FOR. Only owner/office (for whom it returns null) still owe a read.
      const before = techJob ?? (await repo.findById(jobId));
      const closing = before ? visitToClose(before, ctx.principal) : null;

      if (closing) {
        const job = orThrow(
          await new SetVisitStatusUseCase(repo, ctx.deps.bus, ctx.deps.clock, new DrizzleCostRateReader(ctx.tx, ctx.principal.orgId)).exec({
            jobId,
            visitId: closing,
            status: "complete",
          }),
        );
        const cascaded = await toJobDTOWithExecution(repo, job);
        if (ctx.principal.role !== "tech") return { ...cascaded };
        const techSeesPrice = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getTechSeesPrice();
        return { ...redactMoneyForTech(cascaded, techSeesPrice, FIELD_SURFACE_REDACTION) };
      }

      if (before?.canStart()) {
        orThrow(await new StartJobUseCase(repo, ctx.deps.bus, ctx.deps.clock).exec({ jobId }));
      }
      const completed = orThrow(await new CompleteJobUseCase(repo, ctx.deps.bus, ctx.deps.clock).exec({ jobId }));
      const dto = await toJobDTOWithExecution(repo, completed);
      // Completing the job = done on it: close job time and auto-resume shop, so whoever did the work
      // stays on the clock between calls. Never fails the write.
      if (ctx.principal.role !== "tech") return { ...dto };
      const seesPrice = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getTechSeesPrice();
      return { ...redactMoneyForTech(dto, seesPrice, FIELD_SURFACE_REDACTION) };
    }),

    /**
     * "Need to come back" — the return trip, booked from the doorstep, INCLUDING after Done.
     *
     * A technician could not create a visit at all: every procedure in visit-router.ts is
     * ownerOrOffice. So the commitment made at the customer's kitchen table — and it IS made,
     * software or no software — lived in his head until he remembered to tell the office. Since
     * found work started billing (#389) it got worse: he can sign a customer for extra work and
     * then have no way to book the trip that performs it.
     *
     * AND THE MOMENT IT IS MOST NEEDED IS AFTER HE TAPS DONE. "just clicked done and theres no way
     * to add another visit, just take payment." He finishes, packs up, and finds out the fitting is
     * wrong. This used to refuse outright, because `Job.withVisits` rejects a terminal job. It now
     * reopens the job and appends the trip in ONE aggregate save (AddReturnTripUseCase) — the same
     * mechanism SetVisitStatusUseCase already uses to reopen a finished job for a visit.
     *
     * WHEN IT MAY REOPEN IS A QUESTION ABOUT MONEY, and `decideReturnTrip` owns it: paid,
     * part-paid, sent and voided bills all refuse; no bill and an untouched draft allow. The rule
     * lives in the use-case, NOT in whichever control happens to be on screen — a hidden button is
     * not enforcement, and the office surface reaches this same endpoint.
     *
     * WHAT HE CREATES IS UNPLACED, AND THAT IS THE DESIGN. He records that a return is needed and
     * why; the office picks the slot. Choosing a time is a shop-level decision — when the part
     * lands, who else is out, whose week has room — and none of it is visible from a doorstep.
     * Letting him commit the shop to a date he cannot verify is how a customer gets stood up.
     *
     * The row lands in "Needs a slot" (see OUTSTANDING in job-views.ts, which had to learn that a
     * finished first trip does not count as placement). Without that it would have been a black
     * hole — an open job reading as done, which is worse than the office forgetting to call.
     *
     * Job-level assignment gate, matching signQuote: the person who walked the site books the
     * return, whichever of the job's visits carried them there. No clock tap — booking a trip is
     * not working time.
     */
    addFollowUpVisit: anyRole
      .input(fieldAddFollowUpVisitInput)
      .output(jobDTO.extend({ reopened: z.boolean(), billIsStale: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const jobId = asJobId(input.jobId);
        await assertOnJobIfTech(repo, jobId, ctx.principal);

        const booked = orThrow(
          await new AddReturnTripUseCase(
            repo,
            new DrizzleJobBillingReader(ctx.tx, ctx.principal.orgId),
            ctx.deps.clock,
            ctx.deps.ids,
          ).exec({ jobId, reason: input.reason, durationHours: input.durationHours }),
        );

        logger.info(
          {
            jobId: input.jobId,
            orgId: ctx.principal.orgId,
            reopened: booked.reopened,
            billIsStale: booked.billIsStale,
          },
          booked.reopened ? "job.reopened_for_return_trip" : "job_visit.follow_up_created",
        );
        const dto = await toJobDTOWithExecution(repo, booked.job);
        const body =
          ctx.principal.role !== "tech"
            ? dto
            : redactMoneyForTech(
                dto,
                await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getTechSeesPrice(),
                FIELD_SURFACE_REDACTION,
              );
        // `billIsStale` is the honest half of allowing a reopen behind a draft: createFromJob is
        // idempotent on source_job_id, so that draft will NOT pick this trip's work up. It rides
        // the response so the surface that booked can say so on the spot.
        return { ...body, reopened: booked.reopened, billIsStale: booked.billIsStale };
      }),

    // Arrived / ✓ Mark done from the technician's own visit row. Same use-case as the office
    // endpoint (v1.visits.setVisitStatus stays ownerOrOffice and is NOT loosened); this is a
    // sibling gated by assignment instead of by role, so a tech may only move a visit on a job
    setVisitStatus: anyRole
      .input(fieldSetVisitStatusInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const jobId = asJobId(input.jobId);
        const visitId = asVisitId(input.visitId);
        const techJob = await assertOnVisitIfTech(repo, jobId, visitId, ctx.principal);
        if (techJob?.isTerminal()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: CLOSED_JOB_MESSAGE });
        }
        const useCase = new SetVisitStatusUseCase(repo, ctx.deps.bus, ctx.deps.clock, new DrizzleCostRateReader(ctx.tx, ctx.principal.orgId));
        const job = orThrow(
          await useCase.exec({ jobId, visitId, status: input.status }),
        );

        // Hours are written AFTER the visit write, in the same transaction, and can never fail it.

        logger.info(
          { jobId: input.jobId, visitId: input.visitId, orgId: ctx.principal.orgId, status: input.status },
          "job_visit.status_set",
        );
        const dto = await toJobDTOWithExecution(repo, job);
        if (ctx.principal.role !== "tech") return dto;
        const seesPrice = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getTechSeesPrice();
        return redactMoneyForTech(dto, seesPrice, FIELD_SURFACE_REDACTION);
      }),

    // "On my way" from the technician's own visit row. A STAMP, not a status change — the visit
    // stays pending — which is why it needs its own procedure rather than a status value (routed
    // through setVisitStatus it would arrive as the status the visit already has and be
    // short-circuited as idempotent). Assignment-gated; drives the travel segment on the clock.
    setVisitEnroute: anyRole
      .input(jobIdVisitIdInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const jobId = asJobId(input.jobId);
        const visitId = asVisitId(input.visitId);
        const techJob = await assertOnVisitIfTech(repo, jobId, visitId, ctx.principal);
        if (techJob?.isTerminal()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: CLOSED_JOB_MESSAGE });
        }
        const useCase = new SetVisitEnrouteUseCase(repo, ctx.deps.clock);
        const job = orThrow(await useCase.exec({ jobId, visitId }));

        // Run on EVERY tap, including a repeat one the use-case treats as idempotent: the clock
        // decides for itself whether a segment is already open (planTap no-ops a double tap), and
        // a second tap is then the only thing that can repair a segment an earlier failure lost.

        logger.info(
          { jobId: input.jobId, visitId: input.visitId, orgId: ctx.principal.orgId },
          "job_visit.enroute_set",
        );
        const dto = await toJobDTOWithExecution(repo, job);
        if (ctx.principal.role !== "tech") return dto;
        const seesPrice = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getTechSeesPrice();
        return redactMoneyForTech(dto, seesPrice, FIELD_SURFACE_REDACTION);
      }),

    // Scope notes from the job site. JOB-level assignment gate (same as signQuote): the person
    // who walked the site writes what they saw, whichever of the job's visits carried them there.
    // Delegates to the SAME PatchVisitScheduleUseCase the office surface uses — one write path
    // for the one field. The write is what lights up the office pipeline's "quote it ›" card
    // (scopedEstimateVisit reads visit notes), so it must not be gated on job kind: plain jobs
    // keep their walkthrough notes too.
    /**
     * A TECH WRITING A JOB NOTE. The office composer wrote through `v1.jobs.update`
     * (ownerOrOffice), so the notes section opened for a tech with nothing in it — the person
     * standing at the job could read what the office left and record nothing back. The field
     * router already trusts a tech with `setVisitNotes`; a job note is the same act at job scope.
     *
     * The APPEND happens on the server (AppendJobNoteUseCase) rather than by writing back a blob
     * the client assembled, so the office and the tech adding a note in the same minute cannot
     * erase each other.
     */
    appendJobNote: anyRole
      .input(fieldAppendJobNoteInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const jobId = asJobId(input.jobId);
        // Same authorisation as every other field write: a tech may only touch a job they are on.
        // Returns null for office/owner, who need no such check.
        await assertOnJobIfTech(repo, jobId, ctx.principal);
        const useCase = new AppendJobNoteUseCase(repo, ctx.deps.clock);
        return toJobDTO(orThrow(await useCase.exec({ jobId, text: input.text })));
      }),

    setVisitNotes: anyRole
      .input(fieldSetVisitNotesInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const jobId = asJobId(input.jobId);
        const techJob = await assertOnJobIfTech(repo, jobId, ctx.principal);
        if (techJob?.isTerminal()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: CLOSED_JOB_MESSAGE });
        }
        if (!techJob) {
          const job = await repo.findById(jobId);
          if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
          if (job.isTerminal()) {
            throw new TRPCError({ code: "BAD_REQUEST", message: CLOSED_JOB_MESSAGE });
          }
        }
        const useCase = new PatchVisitScheduleUseCase(repo, ctx.deps.clock);
        const trimmed = input.notes.trim();
        const job = orThrow(
          await useCase.exec({
            jobId,
            visitId: asVisitId(input.visitId),
            // Empty scope clears the column back to NULL — "no scope" must not be a "" that
            // still satisfies the pipeline's scoped predicate.
            notes: trimmed === "" ? null : trimmed,
          }),
        );
        logger.info(
          { jobId: input.jobId, visitId: input.visitId, orgId: ctx.principal.orgId },
          "job_visit.scope_notes_set",
        );
        const dto = await toJobDTOWithExecution(repo, job);
        if (ctx.principal.role !== "tech") return dto;
        const seesPrice = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getTechSeesPrice();
        return redactMoneyForTech(dto, seesPrice, FIELD_SURFACE_REDACTION);
      }),

    // Mint a signed upload URL for a job photo from the field surface. Any role may call this
    // (techs are assignment-gated via assertOnJobIfTech). A non-terminal gate prevents minting
    // upload URLs against already-closed jobs. The gateway must be configured or the endpoint
    // returns PRECONDITION_FAILED (self-disable pattern — same as the office surface).
    photoUploadUrl: anyRole
      .input(photoUploadUrlInput)
      .output(photoUploadUrlDTO)
      .mutation(async ({ ctx, input }) => {
        if (!ctx.deps.photoStorageGateway) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "photo storage is not configured" });
        }
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const jobId = asJobId(input.jobId);
        const techJob = await assertOnJobIfTech(repo, jobId, ctx.principal);
        if (techJob?.isTerminal()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This job is closed — ask the office to change it." });
        }
        // Confirm the job exists for non-tech callers (assertOnJobIfTech already loads it for techs).
        if (!techJob) {
          const job = await repo.findById(jobId);
          if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
          if (job.isTerminal()) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "This job is closed — ask the office to change it." });
          }
        }
        const result = await ctx.deps.photoStorageGateway.createUploadUrl({
          orgId: ctx.principal.orgId,
          jobId,
          objectId: input.objectId,
          ext: input.ext,
        });
        if (!result.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: "could not create upload url" });
        return result.value;
      }),

    // Attach a photo row to a job from the field surface. Delegates to the SAME AddJobPhotoUseCase
    // as the office surface — the use-case's prefix guard catches any forged storagePath. Response
    // is redacted for techs (same B1 pattern as setVerifyAnswer).
    addPhoto: anyRole
      .input(addPhotoInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const jobId = asJobId(input.jobId);
        const techJob = await assertOnJobIfTech(repo, jobId, ctx.principal);
        if (techJob?.isTerminal()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This job is closed — ask the office to change it." });
        }
        if (!techJob) {
          const job = await repo.findById(jobId);
          if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
          if (job.isTerminal()) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "This job is closed — ask the office to change it." });
          }
        }
        const useCase = new AddJobPhotoUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const r = orThrow(
          await useCase.exec(
            { jobId, id: input.id, storagePath: input.storagePath, caption: input.caption ?? null, verifyPass: input.verifyPass ?? false },
            ctx.principal.orgId,
          ),
        );
        const dto = toJobDTO(r.job, r.execution);
        if (ctx.principal.role !== "tech") return dto;
        const seesPrice = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getTechSeesPrice();
        return redactMoneyForTech(dto, seesPrice, FIELD_SURFACE_REDACTION);
      }),

    /**
     * Save the field-built price WITHOUT selling it. See fieldSaveQuoteDraftInput for why.
     *
     * Same gates as signQuote — the assignment check (a tech may act only on jobs they are on) and
     * the terminal-job guard (a closed job's price is the office's to change). Everything that
     * makes signQuote a SALE is absent.
     */
    saveQuoteDraft: anyRole
      .input(fieldSaveQuoteDraftInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const jobId = asJobId(input.jobId);

        const techJob = await assertOnJobIfTech(repo, jobId, ctx.principal);
        const job = techJob ?? (await repo.findById(jobId));
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
        if (job.isTerminal()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This job is closed — ask the office to change it.",
          });
        }

        const useCase = new SetJobLinesUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const r = orThrow(
          await useCase.exec(
            {
              jobId,
              lines: input.lines,
              rates: { discBps: input.discBps, taxBps: input.taxBps, depBps: input.depBps },
            },
            ctx.principal.orgId,
          ),
        );

        // Redacted like every other field response: a tech whose org has techSeesPrice off must
        // not read cost back out of the record they just wrote.
        const dto = toJobDTO(r.job, r.execution);
        const isTech = ctx.principal.role === "tech";
        if (!isTech) return dto;
        const seesPrice = await new DrizzleSettingsRepository(
          ctx.tx,
          ctx.principal.orgId,
        ).getTechSeesPrice();
        return redactMoneyForTech(dto, seesPrice, FIELD_SURFACE_REDACTION);
      }),

    signQuote: anyRole
      .input(fieldSignQuoteInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const jobId = asJobId(input.jobId);

        // Same assignment gate as every other field write: a tech may act only on jobs they are
        // on. Without it this endpoint would let any technician price and sign any job in the org.
        const techJob = await assertOnJobIfTech(repo, jobId, ctx.principal);
        const job = techJob ?? (await repo.findById(jobId));
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
        if (job.isTerminal()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This job is closed — ask the office to change it.",
          });
        }

        // The shop's name goes into the sentence the customer signs, read from the DB rather than
        // sent by the tablet: a client-supplied counterparty on a signed document is a hole.
        const orgName = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getOrgName();

        // ONE rates object, built once and handed to both writes below, so the job row, the job's
        // signature snapshot and the estimate can never end up describing three different prices.
        const rates: PricingRates = {
          discBps: input.discBps,
          taxBps: input.taxBps,
          depBps: input.depBps,
        };

        const useCase = new SetJobLinesUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const r = orThrow(
          await useCase.exec(
            {
              jobId,
              lines: input.lines,
              rates,
              signature: {
                signerName: input.signerName,
                signatureSvg: input.signatureSvg ?? "",
                // NULL on purpose, and not an oversight to fix later. On the web path the IP and
                // user agent belong to the customer's own phone and form part of the attribution.
                // Here they would belong to the TECH's tablet — the same device on every signature
                // that tech ever takes — so they attest to nothing about who signed. Recording
                // them would pad the record with something that looks like evidence and is not.
                // The in-person equivalent is signedByUserId: a named human who was standing there.
                signerIp: null,
                signerUserAgent: null,
              },
              orgName,
              signedByUserId: ctx.principal.userId,
            },
            ctx.principal.orgId,
          ),
        );

        // A quote sold in the field is a REAL quote. The same signed sale is recorded as an
        // ACCEPTED estimate (origin 'field') on the job's lead, in the SAME tenant transaction —
        // so it lands on the quotes rail, counts as won revenue, and feeds the learning
        // estimator's won-quote history exactly like an office-accepted quote. Any failure here
        // throws and rolls back the job write too: the two records must not disagree.
        //
        // The customer must exist to own the quote. findById excludes archived leads, so a sign
        // against an archived customer's job fails LOUDLY (not a quote-less silent success).
        const lead = await new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId).findById(r.job.props.leadId);
        if (!lead) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "This job's customer is missing or archived — restore the customer, then sign again.",
          });
        }
        const sale = orThrow(
          await new RecordFieldSaleUseCase(
            new DrizzleEstimateRepository(ctx.tx, ctx.principal.orgId),
            ctx.deps.bus,
            ctx.deps.clock,
            ctx.deps.ids,
          ).exec({
            orgId: ctx.principal.orgId,
            leadId: r.job.props.leadId,
            jobId: input.jobId,
            jobTitle: r.job.props.title,
            existingEstimateId: r.job.props.sourceEstimateId,
            lines: input.lines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              rateCents: l.rateCents,
              costCents: l.costCents,
            })),
            signerName: input.signerName,
            signatureSvg: input.signatureSvg ?? "",
            orgName,
            rates,
          }),
        );
        if (sale.kind === "created") {
          // Same linkage the office direction uses (job.source_estimate_id), written in reverse.
          // 0 rows = the link raced or the job vanished mid-transaction; fail loudly — an
          // unlinked field estimate would duplicate on the next re-sign.
          const linked = await repo.setSourceEstimate(jobId, sale.estimate.props.id, ctx.deps.clock.now());
          if (linked === 0) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "The job changed while signing — reopen it and sign again.",
            });
          }
        }
        return toJobDTO(r.job, r.execution);
      }),

    /**
     * The customer signs for FOUND WORK, and the found work starts billing.
     *
     * The sentence they already signed on this job says "Work beyond what is listed above is not
     * included and needs my approval before it is done." A technician tapping "approved" is not
     * that approval, and until now it was also not money: the status flipped and nothing else
     * happened, because the invoice bills from the job's LINES and has never read add-ons.
     *
     * One call, one transaction, three writes — the addendum, the approval stamp and the job
     * lines. Same shape as signQuote above, for the same reasons: the assignment gate, the org
     * name read from the DATABASE (a client-supplied counterparty on a signed document is a
     * hole), the terminal-job guard, and a throw anywhere rolling the whole thing back.
     */
    approveFoundWork: anyRole
      .input(fieldApproveFoundWorkInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const jobId = asJobId(input.jobId);

        const techJob = await assertOnJobIfTech(repo, jobId, ctx.principal);
        const job = techJob ?? (await repo.findById(jobId));
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
        if (job.isTerminal()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This job is closed — ask the office to change it.",
          });
        }

        // The customer must exist to own the addendum. findById excludes archived leads, so
        // approving against an archived customer's job fails LOUDLY rather than writing a signed
        // document nobody owns.
        const lead = await new DrizzleLeadRepository(ctx.tx, ctx.principal.orgId).findById(job.props.leadId);
        if (!lead) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "This job's customer is missing or archived — restore the customer, then approve again.",
          });
        }

        const orgName = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getOrgName();

        const useCase = new ApproveFoundWorkUseCase(
          repo,
          new QuotingChangeOrderRecorder(ctx.tx, ctx.principal.orgId, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids),
          ctx.deps.clock,
          ctx.deps.ids,
        );
        const r = orThrow(
          await useCase.exec(
            {
              jobId,
              addonIds: input.addonIds,
              signerName: input.signerName,
              signatureSvg: input.signatureSvg ?? "",
              orgName,
              approvedByUserId: ctx.principal.userId,
            },
            ctx.principal.orgId,
          ),
        );

        const dto = toJobDTO(r.job, r.execution);
        if (ctx.principal.role !== "tech") return dto;
        const seesPrice = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getTechSeesPrice();
        return redactMoneyForTech(dto, seesPrice, FIELD_SURFACE_REDACTION);
      }),

    // Field-surface found-work write. Open to all roles (anyRole) but techs are assignment-gated
    // and non-terminal-gated like every other field write. The money contract is strict:
    //   • status is ALWAYS "proposed" — a tech may never land an accepted add-on. Approval is the
    //     CUSTOMER's signature (v1.field.approveFoundWork) or the office OK-pill, never a tap here.
    //   • rateCents is stored as sent, whatever techSeesPrice says — see the note in the body.
    //   • org from principal (never from client input).
    //   • response is redacted for techs (B1 pattern — same as setVerifyAnswer / addPhoto).
    //   • quantity and costCents are forced to the office defaults (1, 0) — techs don't author
    //     cost; office callers should use the office addAddon endpoint for full control.
    //   • isOptional follows the office default (false) for field-created found work.
    addAddon: anyRole
      .input(fieldAddAddonInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const jobId = asJobId(input.jobId);
        const techJob = await assertOnJobIfTech(repo, jobId, ctx.principal);
        if (techJob?.isTerminal()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This job is closed — ask the office to change it.",
          });
        }
        if (!techJob) {
          const job = await repo.findById(jobId);
          if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
          if (job.isTerminal()) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "This job is closed — ask the office to change it." });
          }
        }

        const isTech = ctx.principal.role === "tech";
        // Found work carries the rate the caller sent, whatever techSeesPrice says.
        //
        // This USED to be forced to 0 for a !seesPrice tech, which is the write-side half of the
        // same hole as the read-side redaction: the customer is asked to sign for found work on
        // this device, so a shop that hides margins from its techs would have produced a $0
        // addendum for real work and then billed nothing for it. The setting keeps a technician
        // out of the shop's pricing on the JOB; it cannot be allowed to zero out the price the
        // customer is agreeing to. Cost stays server-forced to 0 — that is the margin.
        const rateCents = input.rateCents ?? 0;

        const useCase = new AddJobAddonUseCase(repo, ctx.deps.clock, ctx.deps.ids);
        const r = orThrow(
          await useCase.exec(
            {
              jobId,
              id: input.id,
              description: input.description.trim(),
              quantity: 1,
              rateCents,
              costCents: 0, // NEVER client-settable from the field; owner/office wanting cost authoring use v1.jobs.addAddon
              isOptional: false,
            },
            ctx.principal.orgId,
          ),
        );
        const dto = toJobDTO(r.job, r.execution);
        if (!isTech) return dto;
        const seesPrice = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getTechSeesPrice();
        return redactMoneyForTech(dto, seesPrice, FIELD_SURFACE_REDACTION);
      }),

    // Crew checklist capture: write one verify answer (pass/override/clear) from the job site.
    // Same input contract and full-jobDTO return as the office v1.jobs.setVerifyAnswer; the tech
    // path adds the assignment gate + a terminal-status gate (the before-you-leave checklist is
    // completion evidence — once the job is closed only the office may correct it), then
    // delegates to the SAME use-case (no duplicated logic).
    setVerifyAnswer: anyRole
      .input(setVerifyAnswerInput)
      .output(jobDTO)
      .mutation(async ({ ctx, input }) => {
        const repo = new DrizzleJobRepository(ctx.tx, ctx.principal.orgId);
        const jobId = asJobId(input.jobId);
        const techJob = await assertOnJobIfTech(repo, jobId, ctx.principal);
        if (techJob?.isTerminal()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This job is closed — ask the office to change it.",
          });
        }
        const useCase = new SetVerifyAnswerUseCase(repo, ctx.deps.clock);
        const r = orThrow(
          await useCase.exec(
            { jobId, itemId: input.itemId, state: input.state, via: input.via ?? null, reason: input.reason ?? null },
            ctx.principal.orgId,
          ),
        );
        const dto = toJobDTO(r.job, r.execution);
        if (ctx.principal.role !== "tech") return dto;
        const seesPrice = await new DrizzleSettingsRepository(ctx.tx, ctx.principal.orgId).getTechSeesPrice();
        return redactMoneyForTech(dto, seesPrice, FIELD_SURFACE_REDACTION);
      }),
  });
