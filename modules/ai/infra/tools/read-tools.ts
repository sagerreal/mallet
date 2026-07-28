import { z } from "zod";
import { eq } from "drizzle-orm";
import { users, orgs, orgSettings } from "@mallet/shared/db/schema";
import { toPage, isOk, Phone, asLeadId, asInvoiceId, asEstimateId, asJobId, asCompanyId } from "@mallet/shared/types";
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
  customerFindInput,
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
    "Returns the org's display name, today's date IN THE ORG'S OWN TIMEZONE, and that timezone. Call this at the start of a new conversation so you can address the team correctly and reason about dates.",
  inputSchema: jsonSchema(contextInput),
  input: contextInput,
  mutating: false,
  async handle(_input, ctx): Promise<ToolOutcome> {
    const rows = await ctx.tx.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, ctx.orgId)).limit(1);
    const orgName = rows[0]?.name ?? "your organization";

    // The org's OWN timezone, not UTC. toISOString() rolls over at midnight UTC — 5pm Pacific —
    // so every evening the agent believed it was already tomorrow and would schedule "today" onto
    // the wrong day. org_settings.timezone is NOT NULL with a default, so a shop always has one.
    const tzRows = await ctx.tx
      .select({ timezone: orgSettings.timezone })
      .from(orgSettings)
      .where(eq(orgSettings.orgId, ctx.orgId))
      .limit(1);
    const timezone = tzRows[0]?.timezone ?? "America/Los_Angeles";
    // en-CA formats as YYYY-MM-DD, which is the ISO date shape without hand-assembling parts.
    const todayISO = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(ctx.deps.clock.now());

    return { ok: true, summary: JSON.stringify({ orgName, todayISO, timezone }) };
  },
};

// ===================== EXISTING READ TOOLS =====================

export const customerListTool: AgentTool = {
  name: "customer_list",
  description: "List the org's customers/leads (most recent first). Returns each customer's name, phone, email, stage and id. Use the id to reference a customer in other tools.",
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
      // Phone and email are on the row already. Omitting them meant "what's Dave's number" —
      // about the most ordinary question a shop asks — had no answer, and the agent could not
      // hand a number to click-to-call or a text without a second lookup that also lacked it.
      summary: page.items
        .map((l) => {
          const q = l.props;
          const bits = [`${q.name} — stage ${q.stage}`];
          if (q.phone) bits.push(String(q.phone));
          if (q.email) bits.push(q.email);
          return `${bits.join(" | ")} [id: ${q.id}]`;
        })
        .join("\n"),
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
      // leadId, title and dueAt were all on the row and none were printed. Without leadId the
      // agent can list invoices and list customers and has no way to connect the two; without
      // dueAt it cannot answer "who is overdue" even by filtering client-side.
      summary: page.items
        .map((inv) => {
          const q = inv.props;
          const bits = [`${q.num} — ${q.status}`];
          if (q.title) bits.push(`"${q.title}"`);
          bits.push(`total ${money(q.total)}, balance ${money(inv.due())}`);
          if (q.dueAt) bits.push(`due ${q.dueAt.toISOString().slice(0, 10)}`);
          return `${bits.join(" — ")} [id: ${q.id}, customer: ${q.leadId}]`;
        })
        .join("\n"),
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
    return {
      ok: true,
      summary: page.items
        .map((e) => {
          const q = e.props;
          const bits = [`${q.num} — ${q.status}`];
          if (q.title) bits.push(`"${q.title}"`);
          bits.push(`total ${money(e.total())}`);
          // A tiered quote reported as a single total is a misleading answer, not a terse one.
          if (q.recommendedTier) bits.push(`tiered (recommended: ${q.recommendedTier})`);
          if (q.acceptedTier) bits.push(`accepted: ${q.acceptedTier}`);
          if (q.changeRequestedAt) bits.push("CHANGES REQUESTED");
          return `${bits.join(" — ")} [id: ${q.id}, customer: ${q.leadId}]`;
        })
        .join("\n"),
    };
  },
};

// ===================== PLATFORM READ TOOLS (Phase A) =====================

// --- customer_get: fetch one customer by id ---
export const customerGetTool: AgentTool = {
  name: "customer_get",
  description: "Fetch a single customer/lead by id (use customer_list to find ids). Returns name, phone, email, service address, stage, notes and any linked company.",
  inputSchema: jsonSchema(customerGetInput),
  input: customerGetInput,
  mutating: false,
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = customerGetInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    const lead = await new DrizzleLeadRepository(ctx.tx, ctx.orgId).findById(asLeadId(parsed.data.customerId));
    if (!lead) return { ok: false, error: `customer ${parsed.data.customerId} not found — use customer_list to find the right id` };
    const p = lead.props;
    // Everything below was already on the record and simply not printed. A customer detail view
    // that omits the phone number and the address is not a detail view.
    const parts = [`${p.name} — stage ${p.stage}`];
    if (p.phone) parts.push(`phone: ${p.phone}`);
    if (p.email) parts.push(`email: ${p.email}`);
    if (p.address) parts.push(`address: ${p.address}`);
    if (p.companyId) parts.push(`company id: ${p.companyId}`);
    if (p.role) parts.push(`role: ${p.role}`);
    if (p.notes) parts.push(`notes: ${p.notes}`);
    parts.push(`[id: ${p.id}]`);
    return { ok: true, summary: parts.join(" | ") };
  },
};

