import { z } from "zod";
import { eq } from "drizzle-orm";
import { users, orgs } from "@mallet/shared/db/schema";
import { toPage, asLeadId, asInvoiceId, asEstimateId, asJobId, asCompanyId } from "@mallet/shared/types";
import { ListLeadsUseCase, DrizzleLeadRepository } from "@mallet/customers";
import { ListInvoicesUseCase, DrizzleInvoiceRepository } from "@mallet/invoicing";
import { ListEstimatesUseCase, DrizzleEstimateRepository } from "@mallet/quoting";
import { ListJobsUseCase, DrizzleJobRepository } from "@mallet/jobs";
import { ListTasksUseCase, DrizzleTaskRepository } from "@mallet/tasks";
import { ListTimeEntriesUseCase, DrizzleTimeEntryRepository } from "@mallet/timesheets";
import { ListCompaniesUseCase, DrizzleCompanyRepository } from "@mallet/companies";
import { NextRemindersDueUseCase, FollowUpPolicy } from "@mallet/notifications";
import { DrizzleNotificationRepository } from "../../../notifications/infra/drizzle-notification-repository";
import { DrizzleReminderTargetReader } from "../../../notifications/infra/drizzle-reminder-target-reader";
import type { AgentTool, ToolContext, ToolOutcome } from "../../domain/tool";
import {
  money,
  jsonSchema,
  invalid,
  listInput,
  invoiceListInput,
  estimateListInput,
  customerGetInput,
  estimateGetInput,
  invoiceGetInput,
  jobListInput,
  jobGetInput,
  taskListInput,
  memberListInput,
  companyListInput,
  companyGetInput,
  timesheetListInput,
  notificationDueRemindersInput,
} from "./shared";

// ---------------------------------------------------------------------------
// READ TOOLS — all mutating: false, no human-approval gate required.
// ---------------------------------------------------------------------------

// ===================== CONTEXT TOOL =====================

// --- get_context: returns the org's name + today's date ---
// This is the model's first call on every fresh turn. It keeps the cached system prompt byte-identical
// (no tenant data there) while giving the model the two facts it needs to address the user correctly.
const contextInput = z.object({});

export const getContextTool: AgentTool = {
  name: "get_context",
  description:
    "Returns the org's display name and today's ISO date. Call this at the start of a new conversation so you can address the team correctly and reason about dates.",
  inputSchema: jsonSchema(contextInput),
  input: contextInput,
  mutating: false,
  async handle(_input, ctx): Promise<ToolOutcome> {
    const rows = await ctx.tx.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, ctx.orgId)).limit(1);
    const orgName = rows[0]?.name ?? "your organization";
    const todayISO = ctx.deps.clock.now().toISOString().slice(0, 10);
    return { ok: true, summary: JSON.stringify({ orgName, todayISO }) };
  },
};

// ===================== EXISTING READ TOOLS =====================

export const customerListTool: AgentTool = {
  name: "customer_list",
  description: "List the org's customers/leads (most recent first). Returns each customer's name, stage, and id. Use the id to reference a customer in other tools.",
  inputSchema: jsonSchema(listInput),
  input: listInput,
  mutating: false,
  async handle(input, ctx: ToolContext): Promise<ToolOutcome> {
    const parsed = listInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const page = await new ListLeadsUseCase(new DrizzleLeadRepository(ctx.tx, ctx.orgId)).exec({
      page: toPage({ limit: parsed.data.limit ?? 20, cursor: null }),
    });
    if (page.items.length === 0) return { ok: true, summary: "No customers found." };
    return {
      ok: true,
      summary: page.items.map((l) => `${l.props.name} — stage ${l.props.stage} [id: ${l.props.id}]`).join("\n"),
    };
  },
};

export const invoiceListTool: AgentTool = {
  name: "invoice_list",
  description: "List the org's invoices (most recent first), optionally filtered by status. Returns each invoice's number, status, total, and balance due, with its id.",
  inputSchema: jsonSchema(invoiceListInput),
  input: invoiceListInput,
  mutating: false,
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = invoiceListInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const page = await new ListInvoicesUseCase(new DrizzleInvoiceRepository(ctx.tx, ctx.orgId)).exec({
      page: toPage({ limit: parsed.data.limit ?? 20, cursor: null }),
      filter: parsed.data.status ? { status: parsed.data.status } : undefined,
    });
    if (page.items.length === 0) return { ok: true, summary: "No invoices found." };
    return {
      ok: true,
      summary: page.items.map((inv) => `${inv.props.num} — ${inv.props.status} — total ${money(inv.props.total)}, due ${money(inv.due())} [id: ${inv.props.id}]`).join("\n"),
    };
  },
};

