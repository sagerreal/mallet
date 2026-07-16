import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { uuidGenerator } from "@mallet/shared/ports";
import type { Principal } from "@mallet/identity";
import type { ToolContext } from "../domain/tool";

// --- hermetic stubs ---------------------------------------------------------
// We stub the DB-touching modules so these tests stay in-process with no live DB.
// Vitest class-mock pattern: mockImplementation must use a class keyword (or regular function)
// when the SUT calls `new SomeClass()` — arrow functions are not constructors.

vi.mock("@mallet/customers", () => ({
  ListLeadsUseCase: vi.fn(),
  DrizzleLeadRepository: vi.fn(),
  EnsureCustomerUseCase: vi.fn(),
}));
vi.mock("@mallet/invoicing", () => ({
  ListInvoicesUseCase: vi.fn(),
  DrizzleInvoiceRepository: vi.fn(),
  SendInvoiceUseCase: vi.fn(),
  DraftInvoiceUseCase: vi.fn(),
  CreateInvoiceFromJobUseCase: vi.fn(),
  RecordPaymentUseCase: vi.fn(),
  VoidInvoiceUseCase: vi.fn(),
  ManualPaymentGateway: vi.fn(),
}));
vi.mock("@mallet/quoting", () => ({
  ListEstimatesUseCase: vi.fn(),
  DrizzleEstimateRepository: vi.fn(),
  DraftEstimateUseCase: vi.fn(),
  SendEstimateUseCase: vi.fn(),
}));
vi.mock("@mallet/jobs", () => ({
  ListJobsUseCase: vi.fn(),
  DrizzleJobRepository: vi.fn(),
  ScheduleJobUseCase: vi.fn(),
  AssignJobUseCase: vi.fn(),
  CreateVisitUseCase: vi.fn(),
}));
vi.mock("@mallet/tasks", () => ({
  ListTasksUseCase: vi.fn(),
  DrizzleTaskRepository: vi.fn(),
  CreateTaskUseCase: vi.fn(),
}));
vi.mock("@mallet/timesheets", () => ({
  ListTimeEntriesUseCase: vi.fn(),
  DrizzleTimeEntryRepository: vi.fn(),
  ApproveWeekUseCase: vi.fn(),
}));
vi.mock("@mallet/companies", () => ({
  ListCompaniesUseCase: vi.fn(),
  DrizzleCompanyRepository: vi.fn(),
}));
vi.mock("@mallet/notifications", () => ({
  ListNotificationsUseCase: vi.fn(),
  NextRemindersDueUseCase: vi.fn(),
  FollowUpPolicy: vi.fn(),
  SendNotificationUseCase: vi.fn(),
  SendInvoiceNotificationUseCase: vi.fn(),
  DrizzleNotificationRepository: vi.fn(),
  DrizzleReminderTargetReader: vi.fn(),
  STUB_EXTERNAL_ID: "stub:logged",
}));
// The users table import is used directly in member_list, and orgs in get_context —
// mock @mallet/shared/db/schema with both.
vi.mock("@mallet/shared/db/schema", () => ({
  users: { id: "id", orgId: "orgId", name: "name", role: "role", isFieldCrew: "isFieldCrew" },
  orgs: { id: "id", name: "name" },
}));

// Import after mocks are hoisted so the vi.mock() factory captures the mocked modules.
import { ListLeadsUseCase, DrizzleLeadRepository, EnsureCustomerUseCase } from "@mallet/customers";
import { ListInvoicesUseCase, DrizzleInvoiceRepository, DraftInvoiceUseCase, RecordPaymentUseCase, VoidInvoiceUseCase, ManualPaymentGateway } from "@mallet/invoicing";
import { ListEstimatesUseCase, DrizzleEstimateRepository, SendEstimateUseCase } from "@mallet/quoting";
import { ListJobsUseCase, DrizzleJobRepository, ScheduleJobUseCase, AssignJobUseCase, CreateVisitUseCase } from "@mallet/jobs";
import { ListTasksUseCase, DrizzleTaskRepository, CreateTaskUseCase } from "@mallet/tasks";
import { ListTimeEntriesUseCase, DrizzleTimeEntryRepository, ApproveWeekUseCase } from "@mallet/timesheets";
import { ListCompaniesUseCase, DrizzleCompanyRepository } from "@mallet/companies";
import { NextRemindersDueUseCase, FollowUpPolicy, SendInvoiceNotificationUseCase, DrizzleNotificationRepository, DrizzleReminderTargetReader } from "@mallet/notifications";
import { buildAgentTools } from "./agent-tools";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const orgId = asOrgId(randomUUID());
const userId = asUserId(randomUUID());
const principal: Principal = { userId, orgId, role: "owner" };

// Minimal fake tx that satisfies ctx.tx usage in member_list and get_context (raw Drizzle query chains).
// `resolvedRows` is returned by the terminal step (where OR limit depending on the query).
const makeTx = (resolvedRows: unknown[] = []) =>
  ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(resolvedRows),
  }) as unknown as ToolContext["tx"];

// makeTxMemberList: member_list resolves at `.where()` (no `.limit()`). Provide a separate helper
// so existing member_list tests keep working with their `mockResolvedValue` at the right step.
const makeTxWhereResolved = (rows: unknown[] = []) =>
  ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(rows),
  }) as unknown as ToolContext["tx"];

const makeCtx = (tx = makeTx()): ToolContext => ({
  tx,
  orgId,
  principal,
  deps: {
    bus: { publish: vi.fn() } as unknown as ToolContext["deps"]["bus"],
    clock: systemClock,
    ids: uuidGenerator,
    notificationSender: undefined,
    paymentLinkGateway: null,
  },
});

// Vitest class-mock helper: wraps the instance factory in a regular (non-arrow) function so
// it is a valid constructor target (required by Vitest's `new` check introduced in 2.x).
// Usage: mockClass(SomeClass, { method: vi.fn().mockResolvedValue(...) })
function mockClass<T extends abstract new (...a: never[]) => unknown>(
  ctor: T,
  instance: Partial<InstanceType<T>>,
): void {
  vi.mocked(ctor as unknown as new (...a: never[]) => unknown).mockImplementation(function () {
    return instance;
  });
}