// --- customer_find: look a customer up by phone number ---
export const customerFindTool: AgentTool = {
  name: "customer_find",
  description:
    "Find a customer by phone number, in any format ((781) 385-0591, 781-385-0591, +17813850591). Use this when you have a number rather than an id — for an inbound caller, a number read aloud, or before creating a customer who may already exist.",
  inputSchema: jsonSchema(customerFindInput),
  input: customerFindInput,
  mutating: false,
  async handle(input, ctx): Promise<ToolOutcome> {
    const parsed = customerFindInput.safeParse(input);
    if (!parsed.success) return invalid(parsed.error.issues);
    // Normalise first: leads.phone_e164 is stored +1XXXXXXXXXX, so a raw "(781) 385-0591" would
    // match nothing and read back as "no such customer" — the most misleading possible answer.
    const phone = Phone.parse(parsed.data.phone);
    if (!isOk(phone)) return { ok: false, error: phone.error.message };
    const lead = await new DrizzleLeadRepository(ctx.tx, ctx.orgId).findByPhone(phone.value);
    if (!lead) return { ok: true, summary: `No customer on file with ${phone.value}.` };
    const p = lead.props;
    const parts = [`${p.name} — stage ${p.stage}`, `phone: ${p.phone}`];
    if (p.email) parts.push(`email: ${p.email}`);
    if (p.address) parts.push(`address: ${p.address}`);
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
    // Good/Better/Best is a whole quote FORMAT, and flattening it to one list of lines next to
    // one total misrepresents the document — the customer is choosing between tiers, not buying
    // every line. isOptional matters for the same reason: an add-on read as included inflates
    // the number the agent quotes out loud.
    const p = estimate.props;
    const linesSummary = p.lines
      .map((l) => {
        const q = l.props;
        const tags = [q.tier ? `[${q.tier}]` : "", q.isOptional ? "(optional)" : ""].filter(Boolean).join(" ");
        return `  ${tags ? `${tags} ` : ""}${q.description} x${q.quantity} @ ${money(q.rate)}`;
      })
      .join("\n");
    const head = [`${p.num} — ${p.status}`];
    if (p.title) head.push(`"${p.title}"`);
    head.push(`total ${money(estimate.total())}`);
    if (p.recommendedTier) head.push(`TIERED — recommended: ${p.recommendedTier}`);
    if (p.acceptedTier) head.push(`accepted: ${p.acceptedTier}`);
    if (p.changeRequestedAt) head.push("CHANGES REQUESTED by the customer");
    return {
      ok: true,
      summary: `${head.join(" — ")} [id: ${p.id}, customer: ${p.leadId}]\nLines:\n${linesSummary}`,
    };
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
    // A bill with no lines, no due date and no customer is a receipt total, not an invoice. Every
    // field below was already loaded and simply not printed — so "what's on invoice 1042" and
    // "who is it for" both went unanswered about a record holding both answers.
    const p = invoice.props;
    const head = [`${p.num} — ${p.status}`];
    if (p.title) head.push(`"${p.title}"`);
    head.push(`total ${money(p.total)}, paid ${money(p.amountPaid)}, balance ${money(invoice.due())}`);
    if (p.depositPaid) head.push(`deposit ${money(p.depositPaid)}`);
    if (p.sentAt) head.push(`sent ${p.sentAt.toISOString().slice(0, 10)}`);
    if (p.dueAt) head.push(`due ${p.dueAt.toISOString().slice(0, 10)}`);
    if (p.termsDays !== null && p.termsDays !== undefined) head.push(`net ${p.termsDays}`);
    const lines = p.lines.length
      ? `\nLines:\n${p.lines.map((l) => `  ${l.props.description} x${l.props.quantity} @ ${money(l.props.rate)}`).join("\n")}`
      : "";
    return {
      ok: true,
      summary: `${head.join(" — ")} [id: ${p.id}, customer: ${p.leadId}]${lines}`,
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
          // Assignment stays a flag, not a raw UUID — a deliberate earlier decision, and right:
          // a bare user id is noise in a reply and means nothing to the reader. Use member_list to
          // put a name to it. leadId below is different in kind: a HANDLE the agent needs to call
          // the next tool, the same role the job's own id already plays here.
          const assignee = p.assigneeUserId ? " — assigned" : " — unassigned";
          return `${p.num}${title} — ${p.status}${assignee} [id: ${p.id}, customer: ${p.leadId}]`;
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
          // A task attaches to a Lead; without leadId "what's outstanding for the Hendersons"
          // cannot be answered from this list.
          const who = p.leadId ? `, customer: ${p.leadId}` : "";
          return `${p.text}${due}${done} [id: ${p.id}${who}]`;
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