export const estimateListTool: AgentTool = {
  name: "estimate_list",
  description: "List the org's estimates/quotes (most recent first), optionally filtered by status. Returns each estimate's number, status, and total, with its id.",
  inputSchema: jsonSchema(estimateListInput),
  input: estimateListInput,
  mutating: false,
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = estimateListInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const page = await new ListEstimatesUseCase(new DrizzleEstimateRepository(ctx.tx, ctx.orgId)).exec({
      page: toPage({ limit: parsed.data.limit ?? 20, cursor: null }),
      filter: parsed.data.status ? { status: parsed.data.status } : undefined,
    });
    if (page.items.length === 0) return { ok: true, summary: "No estimates found." };
    return { ok: true, summary: page.items.map((e) => `${e.props.num} — ${e.props.status} — total ${money(e.total())} [id: ${e.props.id}]`).join("\n") };
  },
};

// ===================== PLATFORM READ TOOLS (Phase A) =====================

// --- customer_get: fetch one customer by id ---
export const customerGetTool: AgentTool = {
  name: "customer_get",
  description: "Fetch a single customer/lead by id (use customer_list to find ids). Returns the customer's name, stage, and any linked company id.",
  inputSchema: jsonSchema(customerGetInput),
  input: customerGetInput,
  mutating: false,
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = customerGetInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const lead = await new DrizzleLeadRepository(ctx.tx, ctx.orgId).findById(asLeadId(parsed.data.customerId));
    if (!lead) return { ok: false, error: `customer ${parsed.data.customerId} not found — use customer_list to find the right id` };
    const p = lead.props;
    const parts = [`${p.name} — stage ${p.stage}`];
    if (p.companyId) parts.push(`company id: ${p.companyId}`);
    if (p.role) parts.push(`role: ${p.role}`);
    parts.push(`[id: ${p.id}]`);
    return { ok: true, summary: parts.join(" | ") };
  },
};

// --- estimate_get: fetch one estimate by id ---
export const estimateGetTool: AgentTool = {
  name: "estimate_get",
  description: "Fetch a single estimate/quote by id (use estimate_list to find ids). Returns the estimate's number, status, total, and line items.",
  inputSchema: jsonSchema(estimateGetInput),
  input: estimateGetInput,
  mutating: false,
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = estimateGetInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const estimate = await new DrizzleEstimateRepository(ctx.tx, ctx.orgId).findById(asEstimateId(parsed.data.estimateId));
    if (!estimate) return { ok: false, error: `estimate ${parsed.data.estimateId} not found — use estimate_list to find the right id` };
    const p = estimate.props;
    const linesSummary = p.lines.map((l) => `  ${l.props.description} x${l.props.quantity} @ ${money(l.props.rate)}`).join("\n");
    return { ok: true, summary: `${p.num} — ${p.status} — total ${money(estimate.total())} [id: ${p.id}]\nLines:\n${linesSummary}` };
  },
};

// --- invoice_get: fetch one invoice by id ---
export const invoiceGetTool: AgentTool = {
  name: "invoice_get",
  description: "Fetch a single invoice by id (use invoice_list to find ids). Returns the invoice's number, status, total, amount paid, and balance due.",
  inputSchema: jsonSchema(invoiceGetInput),
  input: invoiceGetInput,
  mutating: false,
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = invoiceGetInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const invoice = await new DrizzleInvoiceRepository(ctx.tx, ctx.orgId).findById(asInvoiceId(parsed.data.invoiceId));
    if (!invoice) return { ok: false, error: `invoice ${parsed.data.invoiceId} not found — use invoice_list to find the right id` };
    const p = invoice.props;
    return {
      ok: true,
      summary: `${p.num} — ${p.status} — total ${money(p.total)}, paid ${money(p.amountPaid)}, due ${money(invoice.due())} [id: ${p.id}]`,
    };
  },
};