const allTools = buildAgentTools();
const toolByName = (name: string) => {
  const t = allTools.find((t) => t.name === name);
  if (!t) throw new Error(`tool not registered: ${name}`);
  return t;
};

// Verify that orgId is absent from a tool's JSON input schema (the prompt-injection guard).
const assertNoOrgId = (name: string) => {
  const tool = toolByName(name);
  const schema = tool.inputSchema as { properties?: Record<string, unknown> };
  expect(schema.properties?.orgId).toBeUndefined();
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildAgentTools — tool registry", () => {
  it("registers all expected tools (no duplicates)", () => {
    const names = allTools.map((t) => t.name);
    const expected = [
      // Context bootstrap
      "get_context",
      // Phase A — reads
      "customer_list",
      "invoice_list",
      "estimate_list",
      "quote_draft",
      "invoice_send",
      "customer_get",
      "estimate_get",
      "invoice_get",
      "job_list",
      "job_get",
      "task_list",
      "member_list",
      "company_list",
      "company_get",
      "timesheet_list",
      "notification_list_due_reminders",
      // Phase B — approval-gated writes
      "quote_send",
      "notification_send_invoice_reminder",
      "job_schedule",
      "job_assign",
      "task_create",
      "customer_create",
      "invoice_draft",
      "invoice_create_from_job",
      "schedule_visit",
      // Phase C — sensitive
      "invoice_record_payment",
      "invoice_void",
      "timesheet_approve_week",
    ];
    for (const name of expected) {
      expect(names, `missing tool: ${name}`).toContain(name);
    }
    // No duplicates
    expect(new Set(names).size).toBe(names.length);
  });

  it("marks all read tools as mutating:false", () => {
    const readTools = [
      "get_context",
      "customer_get",
      "estimate_get",
      "invoice_get",
      "job_list",
      "job_get",
      "task_list",
      "member_list",
      "company_list",
      "company_get",
      "timesheet_list",
      "notification_list_due_reminders",
    ];
    for (const name of readTools) {
      expect(toolByName(name).mutating, `${name} should not be mutating`).toBe(false);
    }
  });

  it("marks all Phase B and C write tools as mutating:true", () => {
    const writeTools = [
      "quote_send",
      "notification_send_invoice_reminder",
      "job_schedule",
      "job_assign",
      "task_create",
      "customer_create",
      "invoice_draft",
      "invoice_create_from_job",
      "schedule_visit",
      "invoice_record_payment",
      "invoice_void",
      "timesheet_approve_week",
    ];
    for (const name of writeTools) {
      expect(toolByName(name).mutating, `${name} should be mutating`).toBe(true);
    }
  });

  it("all write tools have a fingerprint function", () => {
    const writeTools = [
      "quote_send",
      "notification_send_invoice_reminder",
      "job_schedule",
      "job_assign",
      "task_create",
      "customer_create",
      "invoice_draft",
      "invoice_create_from_job",
      "schedule_visit",
      "invoice_record_payment",
      "invoice_void",
      "timesheet_approve_week",
    ];
    for (const name of writeTools) {
      expect(toolByName(name).fingerprint, `${name} missing fingerprint`).toBeDefined();
    }
  });

  it("orgId is absent from every read tool input schema", () => {
    for (const name of [
      "get_context",
      "customer_get",
      "estimate_get",
      "invoice_get",
      "job_list",
      "job_get",
      "task_list",
      "member_list",
      "company_list",
      "company_get",
      "timesheet_list",
      "notification_list_due_reminders",
    ]) {
      assertNoOrgId(name);
    }
  });

  it("orgId is absent from every write tool input schema", () => {
    for (const name of [
      "quote_send",
      "notification_send_invoice_reminder",
      "job_schedule",
      "job_assign",
      "task_create",
      "customer_create",
      "invoice_draft",
      "invoice_create_from_job",
      "schedule_visit",
      "invoice_record_payment",
      "invoice_void",
      "timesheet_approve_week",
    ]) {
      assertNoOrgId(name);
    }
  });
});

// ---------------------------------------------------------------------------
// job_list
// ---------------------------------------------------------------------------

describe("job_list", () => {
  beforeEach(() => {
    vi.mocked(DrizzleJobRepository).mockClear();
    vi.mocked(ListJobsUseCase).mockClear();
  });

  it("returns a human-readable summary for each job (happy path)", async () => {
    const execMock = vi.fn().mockResolvedValue({
      items: [
        { props: { id: "job-1", num: "JOB-1", status: "scheduled", title: "Drywall patch", assigneeUserId: null } },
        { props: { id: "job-2", num: "JOB-2", status: "in_progress", title: null, assigneeUserId: "user-99" } },
      ],
      nextCursor: null,
    });
    mockClass(DrizzleJobRepository, {});
    mockClass(ListJobsUseCase, { exec: execMock });

    const tool = toolByName("job_list");
    const result = await tool.handle({}, makeCtx());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("JOB-1");
      expect(result.summary).toContain("Drywall patch");
      expect(result.summary).toContain("JOB-2");
      expect(result.summary).toContain("in_progress");
      expect(result.summary).toContain("job-1");
      expect(result.summary).toContain("job-2");
      // raw assignee UUID must not appear in the summary (Fix 4)
      expect(result.summary).not.toContain("user-99");
      // assigned job should still indicate assignment without the id
      expect(result.summary).toContain("assigned");
    }
    // orgId comes from ctx, not input — the use-case should not receive an orgId param.
    expect(execMock).toHaveBeenCalledOnce();
    const callArg = execMock.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect((callArg?.filter as Record<string, unknown> | undefined)?.orgId).toBeUndefined();
  });

  it("returns an empty summary when no jobs exist", async () => {
    mockClass(DrizzleJobRepository, {});
    mockClass(ListJobsUseCase, { exec: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) });

    const result = await toolByName("job_list").handle({}, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.summary).toContain("No jobs found");
  });

  it("rejects input with limit > 50", async () => {
    const result = await toolByName("job_list").handle({ limit: 51 }, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("limit");
  });

  it("rejects an orgId field in input (schema-level guard)", () => {
    assertNoOrgId("job_list");
  });
});

