import { describe, it, expect, vi } from "vitest";

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

const MONEY_OR_WORSE = new Set(["money", "destructive"]);

describe("the tool catalog's risk tiers", () => {
  const tools = buildAgentTools();

  it("gives every tool a tier", () => {
    const missing = tools.filter((t) => !t.riskTier).map((t) => t.name);
    expect(missing).toEqual([]);
  });

  it("classifies contact-field mutation as destructive, not operational", () => {
    // customer_update can change email/phone/address: a redirection primitive for documents and
    // payment links. If this ever relaxes to operational, an injected note can redirect a quote.
    const tool = tools.find((t) => t.name === "customer_update");
    expect(tool?.riskTier).toBe("destructive");
  });

  it("keeps every money-moving tool out of the auto-approvable tiers", () => {
    for (const name of ["invoice_record_payment", "invoice_void", "quote_accept", "invoice_update"]) {
      expect(MONEY_OR_WORSE.has(tools.find((t) => t.name === name)?.riskTier ?? "")).toBe(true);
    }
  });

  it("marks every comms tool mutating, so the gate sees it at all", () => {
    for (const t of tools.filter((x) => x.riskTier === "comms")) {
      expect(t.mutating).toBe(true);
    }
  });
});