// --- job_list: list jobs optionally filtered by status ---
export const jobListTool: AgentTool = {
  name: "job_list",
  description: "List the org's field jobs (most recent first), optionally filtered by status. Returns each job's number, status, title, and id.",
  inputSchema: jsonSchema(jobListInput),
  input: jobListInput,
  mutating: false,
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = jobListInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const page = await new ListJobsUseCase(new DrizzleJobRepository(ctx.tx, ctx.orgId)).exec({
      page: toPage({ limit: parsed.data.limit ?? 20, cursor: null }),
      filter: parsed.data.status ? { status: parsed.data.status } : undefined,
    });
    if (page.items.length === 0) return { ok: true, summary: "No jobs found." };
    return {
      ok: true,
      summary: page.items
        .map((j) => {
          const p = j.props;
          const title = p.title ? ` — ${p.title}` : "";
          const assignee = p.assigneeUserId ? " — assigned" : "";
          return `${p.num}${title} — ${p.status}${assignee} [id: ${p.id}]`;
        })
        .join("\n"),
    };
  },
};

// --- job_get: fetch one job by id, including visits ---
export const jobGetTool: AgentTool = {
  name: "job_get",
  description: "Fetch a single field job by id (use job_list to find ids). Returns the job's number, status, title, assignee, scheduled window, and all visits with their dates and status.",
  inputSchema: jsonSchema(jobGetInput),
  input: jobGetInput,
  mutating: false,
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = jobGetInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const job = await new DrizzleJobRepository(ctx.tx, ctx.orgId).findById(asJobId(parsed.data.jobId));
    if (!job) return { ok: false, error: `job ${parsed.data.jobId} not found — use job_list to find the right id` };
    const p = job.props;
    const lines: string[] = [`${p.num} — ${p.status}${p.title ? ` — ${p.title}` : ""} [id: ${p.id}]`];
    if (p.assigneeUserId) lines.push(`assignee: ${p.assigneeUserId}`);
    if (p.scheduledStart) lines.push(`scheduled: ${p.scheduledStart.toISOString()} → ${p.scheduledEnd?.toISOString() ?? "open"}`);
    if (p.visits.length > 0) {
      lines.push("visits:");
      for (const v of p.visits) {
        const vp = v.props;
        const date = vp.scheduledDate ?? "unscheduled";
        const time = vp.scheduledStart ? `${vp.scheduledStart}–${vp.scheduledEnd ?? "?"}` : "";
        lines.push(`  ${date} ${time} — ${vp.status} [visit id: ${vp.id}]`);
      }
    }
    return { ok: true, summary: lines.join("\n") };
  },
};

// --- task_list: list tasks optionally filtered by done status ---
export const taskListTool: AgentTool = {
  name: "task_list",
  description: "List the org's tasks (oldest first), optionally filtered by completion status. Returns each task's text, due date, and id.",
  inputSchema: jsonSchema(taskListInput),
  input: taskListInput,
  mutating: false,
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = taskListInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const page = await new ListTasksUseCase(new DrizzleTaskRepository(ctx.tx, ctx.orgId)).exec({
      page: toPage({ limit: parsed.data.limit ?? 20, cursor: null }),
      filter: parsed.data.done !== undefined ? { done: parsed.data.done } : undefined,
    });
    if (page.items.length === 0) return { ok: true, summary: "No tasks found." };
    return {
      ok: true,
      summary: page.items
        .map((t) => {
          const p = t.props;
          const due = p.dueDate ? ` due ${p.dueDate}` : "";
          const done = p.done ? " [done]" : "";
          return `${p.text}${due}${done} [id: ${p.id}]`;
        })
        .join("\n"),
    };
  },
};

// --- member_list: list the org's users (crew roster) ---
// Members are read directly from the users table via the tenant tx — there is no domain use-case
// for listing members (the identity module exposes this via the tRPC router, not a use-case class).
// This mirrors the identity router's `members` query exactly.
export const memberListTool: AgentTool = {
  name: "member_list",
  description: "List the org's team members. Returns each member's display name, role, and id. Use the id to reference a member when assigning jobs.",
  inputSchema: jsonSchema(memberListInput),
  input: memberListInput,
  mutating: false,
  async handle(_input, ctx): Promise<ToolOutcome> {
    const rows = await ctx.tx
      .select({ id: users.id, name: users.name, role: users.role, isFieldCrew: users.isFieldCrew })
      .from(users)
      .where(eq(users.orgId, ctx.orgId));
    if (rows.length === 0) return { ok: true, summary: "No members found." };
    return {
      ok: true,
      summary: rows
        .map((r) => {
          const display = r.name ?? "(no name)";
          const crew = r.isFieldCrew ? " [field crew]" : "";
          return `${display} — ${r.role}${crew} [id: ${r.id}]`;
        })
        .join("\n"),
    };
  },
};

