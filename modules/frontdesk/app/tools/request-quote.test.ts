import { describe, it, expect, beforeEach } from "vitest";
import {
  asOrgId,
  asLeadId,
  asTaskId,
  asUserId,
  asPhone,
  zeroMoney,
  FixedClock,
  isOk,
  validation,
  err,
  type OrgId,
  type LeadId,
  type TaskId,
  type CursorPage,
  type Paginated,
  type AppError,
  type Result,
} from "@mallet/shared/types";
import { InMemoryEventBus, type IdGenerator } from "@mallet/shared/ports";
import type { Principal } from "@mallet/identity";
import { Lead, type LeadStage } from "../../../customers/domain/lead";
import type {
  LeadRepository,
  EnsureCustomerInput,
  EnsureCustomerResult,
  LeadFilter,
} from "../../../customers/domain/lead-repository";
import { EnsureCustomerUseCase } from "../../../customers/app/ensure-customer";
import { Task, type TaskProps } from "../../../tasks/domain/task";
import type { TaskRepository, TaskFilter } from "../../../tasks/domain/task-repository";
import { CreateTaskUseCase } from "../../../tasks/app/create-task";
import {
  requestQuoteTool,
  REQUEST_QUOTE_SPEAK,
  buildQuoteTaskText,
  NO_PHONE_NOTE,
} from "./request-quote";
import { inertSendNotification, inertGeocoder } from "./test-support";
import { toVoiceToolSpec, type VoiceToolContext, type VoiceToolDeps } from "./tool-result";

// ---------------------------------------------------------------------------
// Fixtures + fakes — the runner constructs the real use-cases from a tx; here we drive them with
// in-memory repositories so the tool's wiring (ensure → quote task, phone parsing, fallbacks) is
// asserted deterministically.
// ---------------------------------------------------------------------------

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD_UUID = "33333333-3333-3333-3333-333333333333";

const PRINCIPAL: Principal = {
  userId: asUserId("11111111-1111-1111-1111-111111111111"),
  orgId: ORG,
  role: "office",
};

