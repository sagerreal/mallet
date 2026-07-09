import { toPage, isOk, asLeadId, asInvoiceId, asEstimateId, asJobId, asTaskId, asCompanyId, asTimeEntryId, asUserId, asVisitId, money as asMoney } from "@mallet/shared/types";
import { DrizzleLeadRepository, EnsureCustomerUseCase } from "@mallet/customers";
import {
  DrizzleInvoiceRepository,
  SendInvoiceUseCase,
  DraftInvoiceUseCase,
  CreateInvoiceFromJobUseCase,
  RecordPaymentUseCase,
  VoidInvoiceUseCase,
} from "@mallet/invoicing";
import { DrizzleEstimateRepository, DraftEstimateUseCase, SendEstimateUseCase } from "@mallet/quoting";
import { DrizzleJobRepository, ScheduleJobUseCase, AssignJobUseCase } from "@mallet/jobs";
import { DrizzleTaskRepository, CreateTaskUseCase } from "@mallet/tasks";
import { DrizzleTimeEntryRepository, ApproveWeekUseCase } from "@mallet/timesheets";
import {
  SendInvoiceNotificationUseCase,
  SendNotificationUseCase,
} from "@mallet/notifications";
import { DrizzleNotificationRepository } from "../../../notifications/infra/drizzle-notification-repository";
import { DrizzleReminderTargetReader } from "../../../notifications/infra/drizzle-reminder-target-reader";
import { ManualPaymentGateway } from "../../../invoicing/infra/manual-payment-gateway";
import { CreateVisitUseCase } from "../../../jobs/app/create-visit";
import type { AgentTool, ToolOutcome } from "../../domain/tool";
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
  // What the human approved is "a quote for THIS customer" — if the lead is renamed/re-staged (or
  // vanishes) between propose and confirm, the confirm gate refuses and asks for a fresh proposal.
  async fingerprint(input, ctx): Promise<string> {
    const parsed = quoteDraftInput.safeParse(input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const lead = await new DrizzleLeadRepository(ctx.tx, ctx.orgId).findById(asLeadId(parsed.data.leadId));
    return lead ? `lead:${lead.props.id}:${lead.props.name}:${lead.props.stage}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = quoteDraftInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    // Verify the customer exists so a bad/typo'd leadId is a clean, self-correctable error.
    const lead = await new DrizzleLeadRepository(ctx.tx, ctx.orgId).findById(asLeadId(parsed.data.leadId));
    if (!lead) return { ok: false, error: `customer ${parsed.data.leadId} not found — use customer_list to find the right id` };
    const uc = new DraftEstimateUseCase(new DrizzleEstimateRepository(ctx.tx, ctx.orgId), ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
    const result = await uc.exec({
      orgId: ctx.orgId,
      leadId: asLeadId(parsed.data.leadId),
      title: parsed.data.title ?? null,
      discBps: 0,
      taxBps: parsed.data.taxBps ?? 0,
      depBps: parsed.data.depBps ?? 0,
      validDays: null,
      lines: parsed.data.lines.map((l) => ({ description: l.description, quantity: l.quantity, rateCents: l.rateCents, costCents: 0, isOptional: l.isOptional ?? false, needsPhoto: false })),
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
  // The human approved sending THIS invoice at THIS total/status — if it was edited, paid against,
  // or voided between propose and confirm, the confirm gate refuses rather than send stale terms.
  async fingerprint(input, ctx): Promise<string> {
    const parsed = invoiceSendInput.safeParse(input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const invoice = await new DrizzleInvoiceRepository(ctx.tx, ctx.orgId).findById(asInvoiceId(parsed.data.invoiceId));
    return invoice ? `invoice:${invoice.props.id}:${invoice.props.status}:${invoice.props.total}:${invoice.props.amountPaid}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = invoiceSendInput.safeParse(input);
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
  async fingerprint(input, ctx): Promise<string> {
    const parsed = quoteSendInput.safeParse(input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const est = await new DrizzleEstimateRepository(ctx.tx, ctx.orgId).findById(asEstimateId(parsed.data.estimateId));
    return est ? `estimate:${est.props.id}:${est.props.status}:${est.total()}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = quoteSendInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const uc = new SendEstimateUseCase(new DrizzleEstimateRepository(ctx.tx, ctx.orgId), ctx.deps.bus, ctx.deps.clock);
    const result = await uc.exec({ estimateId: asEstimateId(parsed.data.estimateId) });
    if (!isOk(result)) return { ok: false, error: result.error.message };
    return { ok: true, summary: `Sent estimate ${result.value.props.num} (id: ${result.value.props.id}).` };
  },
};

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
  async fingerprint(input, ctx): Promise<string> {
    const parsed = notificationSendInvoiceReminderInput.safeParse(input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const inv = await new DrizzleInvoiceRepository(ctx.tx, ctx.orgId).findById(asInvoiceId(parsed.data.invoiceId));
    return inv ? `invoice:${inv.props.id}:${inv.props.status}:${inv.props.total}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = notificationSendInvoiceReminderInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    if (!ctx.deps.notificationSender) {
      return { ok: false, error: "notification sender not configured — contact your administrator" };
    }
    const repo = new DrizzleNotificationRepository(ctx.tx, ctx.orgId);
    const reader = new DrizzleReminderTargetReader(ctx.tx, ctx.orgId);
    const sendUc = new SendNotificationUseCase(repo, ctx.deps.notificationSender, ctx.deps.bus, ctx.deps.clock, ctx.deps.ids);
    const uc = new SendInvoiceNotificationUseCase(reader, sendUc, ctx.deps.ids);
    const result = await uc.exec({ orgId: ctx.orgId, invoiceId: parsed.data.invoiceId, channel: parsed.data.channel });
    if (!isOk(result)) return { ok: false, error: result.error.message };
    const p = result.value.props;
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
  async fingerprint(input, ctx): Promise<string> {
    const parsed = jobScheduleInput.safeParse(input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const lead = await new DrizzleLeadRepository(ctx.tx, ctx.orgId).findById(asLeadId(parsed.data.leadId));
    return lead ? `lead:${lead.props.id}:${lead.props.name}:${lead.props.stage}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = jobScheduleInput.safeParse(input);
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
    "Assign a job to a crew member (found via member_list). Pass assigneeUserId as null to unassign. TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(jobAssignInput),
  input: jobAssignInput,
  mutating: true,
  async fingerprint(input, ctx): Promise<string> {
    const parsed = jobAssignInput.safeParse(input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const job = await new DrizzleJobRepository(ctx.tx, ctx.orgId).findById(asJobId(parsed.data.jobId));
    return job ? `job:${job.props.id}:${job.props.status}:${job.props.assigneeUserId ?? "unassigned"}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = jobAssignInput.safeParse(input);
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

// --- task_create: create a new task ---
// Fingerprints on the linked lead's name if present (so a renamed/removed lead is caught).
export const taskCreateTool: AgentTool = {
  name: "task_create",
  description:
    "Create a new task with optional due date and customer link (found via customer_list). TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(taskCreateInput),
  input: taskCreateInput,
  mutating: true,
  async fingerprint(input, ctx): Promise<string> {
    const parsed = taskCreateInput.safeParse(input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    // Fingerprint the linked lead if provided; otherwise fingerprint the task text (no drift possible).
    if (parsed.data.leadId) {
      const lead = await new DrizzleLeadRepository(ctx.tx, ctx.orgId).findById(asLeadId(parsed.data.leadId));
      return lead ? `lead:${lead.props.id}:${lead.props.name}` : ENTITY_NOT_FOUND;
    }
    return `task:text:${parsed.data.text.slice(0, 80)}`;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = taskCreateInput.safeParse(input);
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
    "Create a new customer (or return the existing one with the same name). TWO-STEP: first call proposes, second call with confirmToken executes.",
  inputSchema: jsonSchema(customerCreateInput),
  input: customerCreateInput,
  mutating: true,
  async fingerprint(input, _ctx): Promise<string> {
    const parsed = customerCreateInput.safeParse(input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    // No pre-existing entity to drift on — fingerprint the proposed name so the human sees exactly what they approved.
    return `new-customer:${parsed.data.name}`;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = customerCreateInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const uc = new EnsureCustomerUseCase(new DrizzleLeadRepository(ctx.tx, ctx.orgId), ctx.deps.bus, ctx.deps.clock);
    const result = await uc.exec({
      name: parsed.data.name,
      phone: null,
      email: null,
      source: parsed.data.source ?? null,
      companyId: parsed.data.companyId ? asCompanyId(parsed.data.companyId) : null,
      role: parsed.data.role ?? null,
    });
    if (!isOk(result)) return { ok: false, error: result.error.message };
    const p = result.value.props;
    return { ok: true, summary: `Customer "${p.name}" ready — stage ${p.stage} (id: ${p.id}).` };
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
  async fingerprint(input, ctx): Promise<string> {
    const parsed = invoiceDraftInput.safeParse(input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const lead = await new DrizzleLeadRepository(ctx.tx, ctx.orgId).findById(asLeadId(parsed.data.leadId));
    return lead ? `lead:${lead.props.id}:${lead.props.name}:${lead.props.stage}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = invoiceDraftInput.safeParse(input);
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
  async fingerprint(input, ctx): Promise<string> {
    const parsed = invoiceCreateFromJobInput.safeParse(input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const job = await new DrizzleJobRepository(ctx.tx, ctx.orgId).findById(asJobId(parsed.data.jobId));
    return job ? `job:${job.props.id}:${job.props.status}:${job.props.num}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = invoiceCreateFromJobInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const jobRepo = new DrizzleJobRepository(ctx.tx, ctx.orgId);
    const uc = new CreateInvoiceFromJobUseCase(
      new DrizzleInvoiceRepository(ctx.tx, ctx.orgId),
      {
        // The jobs module exports DrizzleJobRepository which satisfies the JobReader port.
        read: async (id) => {
          const job = await jobRepo.findById(id);
          if (!job) return null;
          return {
            id: job.props.id,
            leadId: job.props.leadId,
            status: job.props.status,
            title: job.props.title,
            totalCents: job.props.total,
          };
        },
      },
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
  async fingerprint(input, ctx): Promise<string> {
    const parsed = scheduleVisitInput.safeParse(input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const job = await new DrizzleJobRepository(ctx.tx, ctx.orgId).findById(asJobId(parsed.data.jobId));
    return job ? `job:${job.props.id}:${job.props.status}:${job.props.num}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = scheduleVisitInput.safeParse(input);
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
  // Inject a server-minted idempotency key at propose time. It is added to the frozen args before
  // fingerprinting, so the confirm leg gets the same key verbatim — no second mint, no double-charge.
  enrichArgs(validated, ctx): Record<string, unknown> {
    return { idempotencyKey: ctx.deps.ids.newId() };
  },
  // Fingerprint on invoice status + balance PLUS the frozen idempotency key.
  // The propose leg passes ENTITY_NOT_FOUND if the invoice is in an unacceptable state;
  // the confirm gate re-computes this and refuses if the balance changed.
  async fingerprint(input, ctx): Promise<string> {
    const parsed = invoiceRecordPaymentWithKeyInput.safeParse(input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const inv = await new DrizzleInvoiceRepository(ctx.tx, ctx.orgId).findById(asInvoiceId(parsed.data.invoiceId));
    if (!inv) return ENTITY_NOT_FOUND;
    if (inv.props.status !== "sent" && inv.props.status !== "partial") return ENTITY_NOT_FOUND;
    // Fingerprint: status + balance at proposal time. If payment lands concurrently the balance
    // changes and the confirm gate refuses (drift protection).
    return `invoice:${inv.props.id}:${inv.props.status}:${inv.due()}:idem:${parsed.data.idempotencyKey}`;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = invoiceRecordPaymentWithKeyInput.safeParse(input);
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
  async fingerprint(input, ctx): Promise<string> {
    const parsed = invoiceVoidInput.safeParse(input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const inv = await new DrizzleInvoiceRepository(ctx.tx, ctx.orgId).findById(asInvoiceId(parsed.data.invoiceId));
    return inv ? `invoice:${inv.props.id}:${inv.props.status}:${inv.props.total}:${inv.props.amountPaid}` : ENTITY_NOT_FOUND;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = invoiceVoidInput.safeParse(input);
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
  // Fingerprint on userId + sorted dates so any change in the approval scope is caught at confirm.
  async fingerprint(input, _ctx): Promise<string> {
    const parsed = timesheetApproveWeekInput.safeParse(input);
    if (!parsed.success) return ENTITY_NOT_FOUND;
    const sortedDates = [...parsed.data.dates].sort().join(",");
    return `timesheet-approve:${parsed.data.techUserId}:${sortedDates}`;
  },
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = timesheetApproveWeekInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const uc = new ApproveWeekUseCase(new DrizzleTimeEntryRepository(ctx.tx, ctx.orgId), ctx.deps.clock);
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
