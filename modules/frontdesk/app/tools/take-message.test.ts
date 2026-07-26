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
  type OrgId,
  type LeadId,
  type TaskId,
  type CursorPage,
  type Paginated,
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
import { validation, err, type AppError, type Result } from "@mallet/shared/types";
import { takeMessageTool, buildMessageTaskText, TAKE_MESSAGE_SPEAK } from "./take-message";
import { inertSendNotification, inertGeocoder } from "./test-support";
import { toVoiceToolSpec, type VoiceToolContext, type VoiceToolDeps } from "./tool-result";

// ---------------------------------------------------------------------------
// Fixtures + fakes — the runner constructs the real use-cases from a tx; here we drive them with
// in-memory repositories so the tool's wiring (ensure → task, phone parsing, fallbacks) is asserted.
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
    source: input.source,
    stage: "new" as LeadStage,
    value: zeroMoney,
    unread: true,
    wonAt: null,
    companyId: input.companyId,
    role: input.role,
    notes: input.notes,
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

  async findByIds(ids: readonly LeadId[]): Promise<Lead[]> {
    const found: Lead[] = [];
    for (const id of ids) {
      const lead = await this.findById(id);
      if (lead) found.push(lead);
    }
    return found;
  }
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

const buildCtx = (deps: VoiceToolDeps): VoiceToolContext => ({
  tx: {} as never,
  orgId: ORG,
  principal: PRINCIPAL,
  deps,
});

interface Harness {
  ctx: VoiceToolContext;
  leads: FakeLeadRepository;
  tasks: FakeTaskRepository;
}

const buildHarness = (overrides?: {
  leads?: LeadRepository;
  tasks?: TaskRepository;
  createTask?: CreateTaskUseCase;
}): Harness => {
  const clock = new FixedClock(new Date("2026-07-14T00:00:00Z"));
  const bus = new InMemoryEventBus();
  const ids = seqIds();
  const leads = new FakeLeadRepository();
  const tasks = new FakeTaskRepository();
  const deps: VoiceToolDeps = {
    ensureCustomer: new EnsureCustomerUseCase(overrides?.leads ?? leads, bus, clock),
    createTask: overrides?.createTask ?? new CreateTaskUseCase(overrides?.tasks ?? tasks, clock, ids),
    // take_message never books — provide inert stubs for the job/visit + read deps to satisfy the shape.
    createManualJob: {} as never,
    createVisit: {} as never,
    settings: { async getByOrg() { return null; } },
    availability: { async read() { return { crewCount: 0, visits: [] }; }, async readFieldCrewIds() { return []; }, async readCrewSchedules() { return []; }, async readSameDayCrewLoads() { return []; } },
    geocoder: inertGeocoder(),
    sendNotification: inertSendNotification(),
    isSmsA2pActive: async () => true,
    bus,
    clock,
    ids,
  };
  return { ctx: buildCtx(deps), leads, tasks };
};

