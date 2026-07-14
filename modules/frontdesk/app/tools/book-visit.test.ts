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
  type JobId,
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
import { Job, type JobKind } from "../../../jobs/domain/job";
import type { JobRepository } from "../../../jobs/domain/job-repository";
import { CreateManualJobUseCase } from "../../../jobs/app/create-manual-job";
import { CreateVisitUseCase } from "../../../jobs/app/create-visit";
import { OrgSettings, type OrgSettingsProps } from "../../../settings/domain/org-settings";
import { baseSettingsProps } from "../../../settings/domain/org-settings.fixtures";
import type { SettingsReader } from "../../domain/assistant";
import {
  bookVisitTool,
  BOOK_VISIT_INVALID_PHONE_SPEAK,
  BOOK_VISIT_ERROR_SPEAK,
} from "./book-visit";
import type { VoiceToolContext, VoiceToolDeps } from "./tool-result";

// ---------------------------------------------------------------------------
// Fixtures + fakes. The runner constructs the real use-cases from a tx; here we drive them with
// in-memory repositories so the tool's wiring (ensure → job → visit → task, phone parsing,
// window-start derivation, price provenance) is asserted deterministically.
// ---------------------------------------------------------------------------

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const LEAD_UUID = "33333333-3333-3333-3333-333333333333";

const PRINCIPAL: Principal = {
  userId: asUserId("11111111-1111-1111-1111-111111111111"),
  orgId: ORG,
  role: "office",
};

// Tuesday 2026-07-14 — a weekday. Wall-clock time is irrelevant to booking (the window start comes
// from the org's hours, never from a clock), but a fixed value keeps everything deterministic.
const CLOCK = new FixedClock(new Date("2026-07-14T00:00:00Z"));

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
  async list(_page: CursorPage, _filter?: LeadFilter): Promise<Paginated<Lead>> {
    return { items: [], nextCursor: null };
  }
  async save(_lead: Lead): Promise<void> {}
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

// An in-memory job store that both CreateManualJobUseCase and CreateVisitUseCase share: manual
// insert stores the job; findById returns it so CreateVisit can append a visit; save replaces it.
// This makes the end-to-end job→visit wiring observable without a DB. Only the four methods those
// two use-cases call are implemented; the rest of the large JobRepository port is unused by
// book_visit, so the store is cast to the port through a proxy that throws on any other method.
class FakeJobStore {
  readonly jobs = new Map<string, Job>();
  private seq = 0;

  async nextNumber(): Promise<string> {
    this.seq += 1;
    return `JOB-${this.seq}`;
  }
  async insertManual(job: Job): Promise<void> {
    this.jobs.set(job.props.id, job);
  }
  async findById(id: JobId): Promise<Job | null> {
    return this.jobs.get(id) ?? null;
  }
  async save(job: Job): Promise<void> {
    this.jobs.set(job.props.id, job);
  }
}

// Present the minimal store as the full port: any method book_visit never calls throws loudly if
// hit, so an accidental new dependency surfaces in tests rather than silently no-op'ing.
const asJobRepository = (store: FakeJobStore): JobRepository =>
  new Proxy(store, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      return () => {
        throw new Error(`FakeJobStore: unexpected JobRepository.${String(prop)} call`);
      };
    },
  }) as unknown as JobRepository;

const settingsFrom = (over: Partial<OrgSettingsProps> = {}): OrgSettings => {
  const result = OrgSettings.create(baseSettingsProps({ orgId: ORG, ...over }));
  if (!result.ok) throw new Error(`settings fixture: ${result.error.message}`);
  return result.value;
};

const fakeSettings = (settings: OrgSettings | null): SettingsReader => ({
  async getByOrg() {
    return settings;
  },
});

interface Harness {
  ctx: VoiceToolContext;
  leads: FakeLeadRepository;
  jobs: FakeJobStore;
  tasks: FakeTaskRepository;
}

