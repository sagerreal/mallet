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
  escalateCallbackTool,
  buildCallbackTaskText,
  ESCALATE_CALLBACK_SPEAK,
} from "./escalate-callback";
import { inertSendNotification, inertGeocoder } from "./test-support";
import { toVoiceToolSpec, type VoiceToolContext, type VoiceToolDeps } from "./tool-result";

// ---------------------------------------------------------------------------
// Fixtures + fakes — in-memory repos drive real use-cases so the tool's wiring
// (ensure → task, phone parsing, fallbacks) is asserted without hitting Supabase.
// DO NOT import the frontdesk barrel — it pulls infra + config (house gotcha).
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
    // escalate_callback never books — inert stubs satisfy the deps shape.
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

// A CreateTaskUseCase stand-in that always returns an expected err Result (not a throw).
const errCreateTask = (): CreateTaskUseCase =>
  ({
    async exec(): Promise<Result<never, AppError>> {
      return err(validation("task text is required", "text"));
    },
  }) as unknown as CreateTaskUseCase;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("escalateCallbackTool", () => {
  let h: Harness;
  beforeEach(() => {
    h = buildHarness();
  });

  it("is named exactly escalate_callback (disposition maps the tool NAME)", () => {
    expect(escalateCallbackTool.name).toBe("escalate_callback");
  });

  it("exposes a JSON schema requiring caller_name and reason (phone is optional)", () => {
    const params = escalateCallbackTool.parameters as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(params.required.sort()).toEqual(["caller_name", "reason"].sort());
    expect(Object.keys(params.properties).sort()).toEqual(
      ["caller_name", "phone", "reason"].sort(),
    );
  });

  it("creates a lead and a callback task with the EXACT derived text", async () => {
    const input = {
      caller_name: "Jane Doe",
      phone: "(925) 555-0182",
      reason: "insurance question — out of scope",
    };
    const result = await escalateCallbackTool.handle(input, h.ctx);

    expect(result.speak).toBe(ESCALATE_CALLBACK_SPEAK);
    expect(result.data).toMatchObject({ filed: true });

    expect(h.leads.ensured).toHaveLength(1);
    expect(h.leads.ensured[0]!.source).toBe("AI Front Desk");
    expect(h.leads.ensured[0]!.name).toBe("Jane Doe");
    expect(h.leads.ensured[0]!.notes).toBe("insurance question — out of scope");

    expect(h.tasks.created).toHaveLength(1);
    expect(h.tasks.created[0]!.text).toBe(buildCallbackTaskText(input));
    expect(h.tasks.created[0]!.text).toBe(
      "CALL BACK — Jane Doe: insurance question — out of scope",
    );
    expect(h.tasks.created[0]!.leadId).toBe(LEAD_UUID);
  });

  it("buildCallbackTaskText pure helper produces CALL BACK — {name}: {reason}", () => {
    expect(buildCallbackTaskText({ caller_name: "Bob", reason: "wants a person" })).toBe(
      "CALL BACK — Bob: wants a person",
    );
    expect(
      buildCallbackTaskText({ caller_name: "Alice", reason: "same-day emergency, no slot" }),
    ).toBe("CALL BACK — Alice: same-day emergency, no slot");
  });

  it("parses a valid phone into E.164 on the ensured lead", async () => {
    await escalateCallbackTool.handle(
      { caller_name: "Bob", phone: "925-555-0182", reason: "wants a person" },
      h.ctx,
    );
    expect(h.leads.ensured[0]!.phone).toBe(asPhone("+19255550182"));
  });

  it("creates the lead with a null phone when the phone is invalid — task still filed", async () => {
    const result = await escalateCallbackTool.handle(
      { caller_name: "Bob", phone: "not-a-phone", reason: "warranty question" },
      h.ctx,
    );
    expect(result.speak).toBe(ESCALATE_CALLBACK_SPEAK);
    expect(h.leads.ensured[0]!.phone).toBeNull();
    expect(h.tasks.created).toHaveLength(1);
  });

  it("creates the lead with a null phone when no phone is supplied — task still filed", async () => {
    const result = await escalateCallbackTool.handle(
      { caller_name: "Bob", reason: "just wants a person" },
      h.ctx,
    );
    expect(result.speak).toBe(ESCALATE_CALLBACK_SPEAK);
    expect(h.leads.ensured[0]!.phone).toBeNull();
    expect(h.tasks.created).toHaveLength(1);
  });

  it("returns spoken fallback (filed:false) when EnsureCustomer errors — no throw", async () => {
    // Single space passes Zod min(1) but EnsureCustomer trims it → validation err → spoken fallback.
    const result = await escalateCallbackTool.handle(
      { caller_name: " ", reason: "x" },
      h.ctx,
    );
    expect(result.speak).toBe(ESCALATE_CALLBACK_SPEAK);
    expect(result.data).toMatchObject({ filed: false });
    expect(h.tasks.created).toHaveLength(0);
  });

  it("returns spoken fallback (filed:false) when CreateTask returns an err — no throw", async () => {
    const h2 = buildHarness({ createTask: errCreateTask() });
    const result = await escalateCallbackTool.handle(
      { caller_name: "Jane", reason: "x" },
      h2.ctx,
    );
    expect(result.speak).toBe(ESCALATE_CALLBACK_SPEAK);
    expect(result.data).toMatchObject({ filed: false });
    // Lead WAS ensured even though the task failed.
    expect(h2.leads.ensured).toHaveLength(1);
  });

  it("toVoiceToolSpec projects the tool onto the Vapi function spec", () => {
    const spec = toVoiceToolSpec(escalateCallbackTool);
    expect(spec.type).toBe("function");
    expect(spec.function.name).toBe("escalate_callback");
    expect(spec.function.description).toBe(escalateCallbackTool.description);
    expect(spec.function.parameters).toBe(escalateCallbackTool.parameters);
  });
});