// ---------------------------------------------------------------------------
// job_get
// ---------------------------------------------------------------------------

describe("job_get", () => {
  beforeEach(() => {
    vi.mocked(DrizzleJobRepository).mockClear();
  });

  it("returns job details with visits (happy path)", async () => {
    const jobId = randomUUID();
    mockClass(DrizzleJobRepository, {
      findById: vi.fn().mockResolvedValue({
        props: {
          id: jobId,
          num: "JOB-5",
          status: "scheduled",
          title: "Roof inspection",
          assigneeUserId: "user-42",
          scheduledStart: new Date("2026-07-10T09:00:00Z"),
          scheduledEnd: new Date("2026-07-10T12:00:00Z"),
          visits: [
            {
              props: {
                id: "visit-1",
                scheduledDate: "2026-07-10",
                scheduledStart: "09:00",
                scheduledEnd: "12:00",
                status: "pending",
              },
            },
          ],
        },
      }),
    });

    const result = await toolByName("job_get").handle({ jobId }, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("JOB-5");
      expect(result.summary).toContain("Roof inspection");
      expect(result.summary).toContain("user-42");
      expect(result.summary).toContain("visit-1");
      expect(result.summary).toContain("2026-07-10");
    }
  });

  it("returns not-found error when job does not exist", async () => {
    mockClass(DrizzleJobRepository, { findById: vi.fn().mockResolvedValue(null) });

    const missing = randomUUID();
    const result = await toolByName("job_get").handle({ jobId: missing }, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
      expect(result.error).toContain("job_list");
    }
  });

  it("rejects non-uuid jobId", async () => {
    const result = await toolByName("job_get").handle({ jobId: "not-a-uuid" }, makeCtx());
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// task_list
// ---------------------------------------------------------------------------

describe("task_list", () => {
  beforeEach(() => {
    vi.mocked(DrizzleTaskRepository).mockClear();
    vi.mocked(ListTasksUseCase).mockClear();
  });

  it("returns task summaries (happy path)", async () => {
    mockClass(DrizzleTaskRepository, {});
    mockClass(ListTasksUseCase, {
      exec: vi.fn().mockResolvedValue({
        items: [
          { props: { id: "task-1", text: "Call customer", dueDate: "2026-07-15", done: false } },
          { props: { id: "task-2", text: "Order materials", dueDate: null, done: true } },
        ],
        nextCursor: null,
      }),
    });

    const result = await toolByName("task_list").handle({}, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("Call customer");
      expect(result.summary).toContain("2026-07-15");
      expect(result.summary).toContain("Order materials");
      expect(result.summary).toContain("[done]");
      expect(result.summary).toContain("task-1");
    }
  });

  it("returns empty message when no tasks", async () => {
    mockClass(DrizzleTaskRepository, {});
    mockClass(ListTasksUseCase, { exec: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) });

    const result = await toolByName("task_list").handle({}, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.summary).toContain("No tasks found");
  });
});

// ---------------------------------------------------------------------------
// member_list
// ---------------------------------------------------------------------------

describe("member_list", () => {
  it("returns member summaries from the users table (happy path)", async () => {
    // member_list uses .select().from().where() — resolves at .where() (no .limit())
    const tx = makeTxWhereResolved([
      { id: "user-1", name: "Alice", role: "owner", isFieldCrew: false },
      { id: "user-2", name: "Bob", role: "tech", isFieldCrew: true },
    ]);

    const result = await toolByName("member_list").handle({}, makeCtx(tx));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("Alice");
      expect(result.summary).toContain("owner");
      expect(result.summary).toContain("Bob");
      expect(result.summary).toContain("tech");
      expect(result.summary).toContain("[field crew]");
      expect(result.summary).toContain("user-1");
    }
  });

  it("returns empty message when org has no members", async () => {
    const result = await toolByName("member_list").handle({}, makeCtx(makeTxWhereResolved([])));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.summary).toContain("No members found");
  });

  it("has no orgId in input schema", () => {
    assertNoOrgId("member_list");
  });
});

// ---------------------------------------------------------------------------
// company_list
// ---------------------------------------------------------------------------

describe("company_list", () => {
  beforeEach(() => {
    vi.mocked(DrizzleCompanyRepository).mockClear();
    vi.mocked(ListCompaniesUseCase).mockClear();
  });

  it("returns company summaries (happy path)", async () => {
    mockClass(DrizzleCompanyRepository, {});
    mockClass(ListCompaniesUseCase, {
      exec: vi.fn().mockResolvedValue({
        items: [
          { props: { id: "co-1", name: "Acme Corp", address: "123 Main St" } },
          { props: { id: "co-2", name: "Globex", address: null } },
        ],
        nextCursor: null,
      }),
    });

    const result = await toolByName("company_list").handle({}, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("Acme Corp");
      expect(result.summary).toContain("123 Main St");
      expect(result.summary).toContain("Globex");
      expect(result.summary).toContain("co-1");
    }
  });

  it("returns empty message when no companies", async () => {
    mockClass(DrizzleCompanyRepository, {});
    mockClass(ListCompaniesUseCase, { exec: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) });

    const result = await toolByName("company_list").handle({}, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.summary).toContain("No companies found");
  });
});

// ---------------------------------------------------------------------------
// company_get
// ---------------------------------------------------------------------------

