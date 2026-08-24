import { loadConfig, resolvePublicAppOrigin } from "@mallet/shared/config";
import { Phone, type Phone as PhoneT } from "@mallet/shared/types";
import { toPage, isOk, asLeadId, asInvoiceId, asEstimateId, asJobId, asTaskId, asCompanyId, asTimeEntryId, asUserId, asVisitId, money as asMoney } from "@mallet/shared/types";
import { DrizzleLeadRepository, EnsureCustomerUseCase } from "@mallet/customers";
import {
  DrizzleInvoiceRepository,
  DrizzleJobReader,
  DrizzleEstimateDepositReader,
  SendInvoiceUseCase,
  DraftInvoiceUseCase,
  CreateInvoiceFromJobUseCase,
  RecordPaymentUseCase,
  VoidInvoiceUseCase,
  UpdateInvoiceMetadataUseCase,
  PatchInvoiceLinesUseCase,
} from "@mallet/invoicing";
import { DrizzleEstimateRepository, DraftEstimateUseCase, SendEstimateUseCase, AcceptEstimateUseCase, DeclineEstimateUseCase, runInSavepoint } from "@mallet/quoting";
import { DrizzleJobRepository, ScheduleJobUseCase, AssignJobUseCase, PatchVisitScheduleUseCase, CreateJobFromEstimateUseCase, DrizzleEstimateReader, StartJobUseCase, CompleteJobUseCase, CancelJobUseCase, RescheduleJobUseCase } from "@mallet/jobs";
import { DrizzleTaskRepository, CreateTaskUseCase, SetTaskDoneUseCase, UpdateTaskUseCase, RemoveTaskUseCase } from "@mallet/tasks";
import { DrizzleTimeEntryRepository, ApproveWeekUseCase } from "@mallet/timesheets";
import {
  AdvanceReminderUseCase,
  FollowUpPolicy,
  SendNotificationUseCase,
  resolveOrgNotificationSender,
  canSendAutomatedSms,
  DrizzleNotificationRepository,
  DrizzleReminderTargetReader,
  STUB_EXTERNAL_ID,
} from "@mallet/notifications";
import { ManualPaymentGateway } from "@mallet/invoicing";
import { CreateVisitUseCase } from "@mallet/jobs";
import { parseTool } from "./parse-tool";
import type { AgentTool, ToolContext, ToolOutcome } from "../../domain/tool";
import { ENTITY_NOT_FOUND } from "../../domain/tool";
import {
  money,
  jsonSchema,
  invalid,
  invoiceSendInput,
  quoteDraftInput,
  quoteSendInput,
  notificationSendInvoiceReminderInput,
  jobScheduleInput,
  jobAssignInput,
  visitPatchInput,
  jobIdInput,
  jobCancelInput,
  jobRescheduleInput,
  taskSetDoneInput,
  taskUpdateInput,
  taskRemoveInput,
  invoiceUpdateInput,
  customerUpdateInput,
  quoteAcceptInput,
  quoteDeclineInput,
  taskCreateInput,
  customerCreateInput,
  invoiceDraftInput,
  invoiceCreateFromJobInput,
  scheduleVisitInput,
  invoiceRecordPaymentInput,
  invoiceRecordPaymentWithKeyInput,
  invoiceVoidInput,
  timesheetApproveWeekInput,
} from "./shared";

// ---------------------------------------------------------------------------
// WRITE + SENSITIVE TOOLS — mutating: true, require human-approval gate.
// ---------------------------------------------------------------------------

// ===================== EXISTING WRITE TOOLS =====================