const seqIds = (): IdGenerator => {
  let n = 0;
  return {
    newId: () => {
      n += 1;
      return `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
    },
  };
};

const buildLead = (input: EnsureCustomerInput): Lead => {
  const now = new Date("2026-07-14T00:00:00Z");
  const result = Lead.create({
    id: asLeadId(LEAD_UUID),
    orgId: ORG,
    name: input.name,
    phone: input.phone,
    email: input.email,
    customFields: null,
    source: input.source,
    stage: "new" as LeadStage,
    value: zeroMoney,
    unread: true,
    wonAt: null,
    companyId: input.companyId,
    role: input.role,
    notes: input.notes,
    lossReason: null,
    address: input.address,
    createdAt: now,
    updatedAt: now,
  });
  if (!isOk(result)) throw new Error(`buildLead: ${result.error.message}`);
  return result.value;
};

class FakeLeadRepository implements LeadRepository {
  readonly ensured: EnsureCustomerInput[] = [];

  async ensureCustomer(input: EnsureCustomerInput): Promise<EnsureCustomerResult> {
    this.ensured.push(input);
    return { lead: buildLead(input), created: true };
  }
  async findById(_id: LeadId): Promise<Lead | null> {
    return null;
  }


  async findByPhone(): Promise<Lead | null> {
    return null;
  }

  // Not exercised here: the voice front desk always resolves a caller by phone, never by name.
  async findByNames(): Promise<Lead[]> {
    return [];
  }

  async findByIds(ids: readonly LeadId[]): Promise<Lead[]> {
    const found: Lead[] = [];
    for (const id of ids) {
      const lead = await this.findById(id);
      if (lead) found.push(lead);
    }
    return found;
  }
  async count(): Promise<number> { return 0; }
  async facets(): Promise<{ stages: Record<string, number>; sources: { source: string; n: number }[] }> { return { stages: {}, sources: [] }; }
  async viewCounts(): Promise<Record<string, number>> { return { intake: 0, quoting: 0, out: 0, won: 0 }; }
  async list(_page: CursorPage, _filter?: LeadFilter): Promise<Paginated<Lead>> {
    return { items: [], nextCursor: null };
  }
  async save(_lead: Lead): Promise<void> {}
  async archiveByLead(): Promise<number> { return 0; }
  async archive(_id: LeadId, _now: Date): Promise<number> {
    return 0;
  }
  async restore(_id: LeadId, _now: Date): Promise<Lead | null> {
    return null;
  }
}

class FakeTaskRepository implements TaskRepository {
  async count(): Promise<number> { return 0; }
  readonly created: TaskProps[] = [];

  async create(input: {
    id: string;
    orgId: string;
    leadId: string | null;
    text: string;
    dueDate: string | null;
  }): Promise<Task> {
    const now = new Date("2026-07-14T00:00:00Z");
    const result = Task.create({
      id: asTaskId(input.id),
      orgId: asOrgId(input.orgId),
      leadId: input.leadId ? asLeadId(input.leadId) : null,
      text: input.text,
      dueDate: input.dueDate,
      done: false,
      createdAt: now,
      updatedAt: now,
    });
    if (!isOk(result)) throw new Error(`FakeTaskRepository.create: ${result.error.message}`);
    this.created.push(result.value.props);
    return result.value;
  }
  async findById(_id: TaskId): Promise<Task | null> {
    return null;
  }
  async list(_page: CursorPage, _filter?: TaskFilter): Promise<Paginated<Task>> {
    return { items: [], nextCursor: null };
  }
  async save(_task: Task): Promise<void> {}
  async remove(_id: TaskId, _now: Date): Promise<number> {
    return 0;
  }
}

interface Harness {
  ctx: VoiceToolContext;
  leads: FakeLeadRepository;
  tasks: FakeTaskRepository;
}

const buildHarness = (overrides?: {
  leads?: LeadRepository;
  createTask?: CreateTaskUseCase;
}): Harness => {
  const clock = new FixedClock(new Date("2026-07-14T00:00:00Z"));
  const bus = new InMemoryEventBus();
  const ids = seqIds();
  const leads = new FakeLeadRepository();
  const tasks = new FakeTaskRepository();
  const deps: VoiceToolDeps = {
    ensureCustomer: new EnsureCustomerUseCase(overrides?.leads ?? leads, bus, clock),
    createTask: overrides?.createTask ?? new CreateTaskUseCase(tasks, clock, ids),
    // request_quote never books — inert stubs satisfy the deps shape.
    createManualJob: {} as never,
    createVisit: {} as never,
    settings: { async getByOrg() { return null; } },
    availability: { async read() { return { crewCount: 0, visits: [] }; }, async readFieldCrewIds() { return []; }, async readCrewSchedules() { return []; }, async readSameDayCrewLoads() { return []; } },
    geocoder: inertGeocoder(),
    sendNotification: inertSendNotification(),
    canSendAutomatedSms: async () => true,
    bus,
    clock,
    ids,
  };
  return { ctx: { tx: {} as never, orgId: ORG, principal: PRINCIPAL, deps }, leads, tasks };
};

const errCreateTask = (): CreateTaskUseCase =>
  ({
    async exec(): Promise<Result<never, AppError>> {
      return err(validation("task text is required", "text"));
    },
  }) as unknown as CreateTaskUseCase;

const QUOTE_INPUT = {
  caller_name: "Jane Doe",
  phone: "(925) 555-0182",
  address: "12 Elm St, Pleasanton",
  scope_details: "repipe the whole house in copper",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("requestQuoteTool", () => {
  let h: Harness;
  beforeEach(() => {
    h = buildHarness();
  });

  it("is named exactly request_quote (disposition maps the tool NAME)", () => {
    expect(requestQuoteTool.name).toBe("request_quote");
  });

  it("exposes a JSON schema with the required quote fields", () => {
    const params = requestQuoteTool.parameters as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(params.required.sort()).toEqual(["caller_name", "phone", "scope_details"].sort());
    expect(Object.keys(params.properties).sort()).toEqual(
      ["address", "caller_name", "phone", "scope_details"].sort(),
    );
  });

  it("creates a lead and a quote task with the exact derived text", async () => {
    const result = await requestQuoteTool.handle(QUOTE_INPUT, h.ctx);

    expect(result.speak).toBe(REQUEST_QUOTE_SPEAK);
    // data is empty — disposition derives quote_request from the tool NAME, not the payload.
    expect(result.data).toEqual({});

    expect(h.leads.ensured).toHaveLength(1);
    expect(h.leads.ensured[0]!.source).toBe("AI Front Desk");
    expect(h.leads.ensured[0]!.name).toBe("Jane Doe");
    expect(h.leads.ensured[0]!.notes).toBe("repipe the whole house in copper");
    expect(h.leads.ensured[0]!.address).toBe("12 Elm St, Pleasanton");
    expect(h.leads.ensured[0]!.phone).toBe(asPhone("+19255550182"));

    expect(h.tasks.created).toHaveLength(1);
    expect(h.tasks.created[0]!.text).toBe(buildQuoteTaskText(QUOTE_INPUT.scope_details, true));
    expect(h.tasks.created[0]!.text).toBe("Quote request — repipe the whole house in copper");
    expect(h.tasks.created[0]!.leadId).toBe(LEAD_UUID);
  });

  it("captures a null-address lead when address is omitted", async () => {
    await requestQuoteTool.handle(
      { caller_name: "Bob", phone: "925-555-0182", scope_details: "water heater swap" },
      h.ctx,
    );
    expect(h.leads.ensured[0]!.address).toBeNull();
  });

  it("invalid phone: STILL creates the lead (null phone) + a task noting no phone + office-text speak", async () => {
    const result = await requestQuoteTool.handle(
      { ...QUOTE_INPUT, phone: "not-a-phone" },
      h.ctx,
    );
    // (1) the lead IS ensured so the office can still follow up, with a null phone
    expect(h.leads.ensured).toHaveLength(1);
    expect(h.leads.ensured[0]!.phone).toBeNull();
    expect(h.leads.ensured[0]!.source).toBe("AI Front Desk");
    // (2) the quote task text NOTES that no phone was captured
    expect(h.tasks.created).toHaveLength(1);
    expect(h.tasks.created[0]!.text).toContain(NO_PHONE_NOTE);
    expect(h.tasks.created[0]!.text).toBe(buildQuoteTaskText(QUOTE_INPUT.scope_details, false));
    expect(h.tasks.created[0]!.leadId).toBe(LEAD_UUID);
    // (3) the SPEAK promises a CALLBACK (texting is off until A2P is live), not a text
    expect(result.speak).toBe(REQUEST_QUOTE_SPEAK);
    expect(result.speak).toMatch(/office will call you back with a written quote/i);
    expect(result.speak).not.toMatch(/text/i);
  });

  it("EnsureCustomer err → spoken fallback, no throw, no task", async () => {
    const result = await requestQuoteTool.handle(
      { caller_name: " ", phone: "925-555-0182", scope_details: "x" },
      h.ctx,
    );
    // Zod min(1) allows a single space; the use-case trims → validation error → spoken fallback.
    expect(result.speak).toBe(REQUEST_QUOTE_SPEAK);
    expect(h.tasks.created).toHaveLength(0);
  });

  it("CreateTask err → spoken fallback, no throw (lead still ensured)", async () => {
    const h2 = buildHarness({ createTask: errCreateTask() });
    const result = await requestQuoteTool.handle(
      { caller_name: "Jane", phone: "925-555-0182", scope_details: "x" },
      h2.ctx,
    );
    expect(result.speak).toBe(REQUEST_QUOTE_SPEAK);
    expect(h2.leads.ensured).toHaveLength(1);
  });

  it("toVoiceToolSpec projects the tool onto the Vapi function spec", () => {
    const spec = toVoiceToolSpec(requestQuoteTool);
    expect(spec.type).toBe("function");
    expect(spec.function.name).toBe("request_quote");
    expect(spec.function.parameters).toBe(requestQuoteTool.parameters);
  });
});