// --- company_list: list B2B companies ---
export const companyListTool: AgentTool = {
  name: "company_list",
  description: "List the org's B2B company accounts (most recent first). Returns each company's name and id.",
  inputSchema: jsonSchema(companyListInput),
  input: companyListInput,
  mutating: false,
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = companyListInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const page = await new ListCompaniesUseCase(new DrizzleCompanyRepository(ctx.tx, ctx.orgId)).exec({
      page: toPage({ limit: parsed.data.limit ?? 20, cursor: null }),
    });
    if (page.items.length === 0) return { ok: true, summary: "No companies found." };
    return {
      ok: true,
      summary: page.items.map((c) => `${c.props.name}${c.props.address ? ` — ${c.props.address}` : ""} [id: ${c.props.id}]`).join("\n"),
    };
  },
};

// --- company_get: fetch one company by id ---
export const companyGetTool: AgentTool = {
  name: "company_get",
  description: "Fetch a single B2B company by id (use company_list to find ids). Returns the company's name, address, website, and notes.",
  inputSchema: jsonSchema(companyGetInput),
  input: companyGetInput,
  mutating: false,
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = companyGetInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const company = await new DrizzleCompanyRepository(ctx.tx, ctx.orgId).findById(asCompanyId(parsed.data.companyId));
    if (!company) return { ok: false, error: `company ${parsed.data.companyId} not found — use company_list to find the right id` };
    const p = company.props;
    const parts = [p.name];
    if (p.address) parts.push(`address: ${p.address}`);
    if (p.website) parts.push(`website: ${p.website}`);
    if (p.notes) parts.push(`notes: ${p.notes}`);
    parts.push(`[id: ${p.id}]`);
    return { ok: true, summary: parts.join(" | ") };
  },
};

// --- timesheet_list: list time entries with optional date/user filters ---
export const timesheetListTool: AgentTool = {
  name: "timesheet_list",
  description: "List the org's timesheet entries, optionally filtered by date range. Returns each entry's date, kind, hours, and status.",
  inputSchema: jsonSchema(timesheetListInput),
  input: timesheetListInput,
  mutating: false,
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = timesheetListInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const page = await new ListTimeEntriesUseCase(new DrizzleTimeEntryRepository(ctx.tx, ctx.orgId)).exec({
      page: toPage({ limit: parsed.data.limit ?? 20, cursor: null }),
      filter: {
        fromDate: parsed.data.fromDate,
        toDate: parsed.data.toDate,
      },
    });
    if (page.items.length === 0) return { ok: true, summary: "No timesheet entries found." };
    return {
      ok: true,
      summary: page.items
        .map((e) => {
          const p = e.props;
          const hrs = e.hours();
          const duration = hrs !== null ? `${hrs.toFixed(2)}h` : `${p.startTime}–running`;
          return `${p.workDate} — ${p.kind} — ${duration} — ${p.status} [id: ${p.id}]`;
        })
        .join("\n"),
    };
  },
};

// --- notification_list_due_reminders: invoices whose next follow-up reminder is due ---
// Uses NextRemindersDueUseCase (the scheduler's query): open invoices (sent/partial) whose
// next reminder stage is due now and not yet sent. Useful for "who should I remind?" queries.
export const notificationDueRemindersTool: AgentTool = {
  name: "notification_list_due_reminders",
  description: "List invoices whose next follow-up reminder is due now (not yet sent). Returns each invoice's number, id, and which reminder stage is next.",
  inputSchema: jsonSchema(notificationDueRemindersInput),
  input: notificationDueRemindersInput,
  mutating: false,
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = notificationDueRemindersInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const repo = new DrizzleNotificationRepository(ctx.tx, ctx.orgId);
    const reader = new DrizzleReminderTargetReader(ctx.tx, ctx.orgId);
    const policy = new FollowUpPolicy();
    const uc = new NextRemindersDueUseCase(reader, repo, policy);
    const page = await uc.exec(ctx.deps.clock.now(), toPage({ limit: parsed.data.limit ?? 20, cursor: null }));
    if (page.items.length === 0) return { ok: true, summary: "No reminders due." };
    return {
      ok: true,
      summary: page.items.map((r) => `${r.num} — stage ${r.stage} reminder due [${r.relatedType} id: ${r.relatedId}]`).join("\n"),
    };
  },
};