// --- quote_draft: draft a new estimate for a customer ---
// Upper bounds keep a frozen proposal inside sane business limits — a confirm-token can't
// commit an absurd 10,000-line or $10M-rate estimate.
export const quoteDraftTool: AgentTool = {
  name: "quote_draft",
  description: "Draft a new estimate/quote for a customer (found via customer_list). Provide line items; tax and deposit are optional percentages in basis points (1000 = 10%). Creates a DRAFT — it is not sent to the customer until separately sent.",
  inputSchema: jsonSchema(quoteDraftInput),
  input: quoteDraftInput,
  mutating: true,
  riskTier: "operational",
  // What the human approved is "a quote for THIS customer" — if the lead is renamed/re-staged (or
  // vanishes) between propose and confirm, the confirm gate refuses and asks for a fresh proposal.
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(quoteDraftInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const lead = await new DrizzleLeadRepository(ctx.tx, ctx.orgId).findById(asLeadId(parsed.data.leadId));
    return lead ? `lead:${lead.props.id}:${lead.props.name}:${lead.props.stage}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(quoteDraftInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    // Verify the customer exists so a bad/typo'd leadId is a clean, self-correctable error.
    const lead = await new DrizzleLeadRepository(ctx.tx, ctx.orgId).findById(asLeadId(parsed.data.leadId));
    if (!lead) return { ok: false, error: `customer ${parsed.data.leadId} not found — use customer_list to find the right id` };
    const uc = new DraftEstimateUseCase(new DrizzleEstimateRepository(ctx.tx, ctx.orgId), ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
    const result = await uc.exec({
      orgId: ctx.orgId,
      leadId: asLeadId(parsed.data.leadId),
      title: parsed.data.title ?? null,
      discBps: parsed.data.discBps ?? 0,
      taxBps: parsed.data.taxBps ?? 0,
      depBps: parsed.data.depBps ?? 0,
      validDays: parsed.data.validDays ?? null,
      recommendedTier: parsed.data.recommendedTier ?? null,
      tierNames: parsed.data.tierNames ?? null,
      lines: parsed.data.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        rateCents: l.rateCents,
        costCents: l.costCents ?? 0,
        isOptional: l.isOptional ?? false,
        needsPhoto: false,
        tier: l.tier ?? null,
      })),
    });
    if (!isOk(result)) return { ok: false, error: result.error.message };
    return { ok: true, summary: `Drafted estimate ${result.value.props.num} — total ${money(result.value.total())} (id: ${result.value.props.id}).` };
  },
};

// --- invoice_send: mark an invoice as sent ---
export const invoiceSendTool: AgentTool = {
  name: "invoice_send",
  description: "Mark an invoice as sent to the customer (found via invoice_list). This transitions the invoice to 'sent' and starts its payment terms.",
  inputSchema: jsonSchema(invoiceSendInput),
  input: invoiceSendInput,
  mutating: true,
  riskTier: "comms",
  // The human approved sending THIS invoice at THIS total/status — if it was edited, paid against,
  // or voided between propose and confirm, the confirm gate refuses rather than send stale terms.
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(invoiceSendInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const invoice = await new DrizzleInvoiceRepository(ctx.tx, ctx.orgId).findById(asInvoiceId(parsed.data.invoiceId));
    return invoice ? `invoice:${invoice.props.id}:${invoice.props.status}:${invoice.props.total}:${invoice.props.amountPaid}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(invoiceSendInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const uc = new SendInvoiceUseCase(new DrizzleInvoiceRepository(ctx.tx, ctx.orgId), ctx.deps.bus, ctx.deps.clock);
    const result = await uc.exec({ invoiceId: asInvoiceId(parsed.data.invoiceId) });
    if (!isOk(result)) return { ok: false, error: result.error.message };
    return { ok: true, summary: `Sent invoice ${result.value.props.num}.` };
  },
};

// ===================== PHASE B — APPROVAL-GATED WRITE TOOLS =====================

// --- quote_send: send a drafted estimate to the customer ---
// Fingerprints on estimate status + total so a concurrent edit or manual send is caught at confirm.
export const quoteSendTool: AgentTool = {
  name: "quote_send",
  description:
    "Send a drafted estimate/quote to the customer (found via estimate_list). Transitions the estimate to 'sent'. TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(quoteSendInput),
  input: quoteSendInput,
  mutating: true,
  riskTier: "comms",
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(quoteSendInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const est = await new DrizzleEstimateRepository(ctx.tx, ctx.orgId).findById(asEstimateId(parsed.data.estimateId));
    return est ? `estimate:${est.props.id}:${est.props.status}:${est.total()}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(quoteSendInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const uc = new SendEstimateUseCase(new DrizzleEstimateRepository(ctx.tx, ctx.orgId), ctx.deps.bus, ctx.deps.clock);
    const result = await uc.exec({ estimateId: asEstimateId(parsed.data.estimateId) });
    if (!isOk(result)) return { ok: false, error: result.error.message };
    // The link is the POINT of sending, and it was the one thing the summary left out — so the
    // agent's next sentence ("here's the link to send them") was unanswerable, and nothing else
    // returns it either: not estimate_get, not estimate_list. The model had no way to know the
    // link existed at all.
    const sent = result.value.props;
    const origin = publicOrigin();
    const link = sent.publicToken && origin ? ` — ${origin}/q/${sent.publicToken}` : "";
    return { ok: true, summary: `Sent estimate ${sent.num}${link} (id: ${sent.id}).` };
  },
};

/**
 * Can this shop send an automated text at all? The shop's own line once it has one, Mallet's
 * shared line until then — the same question the notification router asks, answered in one place.
 *
 * NOT "is this shop's own campaign active". That refused a brand-new shop's reminder before the
 * sender that would have used the shared line was ever built, which is precisely what the shared
 * line exists to prevent. Returns a block reason string (never throws) because tool handlers
 * report failure through ToolOutcome.
 */
async function smsBlockReason(ctx: ToolContext, channel: "sms" | "email"): Promise<string | null> {
  if (channel !== "sms") return null;
  return (await canSendAutomatedSms(ctx.tx, ctx.orgId))
    ? null
    : "texting isn't available for this shop yet";
}

// --- notification_send_invoice_reminder: send an invoice notification via sms or email ---
// Requires ctx.deps.notificationSender; returns a clean error if unconfigured (pilot safety).
// Fingerprints on invoice status so a voided or already-paid invoice is caught before sending.
export const notificationSendInvoiceReminderTool: AgentTool = {
  name: "notification_send_invoice_reminder",
  description:
    "Send an invoice reminder to a customer via the preferred channel (use notification_list_due_reminders to find which invoices are due). TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(notificationSendInvoiceReminderInput),
  input: notificationSendInvoiceReminderInput,
  mutating: true,
  riskTier: "comms",
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(notificationSendInvoiceReminderInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const inv = await new DrizzleInvoiceRepository(ctx.tx, ctx.orgId).findById(asInvoiceId(parsed.data.invoiceId));
    return inv ? `invoice:${inv.props.id}:${inv.props.status}:${inv.props.total}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(notificationSendInvoiceReminderInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const blockReason = await smsBlockReason(ctx, parsed.data.channel);
    if (blockReason) return { ok: false, error: blockReason };
    if (!ctx.deps.notificationSender) {
      return { ok: false, error: "notification sender not configured — contact your administrator" };
    }
    const repo = new DrizzleNotificationRepository(ctx.tx, ctx.orgId);
    const reader = new DrizzleReminderTargetReader(ctx.tx, ctx.orgId);
    // Per-org, not the boot-time sender: the agent's reminders are customer-facing texts and go
    // out from the SHOP's own number and Messaging Service, like every other automated message.
    const sender = await resolveOrgNotificationSender({
      tx: ctx.tx,
      orgId: ctx.orgId,
      base: ctx.deps.notificationSender,
      clock: ctx.deps.clock,
    });
    const sendUc = new SendNotificationUseCase(repo, sender, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);

    // AdvanceReminder, NOT SendInvoiceNotification. This tool is named "send invoice REMINDER" but
    // called the first-contact path, which sends kind "invoice_sent" with `reminderStage: null`.
    // Two consequences, both silent:
    //
    //   1. A customer 45 days overdue got the gentle "your invoice is ready" copy instead of the
    //      stage-appropriate past-due wording.
    //   2. Nothing recorded that a reminder went out. sentReminderStages never saw the row, so
    //      notification_list_due_reminders kept reporting the SAME reminder as due — the read tool
    //      leading the model into a loop it could not exit, re-proposing the same send every turn.
    //
    // AdvanceReminder resolves the due stage, sends that stage's copy, and keys idempotency on
    // `reminder:<id>:<stage>` so the stage is recorded and cannot repeat.
    const uc = new AdvanceReminderUseCase(reader, repo, sendUc, new FollowUpPolicy(), ctx.deps.clock, publicOrigin());
    const result = await uc.exec({ orgId: ctx.orgId, relatedType: "invoice", relatedId: parsed.data.invoiceId });
    if (!isOk(result)) return { ok: false, error: result.error.message };
    // Null means the policy says nothing is due — a real answer, not a failure. Saying so stops the
    // model inventing a reason or retrying.
    if (result.value === null) {
      return { ok: true, summary: "No reminder is due for that invoice yet — the follow-up sequence is up to date." };
    }
    const p = result.value.props;
    // Delivery truth (mirrors the notification router's interactive guard): a stubbed
    // no-op or provider rejection must not read back to the agent as a sent reminder.
    if (p.externalId === STUB_EXTERNAL_ID) {
      return { ok: false, error: `${p.channel} delivery is not configured — contact your administrator` };
    }
    if (p.status === "failed") {
      return { ok: false, error: `the ${p.channel} provider rejected the send` };
    }
    return { ok: true, summary: `Sent invoice reminder via ${p.channel} (notification id: ${p.id}, status: ${p.status}).` };
  },
};

// --- job_schedule: create a new job for a customer ---
// Fingerprints on the lead's name + stage so a renamed/archived customer is caught at confirm.
export const jobScheduleTool: AgentTool = {
  name: "job_schedule",
  description:
    "Schedule a new field job for a customer (found via customer_list). Provide an optional title and window; assignee is optional. TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(jobScheduleInput),
  input: jobScheduleInput,
  mutating: true,
  riskTier: "operational",
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(jobScheduleInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const lead = await new DrizzleLeadRepository(ctx.tx, ctx.orgId).findById(asLeadId(parsed.data.leadId));
    return lead ? `lead:${lead.props.id}:${lead.props.name}:${lead.props.stage}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(jobScheduleInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const uc = new ScheduleJobUseCase(new DrizzleJobRepository(ctx.tx, ctx.orgId), ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
    const result = await uc.exec({
      orgId: ctx.orgId,
      leadId: asLeadId(parsed.data.leadId),
      title: parsed.data.title ?? null,
      scheduledStart: parsed.data.scheduledStart ? new Date(parsed.data.scheduledStart) : null,
      scheduledEnd: parsed.data.scheduledEnd ? new Date(parsed.data.scheduledEnd) : null,
      assigneeUserId: parsed.data.assigneeUserId ? asUserId(parsed.data.assigneeUserId) : null,
    });
    if (!isOk(result)) return { ok: false, error: result.error.message };
    const p = result.value.props;
    const titlePart = p.title ? ` — "${p.title}"` : "";
    return { ok: true, summary: `Scheduled job ${p.num}${titlePart} (id: ${p.id}).` };
  },
};

// --- job_assign: assign (or unassign) a job to a crew member ---
// Fingerprints on job status + current assignee so a concurrent reassignment is caught.
export const jobAssignTool: AgentTool = {
  name: "job_assign",
  description:
    "Set the job-level owner for a crew member (found via member_list). NOT what changes who actually turns up — the dispatch board, the Jobs list and a tech's day all read the VISIT, so use visit_patch to change who is going or when. Use this only for overall ownership of a job with no visits yet. Pass assigneeUserId as null to unassign. TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(jobAssignInput),
  input: jobAssignInput,
  mutating: true,
  riskTier: "operational",
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(jobAssignInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const job = await new DrizzleJobRepository(ctx.tx, ctx.orgId).findById(asJobId(parsed.data.jobId));
    return job ? `job:${job.props.id}:${job.props.status}:${job.props.assigneeUserId ?? "unassigned"}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(jobAssignInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const uc = new AssignJobUseCase(new DrizzleJobRepository(ctx.tx, ctx.orgId), ctx.deps.bus, ctx.deps.clock);
    const result = await uc.exec({
      jobId: asJobId(parsed.data.jobId),
      assigneeUserId: parsed.data.assigneeUserId ? asUserId(parsed.data.assigneeUserId) : null,
    });
    if (!isOk(result)) return { ok: false, error: result.error.message };
    const p = result.value.props;
    const assignee = p.assigneeUserId ? "assigned ✓" : "unassigned";
    return { ok: true, summary: `Job ${p.num} ${assignee} (id: ${p.id}).` };
  },
};

// The public quote origin, resolved once. Cached like the estimate router does it, and tolerant of
// a missing config: a deployment (or a unit test) without a public URL should send the quote and
// omit the link, not fail the send over a display detail.
let cachedOrigin: string | null | undefined;
const publicOrigin = (): string | null => {
  if (cachedOrigin === undefined) {
    try {
      cachedOrigin = resolvePublicAppOrigin(loadConfig());
    } catch {
      cachedOrigin = null;
    }
  }
  return cachedOrigin;
};

// --- job lifecycle: start / complete / cancel / reschedule ---
// Every one of these wraps a use case that already existed and had no tool, so the agent could
// create a job and never move or stop it. All fingerprint on job status so a concurrent
// transition is caught at confirm rather than silently overwritten.
export const jobStartTool: AgentTool = {
  name: "job_start",
  description:
    "Mark a job as started/in progress. TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(jobIdInput),
  input: jobIdInput,
  mutating: true,
  riskTier: "operational",
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(jobIdInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const job = await new DrizzleJobRepository(ctx.tx, ctx.orgId).findById(asJobId(parsed.data.jobId));
    return job ? `job:${job.props.id}:${job.props.status}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(jobIdInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const uc = new StartJobUseCase(new DrizzleJobRepository(ctx.tx, ctx.orgId), ctx.deps.bus, ctx.deps.clock);
    const r = await uc.exec({ jobId: asJobId(parsed.data.jobId) });
    if (!isOk(r)) return { ok: false, error: r.error.message };
    return { ok: true, summary: `Job ${r.value.props.num} started.` };
  },
};

export const jobCompleteTool: AgentTool = {
  name: "job_complete",
  description:
    "Mark a job as complete/done — the work is finished. TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(jobIdInput),
  input: jobIdInput,
  mutating: true,
  riskTier: "operational",
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(jobIdInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const job = await new DrizzleJobRepository(ctx.tx, ctx.orgId).findById(asJobId(parsed.data.jobId));
    return job ? `job:${job.props.id}:${job.props.status}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(jobIdInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const uc = new CompleteJobUseCase(new DrizzleJobRepository(ctx.tx, ctx.orgId), ctx.deps.bus, ctx.deps.clock);
    // startIfScheduled: someone typing "mark JOB-… complete" has decided the work is done. Without
    // this the tool refused every job in the org, because a job is SCHEDULED until a technician
    // taps Start and the office is usually closing out work from yesterday. The office's own
    // endpoint keeps the strict rule on purpose — see the flag's note.
    const r = await uc.exec({ jobId: asJobId(parsed.data.jobId), startIfScheduled: true });
    if (!isOk(r)) return { ok: false, error: r.error.message };
    return { ok: true, summary: `Job ${r.value.props.num} marked complete.` };
  },
};

export const jobCancelTool: AgentTool = {
  name: "job_cancel",
  description:
    "Cancel a job, with the reason. Use job_complete for work that was finished — cancel is for work that will not happen. TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(jobCancelInput),
  input: jobCancelInput,
  mutating: true,
  riskTier: "destructive",
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(jobCancelInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const job = await new DrizzleJobRepository(ctx.tx, ctx.orgId).findById(asJobId(parsed.data.jobId));
    return job ? `job:${job.props.id}:${job.props.status}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(jobCancelInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const uc = new CancelJobUseCase(new DrizzleJobRepository(ctx.tx, ctx.orgId), ctx.deps.bus, ctx.deps.clock);
    const r = await uc.exec({ jobId: asJobId(parsed.data.jobId), reason: parsed.data.reason });
    if (!isOk(r)) return { ok: false, error: r.error.message };
    return { ok: true, summary: `Job ${r.value.props.num} cancelled — reason recorded.` };
  },
};

export const jobRescheduleTool: AgentTool = {
  name: "job_reschedule",
  description:
    "Move a job to a new start and end time (ISO 8601). This moves the JOB's window; to move who is going or an individual visit on the board, use visit_patch. TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(jobRescheduleInput),
  input: jobRescheduleInput,
  mutating: true,
  riskTier: "operational",
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(jobRescheduleInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const job = await new DrizzleJobRepository(ctx.tx, ctx.orgId).findById(asJobId(parsed.data.jobId));
    return job ? `job:${job.props.id}:${job.props.status}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(jobRescheduleInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    // Reject an unparseable date here rather than passing Invalid Date into the domain, where it
    // would land as a null timestamp and silently unschedule the job.
    const start = new Date(parsed.data.scheduledStart);
    const end = new Date(parsed.data.scheduledEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return { ok: false, error: "scheduledStart and scheduledEnd must be ISO 8601 date-times" };
    }
    const uc = new RescheduleJobUseCase(new DrizzleJobRepository(ctx.tx, ctx.orgId), ctx.deps.bus, ctx.deps.clock);
    const r = await uc.exec({ jobId: asJobId(parsed.data.jobId), scheduledStart: start, scheduledEnd: end });
    if (!isOk(r)) return { ok: false, error: r.error.message };
    return { ok: true, summary: `Job ${r.value.props.num} rescheduled.` };
  },
};

// --- task lifecycle: done / update / remove ---
// task_create was the only task write tool, so a to-do list could only grow.
export const taskSetDoneTool: AgentTool = {
  name: "task_set_done",
  description:
    "Mark a task done, or reopen it (pass done: false). TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(taskSetDoneInput),
  input: taskSetDoneInput,
  mutating: true,
  riskTier: "operational",
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(taskSetDoneInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const t = await new DrizzleTaskRepository(ctx.tx, ctx.orgId).findById(asTaskId(parsed.data.taskId));
    return t ? `task:${t.props.id}:${t.props.done}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(taskSetDoneInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const uc = new SetTaskDoneUseCase(new DrizzleTaskRepository(ctx.tx, ctx.orgId), ctx.deps.clock);
    const r = await uc.exec({ taskId: asTaskId(parsed.data.taskId), done: parsed.data.done }, ctx.orgId);
    if (!isOk(r)) return { ok: false, error: r.error.message };
    return { ok: true, summary: `Task "${r.value.props.text}" ${parsed.data.done ? "marked done" : "reopened"}.` };
  },
};

export const taskUpdateTool: AgentTool = {
  name: "task_update",
  description:
    "Edit a task's wording, due date, or the customer it hangs off. Pass null to clear the due date or the customer link. TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(taskUpdateInput),
  input: taskUpdateInput,
  mutating: true,
  riskTier: "operational",
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(taskUpdateInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const t = await new DrizzleTaskRepository(ctx.tx, ctx.orgId).findById(asTaskId(parsed.data.taskId));
    return t ? `task:${t.props.id}:${t.props.text}:${t.props.dueDate ?? "-"}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(taskUpdateInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const d = parsed.data;
    const uc = new UpdateTaskUseCase(new DrizzleTaskRepository(ctx.tx, ctx.orgId), ctx.deps.clock);
    const r = await uc.exec(
      {
        taskId: asTaskId(d.taskId),
        // undefined leaves alone, null clears — forwarded distinctly, not collapsed.
        ...(d.text !== undefined ? { text: d.text } : {}),
        ...(d.dueDate !== undefined ? { dueDate: d.dueDate } : {}),
        ...(d.leadId !== undefined ? { leadId: d.leadId === null ? null : asLeadId(d.leadId) } : {}),
      },
      ctx.orgId,
    );
    if (!isOk(r)) return { ok: false, error: r.error.message };
    return { ok: true, summary: `Task updated — "${r.value.props.text}".` };
  },
};

export const taskRemoveTool: AgentTool = {
  name: "task_remove",
  description:
    "Delete a task. Prefer task_set_done for work that was actually finished — removing loses the record that it existed. TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(taskRemoveInput),
  input: taskRemoveInput,
  mutating: true,
  riskTier: "destructive",
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(taskRemoveInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const t = await new DrizzleTaskRepository(ctx.tx, ctx.orgId).findById(asTaskId(parsed.data.taskId));
    return t ? `task:${t.props.id}:${t.props.text}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(taskRemoveInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const uc = new RemoveTaskUseCase(new DrizzleTaskRepository(ctx.tx, ctx.orgId), ctx.deps.clock);
    const r = await uc.exec({ taskId: asTaskId(parsed.data.taskId) }, ctx.orgId);
    if (!isOk(r)) return { ok: false, error: r.error.message };
    return { ok: true, summary: "Task deleted." };
  },
};

// --- invoice_update: correct an OPEN invoice in place ---
// Fingerprints on status + total so a concurrent payment or send is caught before the edit lands.
export const invoiceUpdateTool: AgentTool = {
  name: "invoice_update",
  description:
    "Correct an OPEN invoice (draft, sent or partial): its title, payment terms, deposit, or its line items. Use this instead of voiding and re-drafting — a void burns the invoice number and leaves a void row in the ledger. NOTE: `lines` REPLACES the whole set, so send every line you want kept, not just the changed one. Frozen once the invoice is paid or void. TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(invoiceUpdateInput),
  input: invoiceUpdateInput,
  mutating: true,
  riskTier: "money",
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(invoiceUpdateInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const inv = await new DrizzleInvoiceRepository(ctx.tx, ctx.orgId).findById(asInvoiceId(parsed.data.invoiceId));
    return inv ? `invoice:${inv.props.id}:${inv.props.status}:${inv.props.total}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(invoiceUpdateInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const d = parsed.data;
    const repo = new DrizzleInvoiceRepository(ctx.tx, ctx.orgId);
    const invoiceId = asInvoiceId(d.invoiceId);

    const wantsMeta = d.title !== undefined || d.termsDays !== undefined || d.depositPaidCents !== undefined;
    if (!wantsMeta && !d.lines) {
      return { ok: false, error: "nothing to change — supply a title, termsDays, depositPaidCents, or lines" };
    }

    if (wantsMeta) {
      const meta = new UpdateInvoiceMetadataUseCase(repo, ctx.deps.bus, ctx.deps.clock);
      const r = await meta.exec({
        invoiceId,
        ...(d.title !== undefined ? { title: d.title } : {}),
        ...(d.termsDays !== undefined ? { termsDays: d.termsDays } : {}),
        ...(d.depositPaidCents !== undefined ? { depositPaidCents: d.depositPaidCents } : {}),
      });
      if (!isOk(r)) return { ok: false, error: r.error.message };
    }

    if (d.lines) {
      const patch = new PatchInvoiceLinesUseCase(repo, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
      const r = await patch.exec({ invoiceId, lines: d.lines.map((l) => ({ description: l.description, quantity: l.quantity, rateCents: l.rateCents, costCents: 0 })) });
      if (!isOk(r)) return { ok: false, error: r.error.message };
      const updated = r.value;
      return { ok: true, summary: `Invoice ${updated.props.num} updated — total ${asMoney(updated.props.total)}, balance ${asMoney(updated.due())}.` };
    }

    const after = await repo.findById(invoiceId);
    return after
      ? { ok: true, summary: `Invoice ${after.props.num} updated — total ${asMoney(after.props.total)}.` }
      : { ok: true, summary: "Invoice updated." };
  },
};

// --- customer_update: edit an existing customer ---
// Fingerprints on the customer's name + stage so a concurrent change is caught at confirm.
export const customerUpdateTool: AgentTool = {
  name: "customer_update",
  description:
    "Edit an existing customer: name, phone, email, service address, notes or role. Use customer_find or customer_list to get the id. Pass null to clear a field. Only the fields you supply change. TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(customerUpdateInput),
  input: customerUpdateInput,
  mutating: true,
  riskTier: "destructive",
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(customerUpdateInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const lead = await new DrizzleLeadRepository(ctx.tx, ctx.orgId).findById(asLeadId(parsed.data.customerId));
    return lead ? `lead:${lead.props.id}:${lead.props.name}:${lead.props.stage}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(customerUpdateInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const d = parsed.data;
    const repo = new DrizzleLeadRepository(ctx.tx, ctx.orgId);
    const lead = await repo.findById(asLeadId(d.customerId));
    if (!lead) return { ok: false, error: `customer ${d.customerId} not found — use customer_find or customer_list` };

    // Normalise before writing: leads_org_phone_uidx is keyed on E.164, so storing a raw
    // "(781) 385-0591" would both break dedupe and make customer_find miss them afterwards.
    const fields: Record<string, unknown> = {};
    if (d.name !== undefined) fields.name = d.name;
    if (d.email !== undefined) fields.email = d.email;
    if (d.address !== undefined) fields.address = d.address;
    if (d.notes !== undefined) fields.notes = d.notes;
    if (d.role !== undefined) fields.role = d.role;
    if (d.phone !== undefined) {
      if (d.phone === null || d.phone.trim().length === 0) fields.phone = null;
      else {
        const ph = Phone.parse(d.phone);
        if (!isOk(ph)) return { ok: false, error: ph.error.message };
        fields.phone = ph.value;
      }
    }
    if (Object.keys(fields).length === 0) return { ok: false, error: "nothing to change — supply at least one field" };

    const patched = lead.patch(fields, ctx.deps.clock.now());
    if (!isOk(patched)) return { ok: false, error: patched.error.message };
    await repo.save(patched.value);
    return { ok: true, summary: `Updated ${patched.value.props.name} — changed ${Object.keys(fields).join(", ")}.` };
  },
};

// --- quote_accept / quote_decline: record the customer's answer ---
// Accept is the conversion point: it also MINTS THE JOB. Without these two the agent could draft
// and send a quote and then had no way to act on "they said yes" — the lead → quote → dispatch
// chain was severed at exactly the step that matters.
export const quoteAcceptTool: AgentTool = {
  name: "quote_accept",
  description:
    "Record that the customer ACCEPTED a quote. This also creates the job, so it is how a won quote becomes work on the board. For a Good/Better/Best quote pass chosenTier; omitted, the recommended tier is used. TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(quoteAcceptInput),
  input: quoteAcceptInput,
  mutating: true,
  riskTier: "money",
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(quoteAcceptInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const est = await new DrizzleEstimateRepository(ctx.tx, ctx.orgId).findById(asEstimateId(parsed.data.estimateId));
    return est ? `estimate:${est.props.id}:${est.props.status}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(quoteAcceptInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const repo = new DrizzleEstimateRepository(ctx.tx, ctx.orgId);
    const uc = new AcceptEstimateUseCase(repo, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
    const result = await uc.exec({
      estimateId: asEstimateId(parsed.data.estimateId),
      ...(parsed.data.chosenTier ? { chosenTier: parsed.data.chosenTier } : {}),
    });
    if (!isOk(result)) return { ok: false, error: result.error.message };

    // Job creation happens INLINE, exactly as the office accept route does it — estimate.accepted
    // has no registered handler, so relying on the event would accept the quote and silently never
    // produce the job. In a savepoint because a failed job creation must NOT roll back a
    // successful acceptance: the customer really did say yes.
    const jobNum = await runInSavepoint<string>(
      ctx.tx,
      async (sp) => {
        const createJob = new CreateJobFromEstimateUseCase(
          new DrizzleJobRepository(sp, ctx.orgId),
          new DrizzleEstimateReader(sp, ctx.orgId),
          ctx.deps.bus,
          ctx.deps.clock,
          ctx.deps.ids,
        );
        const job = await createJob.exec({ orgId: ctx.orgId, estimateId: asEstimateId(parsed.data.estimateId) });
        return job.ok ? job.value.props.num : null;
      },
      () => undefined,
    );

    const e = result.value.props;
    return {
      ok: true,
      summary: jobNum
        ? `Quote ${e.num} accepted — job ${jobNum} created and ready to schedule.`
        : `Quote ${e.num} accepted. The job was NOT created — create it manually and tell the user so.`,
    };
  },
};

export const quoteDeclineTool: AgentTool = {
  name: "quote_decline",
  description:
    "Record that the customer DECLINED a quote, with their reason. Moves the lead to lost with the reason captured. TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(quoteDeclineInput),
  input: quoteDeclineInput,
  mutating: true,
  riskTier: "destructive",
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(quoteDeclineInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const est = await new DrizzleEstimateRepository(ctx.tx, ctx.orgId).findById(asEstimateId(parsed.data.estimateId));
    return est ? `estimate:${est.props.id}:${est.props.status}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(quoteDeclineInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const uc = new DeclineEstimateUseCase(new DrizzleEstimateRepository(ctx.tx, ctx.orgId), ctx.deps.bus, ctx.deps.clock);
    const result = await uc.exec({ estimateId: asEstimateId(parsed.data.estimateId), reason: parsed.data.reason });
    if (!isOk(result)) return { ok: false, error: result.error.message };
    return { ok: true, summary: `Quote ${result.value.props.num} marked declined — reason recorded.` };
  },
};

// --- visit_patch: reassign or re-time a VISIT (what the dispatch board reads) ---
// Fingerprints on the visit's current assignee + slot so a concurrent change is caught at confirm.
export const visitPatchTool: AgentTool = {
  name: "visit_patch",
  description:
    "Reassign, move, re-time or unplace a scheduled VISIT. Use this — not job_assign — to change who is going or when: the dispatch board, the Jobs list and a tech's day all read the visit, not the job. Pass null to clear a field (unplacing a visit returns it to the unscheduled pile). Get jobId and visitId from job_get. TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(visitPatchInput),
  input: visitPatchInput,
  mutating: true,
  riskTier: "operational",
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(visitPatchInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const job = await new DrizzleJobRepository(ctx.tx, ctx.orgId).findById(asJobId(parsed.data.jobId));
    const visit = job?.props.visits.find((v) => v.props.id === parsed.data.visitId);
    if (!visit) return ENTITY_NOT_FOUND;
    const v = visit.props;
    return `visit:${v.id}:${v.assigneeUserId ?? "unassigned"}:${v.scheduledDate ?? "unplaced"}:${v.scheduledStart ?? "-"}`;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(visitPatchInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const uc = new PatchVisitScheduleUseCase(new DrizzleJobRepository(ctx.tx, ctx.orgId), ctx.deps.clock);
    const d = parsed.data;
    const result = await uc.exec({
      jobId: asJobId(d.jobId),
      visitId: asVisitId(d.visitId),
      // `undefined` means leave alone, `null` means clear — the use case distinguishes them, so
      // these must be forwarded as-is rather than collapsed with `?? null`.
      ...(d.assigneeUserId !== undefined ? { assigneeUserId: d.assigneeUserId === null ? null : asUserId(d.assigneeUserId) } : {}),
      ...(d.scheduledDate !== undefined ? { scheduledDate: d.scheduledDate } : {}),
      ...(d.scheduledStart !== undefined ? { scheduledStart: d.scheduledStart } : {}),
      ...(d.scheduledEnd !== undefined ? { scheduledEnd: d.scheduledEnd } : {}),
      ...(d.notes !== undefined ? { notes: d.notes } : {}),
    });
    if (!isOk(result)) return { ok: false, error: result.error.message };
    const v = result.value.props.visits.find((x) => x.props.id === d.visitId)?.props;
    if (!v) return { ok: true, summary: `Visit updated on job ${result.value.props.num}.` };
    const when = v.scheduledDate ? `${v.scheduledDate}${v.scheduledStart ? ` ${v.scheduledStart}` : ""}` : "unplaced";
    const who = v.assigneeUserId ? `assigned to ${v.assigneeUserId}` : "unassigned";
    return { ok: true, summary: `Visit on job ${result.value.props.num} — ${when}, ${who}.` };
  },
};

// --- task_create: create a new task ---
// Fingerprints on the linked lead's name if present (so a renamed/removed lead is caught).
export const taskCreateTool: AgentTool = {
  name: "task_create",
  description:
    "Create a new task with optional due date and customer link (found via customer_list). TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(taskCreateInput),
  input: taskCreateInput,
  mutating: true,
  riskTier: "operational",
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(taskCreateInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    // Fingerprint the linked lead if provided; otherwise fingerprint the task text (no drift possible).
    if (parsed.data.leadId) {
      const lead = await new DrizzleLeadRepository(ctx.tx, ctx.orgId).findById(asLeadId(parsed.data.leadId));
      return lead ? `lead:${lead.props.id}:${lead.props.name}` : ENTITY_NOT_FOUND;
    }
    return `task:text:${parsed.data.text.slice(0, 80)}`;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(taskCreateInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const uc = new CreateTaskUseCase(new DrizzleTaskRepository(ctx.tx, ctx.orgId), ctx.deps.clock, ctx.deps.ids);
    const result = await uc.exec(
      {
        leadId: parsed.data.leadId ? asLeadId(parsed.data.leadId) : null,
        text: parsed.data.text,
        dueDate: parsed.data.dueDate ?? null,
      },
      ctx.orgId,
    );
    if (!isOk(result)) return { ok: false, error: result.error.message };
    const p = result.value.props;
    const duePart = p.dueDate ? ` due ${p.dueDate}` : "";
    return { ok: true, summary: `Created task "${p.text}"${duePart} (id: ${p.id}).` };
  },
};

// --- customer_create: get-or-create a customer ---
// EnsureCustomerUseCase is idempotent on name (get-or-create). Fingerprint is static (no entity to drift).
export const customerCreateTool: AgentTool = {
  name: "customer_create",
  description:
    "Create a new customer (or return the existing one with the same name). Accepts phone, email and service address — capture them when the user gives them. TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(customerCreateInput),
  input: customerCreateInput,
  mutating: true,
  riskTier: "operational",
  async fingerprint(input, _ctx): Promise<string> {
    const parsed = parseTool(customerCreateInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    // No pre-existing entity to drift on — fingerprint the proposed name so the human sees exactly what they approved.
    return `new-customer:${parsed.data.name}`;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(customerCreateInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    // A phone typed by a human ("(781) 385-0591") must be normalised before it reaches the
    // repository — leads_org_phone_uidx is keyed on E.164, so an unparsed string would create a
    // duplicate customer instead of matching the existing one. Refuse a bad number rather than
    // silently dropping it: a customer saved without the number the staffer just dictated is a
    // worse outcome than being told it was wrong.
    let phone: PhoneT | null = null;
    if (parsed.data.phone && parsed.data.phone.trim().length > 0) {
      const p = Phone.parse(parsed.data.phone);
      if (!isOk(p)) return { ok: false, error: p.error.message };
      phone = p.value;
    }

    const uc = new EnsureCustomerUseCase(new DrizzleLeadRepository(ctx.tx, ctx.orgId), ctx.deps.bus, ctx.deps.clock);
    const result = await uc.exec({
      name: parsed.data.name,
      phone,
      email: parsed.data.email ?? null,
      source: parsed.data.source ?? null,
      companyId: parsed.data.companyId ? asCompanyId(parsed.data.companyId) : null,
      role: parsed.data.role ?? null,
      notes: parsed.data.notes ?? null,
      address: parsed.data.address ?? null,
    });
    if (!isOk(result)) return { ok: false, error: result.error.message };

    // ensureCustomer DEDUPES on phone: a matching active customer comes back untouched
    // (ON CONFLICT DO NOTHING), so every other supplied field is discarded. Before phone was
    // accepted here that could never happen — phone was always null and a null never conflicts —
    // so accepting phone turned a create-only tool into one that could silently swallow the
    // address and email on the very request that motivated adding them.
    //
    // Fill only what is EMPTY on the existing record. A supplied value that DIFFERS from a value
    // already on file is not applied: the agent has no way to know which is right, and quietly
    // overwriting a customer's real address with one dictated over a noisy phone line is worse
    // than saying so.
    const repo2 = new DrizzleLeadRepository(ctx.tx, ctx.orgId);
    let p = result.value.lead.props;
    if (!result.value.created) {
      const wanted = { email: parsed.data.email, address: parsed.data.address, notes: parsed.data.notes, role: parsed.data.role };
      const fill: Record<string, string> = {};
      const conflicts: string[] = [];
      for (const [k, v] of Object.entries(wanted)) {
        if (!v || v.trim().length === 0) continue;
        const current = (p as unknown as Record<string, unknown>)[k];
        if (current === null || current === undefined || current === "") fill[k] = v;
        else if (String(current) !== v) conflicts.push(k);
      }
      if (Object.keys(fill).length > 0) {
        const patched = result.value.lead.patch(fill, ctx.deps.clock.now());
        if (!isOk(patched)) return { ok: false, error: patched.error.message };
        await repo2.save(patched.value);
        p = patched.value.props;
      }
      const added = Object.keys(fill);
      const note =
        (added.length ? ` Added ${added.join(", ")} to their existing record.` : "") +
        (conflicts.length ? ` Left ${conflicts.join(", ")} unchanged — they already have different values on file.` : "");
      return { ok: true, summary: `"${p.name}" already exists (id: ${p.id}).${note}` };
    }

    return { ok: true, summary: `Customer "${p.name}" created — stage ${p.stage} (id: ${p.id}).` };
  },
};

// --- invoice_draft: create a manual/standalone draft invoice ---
// Fingerprints on the lead's name + stage (same as quote_draft).
export const invoiceDraftTool: AgentTool = {
  name: "invoice_draft",
  description:
    "Draft a new invoice for a customer (found via customer_list). Provide line items and optional payment terms. Creates a DRAFT — not sent until invoice_send. TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(invoiceDraftInput),
  input: invoiceDraftInput,
  mutating: true,
  riskTier: "money",
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(invoiceDraftInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const lead = await new DrizzleLeadRepository(ctx.tx, ctx.orgId).findById(asLeadId(parsed.data.leadId));
    return lead ? `lead:${lead.props.id}:${lead.props.name}:${lead.props.stage}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(invoiceDraftInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const lead = await new DrizzleLeadRepository(ctx.tx, ctx.orgId).findById(asLeadId(parsed.data.leadId));
    if (!lead) return { ok: false, error: `customer ${parsed.data.leadId} not found — use customer_list to find the right id` };
    const uc = new DraftInvoiceUseCase(new DrizzleInvoiceRepository(ctx.tx, ctx.orgId), ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
    const result = await uc.exec({
      orgId: ctx.orgId,
      leadId: asLeadId(parsed.data.leadId),
      title: parsed.data.title ?? null,
      termsDays: parsed.data.termsDays ?? 7,
      lines: parsed.data.lines.map((l) => ({ description: l.description, quantity: l.quantity, rateCents: l.rateCents, costCents: 0 })),
    });
    if (!isOk(result)) return { ok: false, error: result.error.message };
    return { ok: true, summary: `Drafted invoice ${result.value.props.num} — total ${money(result.value.props.total)} (id: ${result.value.props.id}).` };
  },
};

// --- invoice_create_from_job: bill a completed job ---
// Idempotent: one invoice per job. Fingerprints on job status (must be complete) + total.
export const invoiceCreateFromJobTool: AgentTool = {
  name: "invoice_create_from_job",
  description:
    "Create a draft invoice from a completed job (found via job_list). Idempotent — calling twice returns the same invoice. TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(invoiceCreateFromJobInput),
  input: invoiceCreateFromJobInput,
  mutating: true,
  riskTier: "money",
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(invoiceCreateFromJobInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const job = await new DrizzleJobRepository(ctx.tx, ctx.orgId).findById(asJobId(parsed.data.jobId));
    return job ? `job:${job.props.id}:${job.props.status}:${job.props.num}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(invoiceCreateFromJobInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const uc = new CreateInvoiceFromJobUseCase(
      new DrizzleInvoiceRepository(ctx.tx, ctx.orgId),
      // The invoicing module's own JobReader adapter — the ONE place that reads a job's
      // priced lines, so the unpriced-estimate guard and the line copy hold here too.
      new DrizzleJobReader(ctx.tx, ctx.orgId),
      new DrizzleEstimateDepositReader(ctx.tx),
      ctx.deps.bus,
      ctx.deps.clock,
      ctx.deps.ids,
    );
    const result = await uc.exec({ orgId: ctx.orgId, jobId: asJobId(parsed.data.jobId) });
    if (!isOk(result)) return { ok: false, error: result.error.message };
    return { ok: true, summary: `Invoice ${result.value.props.num} ready — total ${money(result.value.props.total)} (id: ${result.value.props.id}).` };
  },
};

// --- schedule_visit: add a new scheduled visit to an existing job ---
// Fingerprints on job status + num so a canceled job is caught before adding a visit.
export const scheduleVisitTool: AgentTool = {
  name: "schedule_visit",
  description:
    "Add a new visit to an existing job (found via job_list), assigning a crew member and setting the date, start time, and duration. TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(scheduleVisitInput),
  input: scheduleVisitInput,
  mutating: true,
  riskTier: "operational",
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(scheduleVisitInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const job = await new DrizzleJobRepository(ctx.tx, ctx.orgId).findById(asJobId(parsed.data.jobId));
    return job ? `job:${job.props.id}:${job.props.status}:${job.props.num}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(scheduleVisitInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const uc = new CreateVisitUseCase(new DrizzleJobRepository(ctx.tx, ctx.orgId), ctx.deps.clock, ctx.deps.ids);
    const result = await uc.exec({
      jobId: asJobId(parsed.data.jobId),
      assigneeUserId: asUserId(parsed.data.assigneeUserId),
      scheduledDate: parsed.data.scheduledDate,
      scheduledStart: parsed.data.scheduledStart,
      durationHours: parsed.data.durationHours,
      notes: null,
    });
    if (!isOk(result)) return { ok: false, error: result.error.message };
    const j = result.value.props;
    const visit = j.visits.at(-1);
    const visitId = visit?.props.id ?? "unknown";
    return {
      ok: true,
      summary: `Added visit to job ${j.num} on ${parsed.data.scheduledDate} at ${parsed.data.scheduledStart} for ${parsed.data.durationHours}h (visit id: ${visitId}).`,
    };
  },
};

// ===================== PHASE C — SENSITIVE WRITE TOOLS =====================

// --- invoice_record_payment: record a payment on a sent/partial invoice ---
// SENSITIVE: moves money. Idempotency key minted SERVER-SIDE at propose time via enrichArgs and
// frozen into stored args — a re-confirm replays the same stored key so ON CONFLICT DO NOTHING
// is the anti-double-charge guard. The model never sees or provides the key.
// Fingerprints on invoice status + balance (total − paid) so concurrent payments or a void are caught.
export const invoiceRecordPaymentTool: AgentTool = {
  name: "invoice_record_payment",
  description:
    "Record a payment (cash, check, card, ach, or other) on a sent or partial invoice (found via invoice_list). SENSITIVE: marks money as received. TWO-STEP: first call proposes with an amount and method; second call with confirmToken executes. A second confirm of the same token does not double-charge.",
  inputSchema: jsonSchema(invoiceRecordPaymentInput),
  input: invoiceRecordPaymentWithKeyInput,
  mutating: true,
  riskTier: "money",
  // Inject a server-minted idempotency key at propose time. It is added to the frozen args before
  // fingerprinting, so the confirm leg gets the same key verbatim — no second mint, no double-charge.
  enrichArgs(validated, ctx): Record<string, unknown> {
    return { idempotencyKey: ctx.deps.ids.newId() };
  },
  // Fingerprint on invoice status + balance PLUS the frozen idempotency key.
  // The propose leg passes ENTITY_NOT_FOUND if the invoice is in an unacceptable state;
  // the confirm gate re-computes this and refuses if the balance changed.
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(invoiceRecordPaymentWithKeyInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const inv = await new DrizzleInvoiceRepository(ctx.tx, ctx.orgId).findById(asInvoiceId(parsed.data.invoiceId));
    if (!inv) return ENTITY_NOT_FOUND;
    if (inv.props.status !== "sent" && inv.props.status !== "partial") return ENTITY_NOT_FOUND;
    // Fingerprint: status + balance at proposal time. If payment lands concurrently the balance
    // changes and the confirm gate refuses (drift protection).
    return `invoice:${inv.props.id}:${inv.props.status}:${inv.due()}:idem:${parsed.data.idempotencyKey}`;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(invoiceRecordPaymentWithKeyInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    // The idempotency key was frozen at propose time (server-minted via enrichArgs); a re-confirm
    // carries the same stored value so the underlying repo's ON CONFLICT DO NOTHING guards double-charge.
    const gateway = new ManualPaymentGateway(ctx.deps.clock);
    const uc = new RecordPaymentUseCase(new DrizzleInvoiceRepository(ctx.tx, ctx.orgId), gateway, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
    const result = await uc.exec({
      orgId: ctx.orgId,
      invoiceId: asInvoiceId(parsed.data.invoiceId),
      amount: asMoney(parsed.data.amountCents),
      method: parsed.data.method,
      idempotencyKey: parsed.data.idempotencyKey,
      // The agent acts FOR a signed-in person, and this tool is approval-gated — the ledger records
      // the human who approved it, from the principal, not from the model's arguments.
      recordedByUserId: ctx.principal.userId,
    });
    if (!isOk(result)) return { ok: false, error: result.error.message };
    const p = result.value.props;
    return {
      ok: true,
      summary: `Recorded ${money(parsed.data.amountCents)} ${parsed.data.method} payment on ${p.num} — status now ${p.status}, balance ${money(result.value.due())} (id: ${p.id}).`,
    };
  },
};

// --- invoice_void: void (cancel) an invoice ---
// DESTRUCTIVE. Fingerprints on invoice status + total so a concurrent payment is caught.
export const invoiceVoidTool: AgentTool = {
  name: "invoice_void",
  description:
    "Void (cancel) an invoice (found via invoice_list). DESTRUCTIVE — irreversible. The invoice must be in draft or sent status. TWO-STEP: first call proposes; second call with confirmToken executes.",
  inputSchema: jsonSchema(invoiceVoidInput),
  input: invoiceVoidInput,
  mutating: true,
  riskTier: "destructive",
  async fingerprint(input, ctx): Promise<string> {
    const parsed = parseTool(invoiceVoidInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const inv = await new DrizzleInvoiceRepository(ctx.tx, ctx.orgId).findById(asInvoiceId(parsed.data.invoiceId));
    return inv ? `invoice:${inv.props.id}:${inv.props.status}:${inv.props.total}:${inv.props.amountPaid}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(invoiceVoidInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const uc = new VoidInvoiceUseCase(new DrizzleInvoiceRepository(ctx.tx, ctx.orgId), ctx.deps.bus, ctx.deps.clock);
    const result = await uc.exec({ invoiceId: asInvoiceId(parsed.data.invoiceId) });
    if (!isOk(result)) return { ok: false, error: result.error.message };
    const p = result.value.props;
    return { ok: true, summary: `Voided invoice ${p.num} (id: ${p.id}).` };
  },
};

// --- timesheet_approve_week: approve a tech's timesheet entries for a set of dates ---
// SENSITIVE: payroll approval. Fingerprints on userId + date range so approving the wrong week
// is surfaced before execution.
export const timesheetApproveWeekTool: AgentTool = {
  name: "timesheet_approve_week",
  description:
    "Approve all timesheet entries for a crew member on the given dates (use member_list for techUserId, timesheet_list for dates). SENSITIVE: payroll approval. TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(timesheetApproveWeekInput),
  input: timesheetApproveWeekInput,
  mutating: true,
  // money, not operational — despite touching no invoice. Approval is "the only trigger for hours
  // leaving Mallet" to QuickBooks (approve-week.ts's own words) and "unrecoverable through this
  // tool: re-approving returns count 0." `operational` auto-approves unattended at `assisted`;
  // a task like "close out last week's hours" would then push a tech's pay to payroll with nobody
  // looking, which is exactly what the owner-facing settings copy promises never happens ("Prices,
  // payments and anything it can't undo still come to you."). Do not move this back down to
  // tidy the comment blocks below — see risk-tier.test.ts's dedicated assertion.
  riskTier: "money",
  // Fingerprint on userId + sorted dates so any change in the approval scope is caught at confirm.
  async fingerprint(input, _ctx): Promise<string> {
    const parsed = parseTool(timesheetApproveWeekInput, input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const sortedDates = [...parsed.data.dates].sort().join(",");
    return `timesheet-approve:${parsed.data.techUserId}:${sortedDates}`;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = parseTool(timesheetApproveWeekInput, input);
    if (!parsed.success) return invalid(parsed.error.issues);
    // The bus is NOT optional in practice. approve-week.ts calls approval "the only trigger for
    // hours leaving Mallet": without it, `timeEntry.weekApproved` never fires, QboTimeSyncHandler
    // never runs, and the hours an owner just approved never reach QuickBooks. The rows still flip
    // to `approved` and the tool still answers "Approved 12 entries", so the failure is invisible
    // until someone notices missing TimeActivity rows in QBO.
    //
    // Unrecoverable through this tool, too — re-approving returns count 0, and the emit is guarded
    // on `count > 0`, so wiring the bus later would not re-fire the ones already approved.
    const uc = new ApproveWeekUseCase(new DrizzleTimeEntryRepository(ctx.tx, ctx.orgId), ctx.deps.clock, ctx.deps.bus);
    const result = await uc.exec(
      {
        techUserId: asUserId(parsed.data.techUserId),
        dates: parsed.data.dates,
      },
      ctx.orgId,
    );
    if (!isOk(result)) return { ok: false, error: result.error.message };
    return { ok: true, summary: `Approved ${result.value.approved} timesheet entries for ${parsed.data.techUserId} on ${parsed.data.dates.join(", ")}.` };
  },
};