const buildHarness = (over?: {
  settings?: OrgSettings | null;
  leads?: LeadRepository;
  jobs?: FakeJobStore;
  createManualJob?: CreateManualJobUseCase;
  createVisit?: CreateVisitUseCase;
  createTask?: CreateTaskUseCase;
}): Harness => {
  const bus = new InMemoryEventBus();
  const ids = seqIds();
  const leads = new FakeLeadRepository();
  const jobs = over?.jobs ?? new FakeJobStore();
  const jobRepo = asJobRepository(jobs);
  const tasks = new FakeTaskRepository();
  const settings = over?.settings === undefined ? settingsFrom() : over.settings;

  const deps: VoiceToolDeps = {
    ensureCustomer: new EnsureCustomerUseCase(over?.leads ?? leads, bus, CLOCK),
    createManualJob:
      over?.createManualJob ?? new CreateManualJobUseCase(jobRepo, bus, CLOCK, ids),
    createVisit: over?.createVisit ?? new CreateVisitUseCase(jobRepo, CLOCK, ids),
    createTask: over?.createTask ?? new CreateTaskUseCase(tasks, CLOCK, ids),
    settings: fakeSettings(settings),
    availability: { async read() { return { crewCount: 0, visits: [] }; } },
    bus,
    clock: CLOCK,
    ids,
  };
  return { ctx: { tx: {} as never, orgId: ORG, principal: PRINCIPAL, deps }, leads, jobs, tasks };
};

const REPAIR_INPUT = {
  caller_name: "Jane Doe",
  phone: "(925) 555-0182",
  address: "12 Elm St, Pleasanton",
  service_name: "Leaky faucet",
  lane: "repair" as const,
  problem: "kitchen faucet dripping",
  slot_date: "2026-07-16", // a Thursday (weekday)
  slot_window: "morning" as const,
  urgency: "normal" as const,
};

