import { describe, it, expect, vi } from "vitest";
import type { RiskTier } from "./tool";

// Same hermetic stubs as agent-tools.test.ts, required here for the same reason: importing the
// real catalog pulls every domain module's barrel transitively into `../infra/agent-tools`, and
// those barrels construct a live DB client at module scope (shared/db/client.ts) — this suite
// stays "hermetic, secret-free, CI-safe" per vitest.config.ts's own charter, not DB-backed.
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
  AdvanceReminderUseCase: vi.fn(),
  DrizzleNotificationRepository: vi.fn(),
  DrizzleReminderTargetReader: vi.fn(),
  resolveOrgNotificationSender: vi.fn(async () => ({ send: vi.fn() })),
  canSendAutomatedSms: vi.fn(async () => true),
  STUB_EXTERNAL_ID: "stub:logged",
}));
vi.mock("@mallet/a2p", () => ({
  GetA2pStatusUseCase: vi.fn(),
  DrizzleRegistrationRepository: vi.fn(),
}));
vi.mock("@mallet/shared/db/schema", () => ({
  users: { id: "id", orgId: "orgId", name: "name", role: "role", isFieldCrew: "isFieldCrew", email: "email", skillTags: "skillTags" },
  orgs: { id: "id", name: "name" },
  orgSettings: { orgId: "orgId", timezone: "timezone" },
}));

// Import after mocks are hoisted so the vi.mock() factories above capture the mocked modules.
import { buildAgentTools } from "../infra/agent-tools";

const LEGAL_TIERS = new Set<RiskTier>(["comms", "operational", "money", "destructive"]);

/**
 * Every mutating tool's tier, pinned exhaustively.
 *
 * A tier is a security boundary, not a label: the autonomy policy auto-approves `comms` and
 * `operational` with no human present, so a tool that drifts DOWN into either of those starts
 * running unattended on live customer data. Spot-checking a handful of names does not defend that
 * boundary — an earlier version of this file asserted four of the five `money` tools, leaving
 * `invoice_draft` and `invoice_create_from_job` unasserted while its own name claimed "every".
 *
 * Compared with `toEqual`, so this one assertion also catches the two failures a per-name loop
 * cannot see: a NEW mutating tool that nobody classified, and a tool silently dropped from the
 * catalog.
 */
const EXPECTED_WRITE_TIERS: Record<string, RiskTier> = {
  // Leaves the building, but cannot move money or destroy anything.
  invoice_send: "comms",
  quote_send: "comms",
  notification_send_invoice_reminder: "comms",
  // Rearranges the shop's own schedule and records; undoable from inside the app.
  job_schedule: "operational",
  job_assign: "operational",
  job_start: "operational",
  job_complete: "operational",
  job_reschedule: "operational",
  schedule_visit: "operational",
  visit_patch: "operational",
  task_create: "operational",
  task_update: "operational",
  task_set_done: "operational",
  quote_draft: "operational",
  customer_create: "operational",
  // Touches what someone owes or has paid — timesheet_approve_week lives here too: it is payroll
  // approval, "the only trigger for hours leaving Mallet" to QuickBooks, and "unrecoverable
  // through this tool" (its own docstring). It is NOT undoable from inside the app the way the
  // group above is, so it cannot sit under "operational" no matter how schedule-shaped its name
  // reads — see the dedicated test below.
  invoice_draft: "money",
  invoice_create_from_job: "money",
  invoice_update: "money",
  invoice_record_payment: "money",
  quote_accept: "money",
  timesheet_approve_week: "money",
  // Not undoable from inside the app, or redirects where documents and payment links land.
  invoice_void: "destructive",
  job_cancel: "destructive",
  quote_decline: "destructive",
  task_remove: "destructive",
  customer_update: "destructive",
};

describe("the tool catalog's risk tiers", () => {
  const tools = buildAgentTools();

  it("pins the tier of every mutating tool", () => {
    const actual = Object.fromEntries(
      tools.filter((t) => t.mutating).map((t) => [t.name, t.riskTier]),
    );
    expect(actual).toEqual(EXPECTED_WRITE_TIERS);
  });

  it("only ever uses a tier the policy knows how to weigh", () => {
    // `riskTier` being required is a COMPILE-time guarantee, so a test for "is it present" cannot
    // fail — a violating tool would not build. What the compiler cannot catch is a value cast into
    // place (`"whatever" as RiskTier`) or a tool assembled from config rather than a literal. An
    // unrecognised tier falling through the policy's branches is precisely how something ends up
    // treated as safe, so assert the values at runtime.
    const illegal = tools
      .filter((t) => !LEGAL_TIERS.has(t.riskTier))
      .map((t) => `${t.name}=${String(t.riskTier)}`);
    expect(illegal).toEqual([]);
  });

  it("classifies contact-field mutation as destructive, not operational", () => {
    // customer_update can change email/phone/address: a redirection primitive for documents and
    // payment links. If this ever relaxes to operational, an injected note can redirect a quote.
    const tool = tools.find((t) => t.name === "customer_update");
    expect(tool?.riskTier).toBe("destructive");
  });

  it("marks every comms tool mutating, so the gate sees it at all", () => {
    const comms = tools.filter((x) => x.riskTier === "comms");
    // Guards against vacuity: this and the assertions above all filter the catalog, so an empty
    // (or comms-less) catalog would pass them while proving nothing.
    expect(comms).toHaveLength(3);
    for (const t of comms) expect(t.mutating).toBe(true);
  });

  it("keeps timesheet_approve_week at money, not operational — payroll is not a schedule edit", () => {
    // Named individually, on top of the exhaustive EXPECTED_WRITE_TIERS check above, because this
    // is the one entry in the whole catalog most likely to get "tidied" back into the operational
    // block it visually resembles (job_schedule, job_assign, task_* all sit right next to it and
    // ARE undoable in-app). Payroll approval is not: it is "the only trigger for hours leaving
    // Mallet" to QuickBooks and "unrecoverable through this tool — re-approving returns count 0"
    // (the tool's own docstring). `operational` auto-approves unattended at `assisted`; `money`
    // never does, at any level — that gap is the whole point of this test.
    const tool = tools.find((t) => t.name === "timesheet_approve_week");
    expect(tool?.riskTier).toBe("money");
  });
});