describe("company_get", () => {
  beforeEach(() => {
    vi.mocked(DrizzleCompanyRepository).mockClear();
  });

  it("returns company detail (happy path)", async () => {
    const companyId = randomUUID();
    mockClass(DrizzleCompanyRepository, {
      findById: vi.fn().mockResolvedValue({
        props: { id: companyId, name: "Acme Corp", address: "123 Main St", website: "acme.com", notes: "VIP client" },
      }),
    });

    const result = await toolByName("company_get").handle({ companyId }, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("Acme Corp");
      expect(result.summary).toContain("acme.com");
      expect(result.summary).toContain("VIP client");
    }
  });

  it("returns not-found error when company does not exist", async () => {
    mockClass(DrizzleCompanyRepository, { findById: vi.fn().mockResolvedValue(null) });

    const missing = randomUUID();
    const result = await toolByName("company_get").handle({ companyId: missing }, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// timesheet_list
// ---------------------------------------------------------------------------

describe("timesheet_list", () => {
  beforeEach(() => {
    vi.mocked(DrizzleTimeEntryRepository).mockClear();
    vi.mocked(ListTimeEntriesUseCase).mockClear();
  });

  it("returns timesheet summaries with duration (happy path)", async () => {
    mockClass(DrizzleTimeEntryRepository, {});
    mockClass(ListTimeEntriesUseCase, {
      exec: vi.fn().mockResolvedValue({
        items: [
          {
            props: { id: "te-1", workDate: "2026-07-09", kind: "job", startTime: "08:00", endTime: "12:00", status: "approved", running: false },
            hours: () => 4,
          },
          {
            props: { id: "te-2", workDate: "2026-07-09", kind: "travel", startTime: "07:30", endTime: null, status: "draft", running: true },
            hours: () => null,
          },
        ],
        nextCursor: null,
      }),
    });

    const result = await toolByName("timesheet_list").handle({}, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("2026-07-09");
      expect(result.summary).toContain("job");
      expect(result.summary).toContain("4.00h");
      expect(result.summary).toContain("travel");
      expect(result.summary).toContain("running");
    }
  });

  it("returns empty message when no timesheet entries", async () => {
    mockClass(DrizzleTimeEntryRepository, {});
    mockClass(ListTimeEntriesUseCase, { exec: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) });

    const result = await toolByName("timesheet_list").handle({}, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.summary).toContain("No timesheet entries found");
  });

  it("rejects invalid fromDate format", async () => {
    const result = await toolByName("timesheet_list").handle({ fromDate: "July 9" }, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("fromDate");
  });
});

// ---------------------------------------------------------------------------
// notification_list_due_reminders
// ---------------------------------------------------------------------------

describe("notification_list_due_reminders", () => {
  beforeEach(() => {
    vi.mocked(DrizzleNotificationRepository).mockClear();
    vi.mocked(DrizzleReminderTargetReader).mockClear();
    vi.mocked(NextRemindersDueUseCase).mockClear();
    vi.mocked(FollowUpPolicy).mockClear();
  });

  it("returns due reminders summary (happy path)", async () => {
    mockClass(DrizzleNotificationRepository, {});
    mockClass(DrizzleReminderTargetReader, {});
    mockClass(FollowUpPolicy, {});
    mockClass(NextRemindersDueUseCase, {
      exec: vi.fn().mockResolvedValue({
        items: [
          { relatedType: "invoice", relatedId: "inv-1", num: "INV-007", stage: 1 },
          { relatedType: "invoice", relatedId: "inv-2", num: "INV-012", stage: 2 },
        ],
        nextCursor: null,
      }),
    });

    const result = await toolByName("notification_list_due_reminders").handle({}, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("INV-007");
      expect(result.summary).toContain("stage 1");
      expect(result.summary).toContain("INV-012");
      expect(result.summary).toContain("stage 2");
    }
  });

  it("returns 'No reminders due' when queue is empty", async () => {
    mockClass(DrizzleNotificationRepository, {});
    mockClass(DrizzleReminderTargetReader, {});
    mockClass(FollowUpPolicy, {});
    mockClass(NextRemindersDueUseCase, {
      exec: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    });

    const result = await toolByName("notification_list_due_reminders").handle({}, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.summary).toContain("No reminders due");
  });
});

// ---------------------------------------------------------------------------
// customer_get
// ---------------------------------------------------------------------------

describe("customer_get", () => {
  beforeEach(() => {
    vi.mocked(DrizzleLeadRepository).mockClear();
  });

  it("returns customer detail (happy path)", async () => {
    const customerId = randomUUID();
    mockClass(DrizzleLeadRepository, {
      findById: vi.fn().mockResolvedValue({
        props: { id: customerId, name: "Jane Smith", stage: "estimate_sent", companyId: null, role: null },
      }),
    });

    const result = await toolByName("customer_get").handle({ customerId }, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("Jane Smith");
      expect(result.summary).toContain("estimate_sent");
      expect(result.summary).toContain(customerId);
    }
  });

  it("returns not-found error when customer does not exist", async () => {
    mockClass(DrizzleLeadRepository, { findById: vi.fn().mockResolvedValue(null) });

    const missing = randomUUID();
    const result = await toolByName("customer_get").handle({ customerId: missing }, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
      expect(result.error).toContain("customer_list");
    }
  });
});

// ---------------------------------------------------------------------------
// estimate_get
// ---------------------------------------------------------------------------

describe("estimate_get", () => {
  beforeEach(() => {
    vi.mocked(DrizzleEstimateRepository).mockClear();
  });

  it("returns estimate detail with lines (happy path)", async () => {
    const estimateId = randomUUID();
    mockClass(DrizzleEstimateRepository, {
      findById: vi.fn().mockResolvedValue({
        props: {
          id: estimateId,
          num: "EST-003",
          status: "sent",
          lines: [
            { props: { description: "Labour", quantity: 8, rate: 10000 } },
            { props: { description: "Materials", quantity: 1, rate: 25000 } },
          ],
        },
        total: () => 105000,
      }),
    });

    const result = await toolByName("estimate_get").handle({ estimateId }, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("EST-003");
      expect(result.summary).toContain("sent");
      expect(result.summary).toContain("Labour");
      expect(result.summary).toContain("Materials");
    }
  });

  it("returns not-found error when estimate does not exist", async () => {
    mockClass(DrizzleEstimateRepository, { findById: vi.fn().mockResolvedValue(null) });

    const missing = randomUUID();
    const result = await toolByName("estimate_get").handle({ estimateId: missing }, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// invoice_get
// ---------------------------------------------------------------------------

describe("invoice_get", () => {
  beforeEach(() => {
    vi.mocked(DrizzleInvoiceRepository).mockClear();
  });

  it("returns invoice detail (happy path)", async () => {
    const invoiceId = randomUUID();
    mockClass(DrizzleInvoiceRepository, {
      findById: vi.fn().mockResolvedValue({
        props: { id: invoiceId, num: "INV-011", status: "partial", total: 100000, amountPaid: 40000 },
        due: () => 60000,
      }),
    });

    const result = await toolByName("invoice_get").handle({ invoiceId }, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("INV-011");
      expect(result.summary).toContain("partial");
      expect(result.summary).toContain("$1000.00");
      expect(result.summary).toContain("$400.00");
      expect(result.summary).toContain("$600.00");
    }
  });

  it("returns not-found error when invoice does not exist", async () => {
    mockClass(DrizzleInvoiceRepository, { findById: vi.fn().mockResolvedValue(null) });

    const missing = randomUUID();
    const result = await toolByName("invoice_get").handle({ invoiceId: missing }, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not found");
  });
});

// ---------------------------------------------------------------------------
// Phase B write tools
// ---------------------------------------------------------------------------

describe("quote_send", () => {
  beforeEach(() => {
    vi.mocked(DrizzleEstimateRepository).mockClear();
    vi.mocked(SendEstimateUseCase).mockClear();
  });

  it("sends a draft estimate (happy path)", async () => {
    const estimateId = randomUUID();
    mockClass(DrizzleEstimateRepository, {
      findById: vi.fn().mockResolvedValue({
        props: { id: estimateId, num: "EST-007", status: "sent", orgId: "org-1", leadId: "lead-1" },
        total: () => 50000,
      }),
      save: vi.fn().mockResolvedValue(undefined),
    });
    mockClass(SendEstimateUseCase, {
      exec: vi.fn().mockResolvedValue({
        ok: true,
        value: { props: { id: estimateId, num: "EST-007", status: "sent", orgId: "org-1", leadId: "lead-1" } },
      }),
    });

    const result = await toolByName("quote_send").handle({ estimateId }, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("EST-007");
      expect(result.summary).toContain(estimateId);
    }
  });

  it("returns error when estimate not found", async () => {
    mockClass(DrizzleEstimateRepository, { findById: vi.fn().mockResolvedValue(null) });
    mockClass(SendEstimateUseCase, {
      exec: vi.fn().mockResolvedValue({ ok: false, error: { message: "estimate not found" } }),
    });

    const result = await toolByName("quote_send").handle({ estimateId: randomUUID() }, makeCtx());
    expect(result.ok).toBe(false);
  });

  it("fingerprint returns estimate status+total string", async () => {
    const estimateId = randomUUID();
    mockClass(DrizzleEstimateRepository, {
      findById: vi.fn().mockResolvedValue({
        props: { id: estimateId, num: "EST-007", status: "draft" },
        total: () => 30000,
      }),
    });

    const tool = toolByName("quote_send");
    const fp = await tool.fingerprint?.({ estimateId }, makeCtx());
    expect(fp).toContain(estimateId);
    expect(fp).toContain("draft");
    expect(fp).toContain("30000");
  });

  it("rejects non-uuid estimateId", async () => {
    const result = await toolByName("quote_send").handle({ estimateId: "not-a-uuid" }, makeCtx());
    expect(result.ok).toBe(false);
  });

  it("has no orgId in input schema", () => {
    assertNoOrgId("quote_send");
  });
});

describe("job_schedule", () => {
  beforeEach(() => {
    vi.mocked(DrizzleLeadRepository).mockClear();
    vi.mocked(DrizzleJobRepository).mockClear();
    vi.mocked(ScheduleJobUseCase).mockClear();
  });

  it("creates a new job (happy path)", async () => {
    const leadId = randomUUID();
    const jobId = randomUUID();
    mockClass(DrizzleLeadRepository, {
      findById: vi.fn().mockResolvedValue({ props: { id: leadId, name: "Roof Co", stage: "new" } }),
    });
    mockClass(DrizzleJobRepository, { nextNumber: vi.fn().mockResolvedValue("JOB-3"), save: vi.fn().mockResolvedValue(undefined) });
    mockClass(ScheduleJobUseCase, {
      exec: vi.fn().mockResolvedValue({
        ok: true,
        value: { props: { id: jobId, num: "JOB-3", status: "scheduled", title: "Inspection", assigneeUserId: null } },
      }),
    });

    const result = await toolByName("job_schedule").handle({ leadId, title: "Inspection" }, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("JOB-3");
      expect(result.summary).toContain(jobId);
    }
  });

  it("fingerprint returns ENTITY_NOT_FOUND when lead missing", async () => {
    mockClass(DrizzleLeadRepository, { findById: vi.fn().mockResolvedValue(null) });
    const tool = toolByName("job_schedule");
    const fp = await tool.fingerprint?.({ leadId: randomUUID() }, makeCtx());
    expect(fp).toBe("__entity_not_found__");
  });

  it("has no orgId in input schema", () => {
    assertNoOrgId("job_schedule");
  });
});

describe("job_assign", () => {
  beforeEach(() => {
    vi.mocked(DrizzleJobRepository).mockClear();
    vi.mocked(AssignJobUseCase).mockClear();
  });

  it("assigns a crew member to a job (happy path)", async () => {
    const jobId = randomUUID();
    const assigneeUserId = randomUUID();
    mockClass(DrizzleJobRepository, {
      findById: vi.fn().mockResolvedValue({
        props: { id: jobId, num: "JOB-5", status: "scheduled", assigneeUserId: null },
        assignTo: vi.fn().mockReturnValue({ ok: true, value: { props: { id: jobId, num: "JOB-5", status: "scheduled", orgId: "org-1", assigneeUserId } } }),
      }),
      save: vi.fn().mockResolvedValue(undefined),
    });
    mockClass(AssignJobUseCase, {
      exec: vi.fn().mockResolvedValue({
        ok: true,
        value: { props: { id: jobId, num: "JOB-5", assigneeUserId, orgId: "org-1" } },
      }),
    });

    const result = await toolByName("job_assign").handle({ jobId, assigneeUserId }, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("JOB-5");
      // raw assignee UUID must not appear in summary (Fix 4); "assigned" indicator is enough
      expect(result.summary).not.toContain(assigneeUserId);
      expect(result.summary).toContain("assigned");
    }
  });

  it("unassigns when assigneeUserId is null", async () => {
    const jobId = randomUUID();
    mockClass(DrizzleJobRepository, {
      findById: vi.fn().mockResolvedValue({ props: { id: jobId, num: "JOB-5", status: "scheduled", assigneeUserId: "old-user" } }),
    });
    mockClass(AssignJobUseCase, {
      exec: vi.fn().mockResolvedValue({
        ok: true,
        value: { props: { id: jobId, num: "JOB-5", assigneeUserId: null, orgId: "org-1" } },
      }),
    });

    const result = await toolByName("job_assign").handle({ jobId, assigneeUserId: null }, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.summary).toContain("unassigned");
  });

  it("has no orgId in input schema", () => {
    assertNoOrgId("job_assign");
  });
});

describe("task_create", () => {
  beforeEach(() => {
    vi.mocked(DrizzleTaskRepository).mockClear();
    vi.mocked(CreateTaskUseCase).mockClear();
  });

  it("creates a task (happy path)", async () => {
    const taskId = randomUUID();
    mockClass(DrizzleTaskRepository, { create: vi.fn().mockResolvedValue({ props: { id: taskId, text: "Follow up with Jane", dueDate: "2026-07-20", done: false } }) });
    mockClass(CreateTaskUseCase, {
      exec: vi.fn().mockResolvedValue({ ok: true, value: { props: { id: taskId, text: "Follow up with Jane", dueDate: "2026-07-20" } } }),
    });

    const result = await toolByName("task_create").handle({ text: "Follow up with Jane", dueDate: "2026-07-20" }, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("Follow up with Jane");
      expect(result.summary).toContain("2026-07-20");
      expect(result.summary).toContain(taskId);
    }
  });

  it("rejects empty text", async () => {
    const result = await toolByName("task_create").handle({ text: "" }, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("text");
  });

  it("rejects invalid dueDate format", async () => {
    const result = await toolByName("task_create").handle({ text: "Do something", dueDate: "next week" }, makeCtx());
    expect(result.ok).toBe(false);
  });

  it("fingerprint with leadId returns ENTITY_NOT_FOUND when lead missing", async () => {
    mockClass(DrizzleLeadRepository, { findById: vi.fn().mockResolvedValue(null) });
    const tool = toolByName("task_create");
    const fp = await tool.fingerprint?.({ text: "Do it", leadId: randomUUID() }, makeCtx());
    expect(fp).toBe("__entity_not_found__");
  });

  it("fingerprint without leadId returns text-based fingerprint", async () => {
    const tool = toolByName("task_create");
    const fp = await tool.fingerprint?.({ text: "Call customer" }, makeCtx());
    expect(fp).toContain("Call customer");
  });

  it("has no orgId in input schema", () => {
    assertNoOrgId("task_create");
  });
});

describe("customer_create", () => {
  beforeEach(() => {
    vi.mocked(DrizzleLeadRepository).mockClear();
    vi.mocked(EnsureCustomerUseCase).mockClear();
  });

  it("creates (or returns existing) customer (happy path)", async () => {
    const leadId = randomUUID();
    mockClass(DrizzleLeadRepository, { ensureCustomer: vi.fn().mockResolvedValue({ lead: { props: { id: leadId, name: "Acme", stage: "new", orgId: "org-1" } }, created: true }) });
    mockClass(EnsureCustomerUseCase, {
      exec: vi.fn().mockResolvedValue({ ok: true, value: { lead: { props: { id: leadId, name: "Acme", stage: "new" } }, created: true } }),
    });

    const result = await toolByName("customer_create").handle({ name: "Acme" }, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("Acme");
      expect(result.summary).toContain(leadId);
    }
  });

  it("fingerprint returns name-based string (no entity to drift)", async () => {
    const tool = toolByName("customer_create");
    const fp = await tool.fingerprint?.({ name: "Jane Corp" }, makeCtx());
    expect(fp).toContain("Jane Corp");
  });

  it("rejects empty name", async () => {
    const result = await toolByName("customer_create").handle({ name: "" }, makeCtx());
    expect(result.ok).toBe(false);
  });

  it("has no orgId in input schema", () => {
    assertNoOrgId("customer_create");
  });
});

describe("invoice_draft", () => {
  beforeEach(() => {
    vi.mocked(DrizzleLeadRepository).mockClear();
    vi.mocked(DrizzleInvoiceRepository).mockClear();
    vi.mocked(DraftInvoiceUseCase).mockClear();
  });

  it("drafts an invoice (happy path)", async () => {
    const leadId = randomUUID();
    const invoiceId = randomUUID();
    mockClass(DrizzleLeadRepository, {
      findById: vi.fn().mockResolvedValue({ props: { id: leadId, name: "Jane", stage: "new" } }),
    });
    mockClass(DrizzleInvoiceRepository, { nextNumber: vi.fn().mockResolvedValue("INV-008"), save: vi.fn().mockResolvedValue(undefined) });
    mockClass(DraftInvoiceUseCase, {
      exec: vi.fn().mockResolvedValue({
        ok: true,
        value: { props: { id: invoiceId, num: "INV-008", status: "draft", total: 20000 } },
      }),
    });

    const result = await toolByName("invoice_draft").handle(
      { leadId, lines: [{ description: "Labor", quantity: 2, rateCents: 10000 }] },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("INV-008");
      expect(result.summary).toContain(invoiceId);
    }
  });

  it("returns error when customer not found", async () => {
    mockClass(DrizzleLeadRepository, { findById: vi.fn().mockResolvedValue(null) });

    const result = await toolByName("invoice_draft").handle(
      { leadId: randomUUID(), lines: [{ description: "Labor", quantity: 1, rateCents: 5000 }] },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not found");
  });

  it("rejects empty lines array", async () => {
    const result = await toolByName("invoice_draft").handle({ leadId: randomUUID(), lines: [] }, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("lines");
  });

  it("has no orgId in input schema", () => {
    assertNoOrgId("invoice_draft");
  });
});

describe("schedule_visit", () => {
  beforeEach(() => {
    vi.mocked(DrizzleJobRepository).mockClear();
    vi.mocked(CreateVisitUseCase).mockClear();
  });

  it("adds a visit to a job (happy path)", async () => {
    const jobId = randomUUID();
    const assigneeUserId = randomUUID();
    const visitId = randomUUID();
    mockClass(DrizzleJobRepository, {
      findById: vi.fn().mockResolvedValue({ props: { id: jobId, num: "JOB-2", status: "scheduled" } }),
      save: vi.fn().mockResolvedValue(undefined),
    });
    mockClass(CreateVisitUseCase, {
      exec: vi.fn().mockResolvedValue({
        ok: true,
        value: { props: { id: jobId, num: "JOB-2", status: "scheduled", visits: [{ props: { id: visitId } }] } },
      }),
    });

    const result = await toolByName("schedule_visit").handle(
      { jobId, assigneeUserId, scheduledDate: "2026-07-15", scheduledStart: "09:00", durationHours: 3 },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("JOB-2");
      expect(result.summary).toContain("2026-07-15");
      expect(result.summary).toContain("09:00");
    }
  });

  it("fingerprint returns ENTITY_NOT_FOUND when job missing", async () => {
    mockClass(DrizzleJobRepository, { findById: vi.fn().mockResolvedValue(null) });
    const tool = toolByName("schedule_visit");
    const fp = await tool.fingerprint?.(
      { jobId: randomUUID(), assigneeUserId: randomUUID(), scheduledDate: "2026-07-15", scheduledStart: "09:00", durationHours: 2 },
      makeCtx(),
    );
    expect(fp).toBe("__entity_not_found__");
  });

  it("rejects invalid scheduledDate format", async () => {
    const result = await toolByName("schedule_visit").handle(
      { jobId: randomUUID(), assigneeUserId: randomUUID(), scheduledDate: "July 15", scheduledStart: "09:00", durationHours: 2 },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
  });

  it("has no orgId in input schema", () => {
    assertNoOrgId("schedule_visit");
  });
});

// ---------------------------------------------------------------------------
// Phase C — sensitive tools
// ---------------------------------------------------------------------------

describe("invoice_record_payment", () => {
  beforeEach(() => {
    vi.mocked(DrizzleInvoiceRepository).mockClear();
    vi.mocked(RecordPaymentUseCase).mockClear();
    vi.mocked(ManualPaymentGateway).mockClear();
  });

  it("records a payment (happy path) — idempotencyKey injected by enrichArgs, not from model", async () => {
    const invoiceId = randomUUID();
    // Note: NO idempotencyKey in input — it is server-minted via enrichArgs at propose time.
    // In handle(), the stored frozen args will already contain the server-minted key.
    const serverMintedKey = randomUUID();
    mockClass(DrizzleInvoiceRepository, {
      findById: vi.fn().mockResolvedValue({
        props: { id: invoiceId, num: "INV-015", status: "partial", total: 100000, amountPaid: 40000 },
        due: () => 60000,
      }),
      insertPayment: vi.fn().mockResolvedValue(true),
      applyPayment: vi.fn().mockResolvedValue({
        applied: true,
        invoice: { props: { id: invoiceId, num: "INV-015", status: "partial" }, due: () => 50000 },
      }),
    });
    mockClass(ManualPaymentGateway, { recordPayment: vi.fn().mockResolvedValue({ ok: true, value: { externalId: null, amount: 10000, method: "cash", settledAt: new Date() } }) });
    mockClass(RecordPaymentUseCase, {
      exec: vi.fn().mockResolvedValue({
        ok: true,
        value: { props: { id: invoiceId, num: "INV-015", status: "partial" }, due: () => 50000 },
      }),
    });

    // Simulate what the confirm leg does: handle() receives the frozen args which include the
    // server-minted key (injected by enrichArgs at propose time and stored in the DB).
    const result = await toolByName("invoice_record_payment").handle(
      { invoiceId, amountCents: 10000, method: "cash", idempotencyKey: serverMintedKey },
      makeCtx(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("INV-015");
      expect(result.summary).toContain("$100.00");
    }
  });

  it("enrichArgs mints a server-side idempotencyKey (model never provides it)", () => {
    const tool = toolByName("invoice_record_payment");
    expect(tool.enrichArgs).toBeDefined();
    const ctx = makeCtx();
    const enriched = tool.enrichArgs!({ invoiceId: randomUUID(), amountCents: 5000, method: "cash" }, ctx);
    expect(typeof enriched.idempotencyKey).toBe("string");
    // Must be a UUID-format string
    expect(enriched.idempotencyKey as string).toMatch(/^[0-9a-f-]{36}$/);
    // Two separate enrichArgs calls produce different keys (each payment proposal is unique)
    const enriched2 = tool.enrichArgs!({ invoiceId: randomUUID(), amountCents: 5000, method: "cash" }, ctx);
    expect(enriched2.idempotencyKey).not.toBe(enriched.idempotencyKey);
  });

  it("idempotencyKey is absent from model-facing input schema (model cannot supply it)", () => {
    const tool = toolByName("invoice_record_payment");
    const schema = tool.inputSchema as { properties?: Record<string, unknown> };
    expect(schema.properties?.idempotencyKey).toBeUndefined();
  });

  it("fingerprint returns ENTITY_NOT_FOUND when invoice not in payable state", async () => {
    const invoiceId = randomUUID();
    mockClass(DrizzleInvoiceRepository, {
      findById: vi.fn().mockResolvedValue({
        props: { id: invoiceId, status: "draft", total: 50000, amountPaid: 0 },
        due: () => 50000,
      }),
    });
    const tool = toolByName("invoice_record_payment");
    // Fingerprint receives enriched args (with server-minted key already present)
    const fp = await tool.fingerprint?.({ invoiceId, amountCents: 5000, method: "cash", idempotencyKey: randomUUID() }, makeCtx());
    expect(fp).toBe("__entity_not_found__");
  });

  it("fingerprint includes idempotencyKey (idempotency freeze — same key on confirm means no double-charge)", async () => {
    const invoiceId = randomUUID();
    const serverKey = randomUUID();
    mockClass(DrizzleInvoiceRepository, {
      findById: vi.fn().mockResolvedValue({
        props: { id: invoiceId, status: "sent", total: 50000, amountPaid: 0 },
        due: () => 50000,
      }),
    });
    const tool = toolByName("invoice_record_payment");
    // The fingerprint gets the enriched frozen args (key already server-minted at propose time)
    const fp = await tool.fingerprint?.({ invoiceId, amountCents: 5000, method: "cash", idempotencyKey: serverKey }, makeCtx());
    expect(fp).toContain(serverKey);
  });

  it("rejects amountCents = 0 (even when frozen args contain server-minted key)", async () => {
    const result = await toolByName("invoice_record_payment").handle(
      { invoiceId: randomUUID(), amountCents: 0, method: "cash", idempotencyKey: randomUUID() },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects unknown payment method", async () => {
    const result = await toolByName("invoice_record_payment").handle(
      { invoiceId: randomUUID(), amountCents: 5000, method: "bitcoin", idempotencyKey: randomUUID() },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
  });

  it("has no orgId in input schema", () => {
    assertNoOrgId("invoice_record_payment");
  });
});

describe("invoice_void", () => {
  beforeEach(() => {
    vi.mocked(DrizzleInvoiceRepository).mockClear();
    vi.mocked(VoidInvoiceUseCase).mockClear();
  });

  it("voids an invoice (happy path)", async () => {
    const invoiceId = randomUUID();
    mockClass(DrizzleInvoiceRepository, {
      findById: vi.fn().mockResolvedValue({
        props: { id: invoiceId, num: "INV-020", status: "sent", total: 50000, amountPaid: 0 },
        void: vi.fn().mockReturnValue({ ok: true, value: { props: { id: invoiceId, num: "INV-020", status: "void", orgId: "org-1", leadId: "lead-1" } } }),
      }),
      save: vi.fn().mockResolvedValue(undefined),
    });
    mockClass(VoidInvoiceUseCase, {
      exec: vi.fn().mockResolvedValue({ ok: true, value: { props: { id: invoiceId, num: "INV-020", status: "void" } } }),
    });

    const result = await toolByName("invoice_void").handle({ invoiceId }, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("INV-020");
      expect(result.summary).toContain(invoiceId);
    }
  });

  it("fingerprint includes invoice status and total (drift detection)", async () => {
    const invoiceId = randomUUID();
    mockClass(DrizzleInvoiceRepository, {
      findById: vi.fn().mockResolvedValue({
        props: { id: invoiceId, status: "sent", total: 80000, amountPaid: 0 },
        due: () => 80000,
      }),
    });
    const tool = toolByName("invoice_void");
    const fp = await tool.fingerprint?.({ invoiceId }, makeCtx());
    expect(fp).toContain(invoiceId);
    expect(fp).toContain("sent");
    expect(fp).toContain("80000");
  });

  it("returns error when use-case fails", async () => {
    mockClass(DrizzleInvoiceRepository, {
      findById: vi.fn().mockResolvedValue({ props: { id: randomUUID(), status: "paid", total: 50000, amountPaid: 50000 }, due: () => 0 }),
    });
    mockClass(VoidInvoiceUseCase, {
      exec: vi.fn().mockResolvedValue({ ok: false, error: { message: "cannot void a paid invoice" } }),
    });

    const result = await toolByName("invoice_void").handle({ invoiceId: randomUUID() }, makeCtx());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("cannot void");
  });

  it("has no orgId in input schema", () => {
    assertNoOrgId("invoice_void");
  });
});

describe("timesheet_approve_week", () => {
  beforeEach(() => {
    vi.mocked(DrizzleTimeEntryRepository).mockClear();
    vi.mocked(ApproveWeekUseCase).mockClear();
  });

  it("approves a tech's week (happy path)", async () => {
    const techUserId = randomUUID();
    const dates = ["2026-07-07", "2026-07-08", "2026-07-09"];
    mockClass(DrizzleTimeEntryRepository, { approveWeek: vi.fn().mockResolvedValue(6) });
    mockClass(ApproveWeekUseCase, {
      exec: vi.fn().mockResolvedValue({ ok: true, value: { approved: 6 } }),
    });

    const result = await toolByName("timesheet_approve_week").handle({ techUserId, dates }, makeCtx());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("6");
      expect(result.summary).toContain(techUserId);
    }
  });

  it("fingerprint includes techUserId and sorted dates", async () => {
    const techUserId = randomUUID();
    const tool = toolByName("timesheet_approve_week");
    const fp = await tool.fingerprint?.(
      { techUserId, dates: ["2026-07-09", "2026-07-07", "2026-07-08"] },
      makeCtx(),
    );
    expect(fp).toContain(techUserId);
    // dates should be sorted in the fingerprint
    expect(fp).toContain("2026-07-07,2026-07-08,2026-07-09");
  });

  it("rejects an empty dates array", async () => {
    const result = await toolByName("timesheet_approve_week").handle(
      { techUserId: randomUUID(), dates: [] },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
  });

  it("rejects more than 7 dates", async () => {
    const result = await toolByName("timesheet_approve_week").handle(
      { techUserId: randomUUID(), dates: ["2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04", "2026-07-05", "2026-07-06", "2026-07-07", "2026-07-08"] },
      makeCtx(),
    );
    expect(result.ok).toBe(false);
  });

  it("has no orgId in input schema", () => {
    assertNoOrgId("timesheet_approve_week");
  });
});

// ---------------------------------------------------------------------------
// get_context
// ---------------------------------------------------------------------------

describe("get_context", () => {
  it("returns orgName and todayISO as JSON (happy path)", async () => {
    // get_context uses .select().from().where().limit() — resolves at .limit()
    const tx = makeTx([{ name: "Apex Plumbing" }]);
    const result = await toolByName("get_context").handle({}, makeCtx(tx));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.summary) as { orgName: string; todayISO: string };
      expect(parsed.orgName).toBe("Apex Plumbing");
      // todayISO must be a YYYY-MM-DD string
      expect(parsed.todayISO).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("falls back to 'your organization' when the orgs row is missing", async () => {
    const tx = makeTx([]); // empty result — org row not found
    const result = await toolByName("get_context").handle({}, makeCtx(tx));
    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.summary) as { orgName: string };
      expect(parsed.orgName).toBe("your organization");
    }
  });

  it("is not mutating", () => {
    expect(toolByName("get_context").mutating).toBe(false);
  });

  it("has no orgId in input schema", () => {
    assertNoOrgId("get_context");
  });
});