const onlyJob = (h: Harness): Job => {
  const all = [...h.jobs.jobs.values()];
  expect(all).toHaveLength(1);
  return all[0]!;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("bookVisitTool", () => {
  let h: Harness;
  beforeEach(() => {
    h = buildHarness();
  });

  it("exposes a JSON schema with the required booking fields", () => {
    const params = bookVisitTool.parameters as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(params.required.sort()).toEqual(
      ["address", "caller_name", "lane", "phone", "service_name", "slot_date", "slot_window"].sort(),
    );
    expect(Object.keys(params.properties).sort()).toEqual(
      [
        "address",
        "caller_name",
        "lane",
        "phone",
        "problem",
        "service_name",
        "slot_date",
        "slot_window",
        "urgency",
      ].sort(),
    );
  });

  it("repair: books a work-kind job + visit and states the service fee (credited)", async () => {
    const result = await bookVisitTool.handle(REPAIR_INPUT, h.ctx);

    // lead ensured with the AI source + problem as notes + parsed phone
    expect(h.leads.ensured).toHaveLength(1);
    expect(h.leads.ensured[0]!.source).toBe("AI Front Desk");
    expect(h.leads.ensured[0]!.notes).toBe("kitchen faucet dripping");
    expect(h.leads.ensured[0]!.phone).toBe(asPhone("+19255550182"));

    // a work-kind job with the service name + notes
    const job = onlyJob(h);
    expect(job.props.kind).toBe<JobKind>("work");
    expect(job.props.svc).toBe("Leaky faucet");
    expect(job.props.leadId).toBe(asLeadId(LEAD_UUID));

    // a visit seeded on the job: correct date, morning-window start = weekday open (08:00),
    // duration from visitRepairMinutes (90m = 1.5h)
    const visit = job.props.visits[0]!;
    expect(visit).toBeDefined();
    expect(visit.props.scheduledDate).toBe("2026-07-16");
    expect(visit.props.scheduledStart).toBe("08:00");
    expect(visit.props.durationMinutes).toBe(90);

    // price provenance: the service fee, credited phrasing on
    expect(result.speak).toContain("$89");
    expect(result.speak).toContain("credited toward the repair");
    expect(result.data).toMatchObject({ kind: "work", emergency: false });
  });

  it("repair: omits the credited phrase when feeCredited is off", async () => {
    const h2 = buildHarness({ settings: settingsFrom({ booking: { services: [], notServices: "", serviceFee: 120, feeCredited: false } }) });
    const result = await bookVisitTool.handle(REPAIR_INPUT, h2.ctx);
    expect(result.speak).toContain("$120");
    expect(result.speak).not.toContain("credited");
  });

  it("estimate: books a kind='estimate' job, scope-minutes duration, and NO price", async () => {
    const result = await bookVisitTool.handle(
      { ...REPAIR_INPUT, lane: "estimate", service_name: "Repipe estimate" },
      h.ctx,
    );
    const job = onlyJob(h);
    expect(job.props.kind).toBe<JobKind>("estimate");
    // visitScopeMinutes = 30 in the fixture → 0.5h
    expect(job.props.visits[0]!.props.durationMinutes).toBe(30);

    expect(result.speak).toContain("free estimate visit");
    expect(result.speak).not.toContain("$");
    expect(result.data).toMatchObject({ kind: "estimate", emergency: false });
  });

  it("flat with a configured price: states exactly the configured $price and books work", async () => {
    const withFlat = settingsFrom({
      booking: {
        services: [{ name: "Drain cleaning", lane: "flat", price: 99, triggers: "clogged" }],
        notServices: "",
        serviceFee: 89,
        feeCredited: true,
      },
    });
    const h2 = buildHarness({ settings: withFlat });
    const result = await bookVisitTool.handle(
      { ...REPAIR_INPUT, lane: "flat", service_name: "Drain cleaning" },
      h2.ctx,
    );
    expect(result.speak).toContain("$99");
    expect(result.speak).not.toContain("$89"); // states the flat price, not the fee
    expect(onlyJob(h2).props.kind).toBe<JobKind>("work");
    expect(result.data).toMatchObject({ kind: "work", emergency: false });
  });

  it("flat with an UNCONFIGURED name: falls back to the service fee, never an invented number", async () => {
    // the fixture's only flat service is priced 99; ask for a name that has no configured flat price
    const withFlat = settingsFrom({
      booking: {
        services: [{ name: "Drain cleaning", lane: "flat", price: 99, triggers: "clogged" }],
        notServices: "",
        serviceFee: 89,
        feeCredited: true,
      },
    });
    const h2 = buildHarness({ settings: withFlat });
    const result = await bookVisitTool.handle(
      { ...REPAIR_INPUT, lane: "flat", service_name: "Mystery service" },
      h2.ctx,
    );
    // safe fallback: states the configured service fee, NOT the 99 flat price, NOT any invented value
    expect(result.speak).toContain("$89");
    expect(result.speak).not.toContain("$99");
    expect(result.data).toMatchObject({ kind: "work" });
  });

  it("afternoon window derives the 13:00 boundary start, never a model time", async () => {
    const result = await bookVisitTool.handle({ ...REPAIR_INPUT, slot_window: "afternoon" }, h.ctx);
    expect(onlyJob(h).props.visits[0]!.props.scheduledStart).toBe("13:00");
    expect(result.speak).toContain("$89");
  });

  it("morning window on Saturday derives Saturday's open hour", async () => {
    const satHours = settingsFrom({ hoursSatOpen: 9, hoursSatClose: 15 });
    const h2 = buildHarness({ settings: satHours });
    // 2026-07-18 is a Saturday
    await bookVisitTool.handle({ ...REPAIR_INPUT, slot_date: "2026-07-18", slot_window: "morning" }, h2.ctx);
    expect(onlyJob(h2).props.visits[0]!.props.scheduledStart).toBe("09:00");
  });

  it("invalid phone: does NOT book and re-asks for the number", async () => {
    const result = await bookVisitTool.handle({ ...REPAIR_INPUT, phone: "not-a-phone" }, h.ctx);
    expect(result.speak).toBe(BOOK_VISIT_INVALID_PHONE_SPEAK);
    expect(h.leads.ensured).toHaveLength(0);
    expect(h.jobs.jobs.size).toBe(0);
  });

  it("emergency: files an EMERGENCY task and sets data.emergency=true", async () => {
    const result = await bookVisitTool.handle({ ...REPAIR_INPUT, urgency: "emergency" }, h.ctx);
    expect(result.data).toMatchObject({ emergency: true, kind: "work" });
    expect(h.tasks.created).toHaveLength(1);
    expect(h.tasks.created[0]!.text).toContain("EMERGENCY");
    expect(h.tasks.created[0]!.text).toContain("Leaky faucet");
    expect(h.tasks.created[0]!.text).toContain("12 Elm St, Pleasanton");
    expect(h.tasks.created[0]!.leadId).toBe(LEAD_UUID);
  });

  it("use-case err (job create fails): spoken fallback, no throw, no visit", async () => {
    const errManualJob = {
      async exec(): Promise<Result<never, AppError>> {
        return err(validation("job failed", "svc"));
      },
    } as unknown as CreateManualJobUseCase;
    const h2 = buildHarness({ createManualJob: errManualJob });
    const result = await bookVisitTool.handle(REPAIR_INPUT, h2.ctx);
    expect(result.speak).toBe(BOOK_VISIT_ERROR_SPEAK);
    // a message task is filed so the office locks in the time
    expect(h2.tasks.created.length).toBeGreaterThanOrEqual(1);
  });

  it("no settings for the org: spoken fallback, no throw", async () => {
    const h2 = buildHarness({ settings: null });
    const result = await bookVisitTool.handle(REPAIR_INPUT, h2.ctx);
    expect(result.speak).toBe(BOOK_VISIT_ERROR_SPEAK);
    expect(h2.jobs.jobs.size).toBe(0);
  });
});