// A CreateTaskUseCase stand-in that always returns an expected err Result (not a throw) — exercises
// the tool's "task failed" spoken-fallback branch without an in-memory repo that can only throw.
const errCreateTask = (): CreateTaskUseCase =>
  ({
    async exec(): Promise<Result<never, AppError>> {
      return err(validation("task text is required", "text"));
    },
  }) as unknown as CreateTaskUseCase;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("takeMessageTool", () => {
  let h: Harness;
  beforeEach(() => {
    h = buildHarness();
  });

  it("exposes a JSON-schema with the required fields", () => {
    const params = takeMessageTool.parameters as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(params.required).toEqual(["caller_name", "topic", "details"]);
    expect(Object.keys(params.properties).sort()).toEqual(
      ["caller_name", "details", "phone", "topic"].sort(),
    );
  });

  it("creates a lead and a task with the exact derived text", async () => {
    const input = {
      caller_name: "Jane Doe",
      phone: "(925) 555-0182",
      topic: "billing" as const,
      details: "wants a copy of her last invoice",
    };
    const result = await takeMessageTool.handle(input, h.ctx);

    expect(result.speak).toBe(TAKE_MESSAGE_SPEAK);
    expect(result.data).toMatchObject({ topic: "billing", filed: true });

    expect(h.leads.ensured).toHaveLength(1);
    expect(h.leads.ensured[0]!.source).toBe("AI Front Desk");
    expect(h.leads.ensured[0]!.name).toBe("Jane Doe");

    expect(h.tasks.created).toHaveLength(1);
    expect(h.tasks.created[0]!.text).toBe(buildMessageTaskText(input));
    expect(h.tasks.created[0]!.text).toBe(
      "Call from Jane Doe — billing: wants a copy of her last invoice",
    );
    expect(h.tasks.created[0]!.leadId).toBe(LEAD_UUID);
  });

  it("parses a valid phone into E.164 on the ensured lead", async () => {
    await takeMessageTool.handle(
      { caller_name: "Bob", phone: "925-555-0182", topic: "callback" as const, details: "call me" },
      h.ctx,
    );
    expect(h.leads.ensured[0]!.phone).toBe(asPhone("+19255550182"));
  });

  it("creates the lead with a null phone when the phone is invalid — no throw", async () => {
    const result = await takeMessageTool.handle(
      { caller_name: "Bob", phone: "not-a-phone", topic: "callback" as const, details: "call me" },
      h.ctx,
    );
    expect(result.speak).toBe(TAKE_MESSAGE_SPEAK);
    expect(h.leads.ensured[0]!.phone).toBeNull();
    expect(h.tasks.created).toHaveLength(1);
  });

  it("creates the lead with a null phone when no phone is supplied", async () => {
    await takeMessageTool.handle(
      { caller_name: "Bob", topic: "other" as const, details: "no number" },
      h.ctx,
    );
    expect(h.leads.ensured[0]!.phone).toBeNull();
  });

  it("returns a spoken fallback (filed:false) when EnsureCustomer errors — no throw", async () => {
    // Empty name makes EnsureCustomerUseCase return a validation err before touching the repo.
    const result = await takeMessageTool.handle(
      { caller_name: " ", topic: "other" as const, details: "x" },
      h.ctx,
    );
    // Zod min(1) allows a single space; the use-case trims → validation error → spoken fallback.
    expect(result.speak).toBe(TAKE_MESSAGE_SPEAK);
    expect(result.data).toMatchObject({ filed: false });
    expect(h.tasks.created).toHaveLength(0);
  });

  it("returns a spoken fallback (filed:false) when CreateTask returns an err — no throw", async () => {
    const h2 = buildHarness({ createTask: errCreateTask() });
    const result = await takeMessageTool.handle(
      { caller_name: "Jane", topic: "other" as const, details: "x" },
      h2.ctx,
    );
    // The lead was ensured (created), but the task Result was an err → spoken fallback, filed:false.
    expect(result.speak).toBe(TAKE_MESSAGE_SPEAK);
    expect(result.data).toMatchObject({ filed: false });
    expect(h2.leads.ensured).toHaveLength(1);
  });

  it("propagates an unexpected throw so the runner's try/catch is the backstop", async () => {
    const brokenTasks: TaskRepository = {
      async create(): Promise<Task> {
        throw new Error("db down");
      },
      async findById() {
        return null;
      },
      async list() {
        return { items: [], nextCursor: null };
      },
      async save() {},
      async remove() {
        return 0;
      },
    };
    const h2 = buildHarness({ tasks: brokenTasks });
    // A throw from the repo bubbles out of the use-case; the tool itself does NOT catch an
    // unexpected throw — the runner turns it into a fallback + auto follow-up task.
    await expect(
      takeMessageTool.handle(
        { caller_name: "Jane", topic: "other" as const, details: "x" },
        h2.ctx,
      ),
    ).rejects.toThrow("db down");
  });

  it("toVoiceToolSpec projects the tool onto the Vapi function spec", () => {
    const spec = toVoiceToolSpec(takeMessageTool);
    expect(spec.type).toBe("function");
    expect(spec.function.name).toBe("take_message");
    expect(spec.function.description).toBe(takeMessageTool.description);
    expect(spec.function.parameters).toBe(takeMessageTool.parameters);
  });
});
