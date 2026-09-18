import { expect } from "vitest";
import {
  asOrgId,
  asLeadId,
  asTaskId,
  asUserId,
  zeroMoney,
  FixedClock,
  isOk,
  type OrgId,
  type LeadId,
  type JobId,
  type TaskId,
  type UserId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import type { CrewLoad } from "../../app/dispatch";
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
import { Job } from "../../../jobs/domain/job";
import type { JobLine } from "../../../jobs/domain/job-execution";
import type { JobRepository } from "../../../jobs/domain/job-repository";
import { CreateManualJobUseCase } from "../../../jobs/app/create-manual-job";
import { CreateVisitUseCase } from "../../../jobs/app/create-visit";
import { OrgSettings, type OrgSettingsProps } from "../../../settings/domain/org-settings";
import { baseSettingsProps } from "../../../settings/domain/org-settings.fixtures";
import type { SettingsReader } from "../../domain/assistant";
import { recordingSendNotification, inertGeocoder, type RecordingSendNotification, type SendMode } from "./test-support";
import type { Geocoder } from "../../domain/geocoder";
import type { PricebookPriceReader } from "../../domain/pricebook-price-reader";
import type { VoiceToolContext, VoiceToolDeps } from "./tool-result";

// ---------------------------------------------------------------------------
// Shared book_visit test harness (fixtures + in-memory fakes). The runner constructs the real
// use-cases from a tx; here we drive them with in-memory repositories so the tool's wiring
// (ensure → job → visit → task, phone parsing, window-start derivation, price provenance) is
// asserted deterministically. Extracted so the happy-path, SMS, and failure suites share it without
// duplicating ~200 lines of fakes (many-small-files / low-coupling house rule).
// ---------------------------------------------------------------------------

export const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
export const LEAD_UUID = "33333333-3333-3333-3333-333333333333";

export const PRINCIPAL: Principal = {
  userId: asUserId("11111111-1111-1111-1111-111111111111"),
  orgId: ORG,
  role: "office",
};

// Tuesday 2026-07-14 — a weekday. Wall-clock time is irrelevant to booking (the window start comes
// from the org's hours, never from a clock), but a fixed value keeps everything deterministic.
export const CLOCK = new FixedClock(new Date("2026-07-14T00:00:00Z"));

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
    tags: [...(input.tags ?? [])],
    stage: "new" as LeadStage,
    value: zeroMoney,
    unread: true,
    wonAt: null,
    companyId: input.companyId,
    role: input.role,
    notes: input.notes,
    lossReason: null,
      pipelineStageId: null,
    address: input.address,
    createdAt: now,
    updatedAt: now,
  });
  if (!isOk(result)) throw new Error(`buildLead: ${result.error.message}`);
  return result.value;
};

export class FakeLeadRepository implements LeadRepository {
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
  async pipelineStageCounts(): Promise<Record<string, number>> { return {}; }
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

export class FakeTaskRepository implements TaskRepository {
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

// An in-memory job store that both CreateManualJobUseCase and CreateVisitUseCase share: manual
// insert stores the job; findById returns it so CreateVisit can append a visit; save replaces it.
// This makes the end-to-end job→visit wiring observable without a DB. Only the four methods those
// two use-cases call are implemented; the rest of the large JobRepository port is unused by
// book_visit, so the store is cast to the port through a proxy that throws on any other method.
export class FakeJobStore {
  readonly jobs = new Map<string, Job>();
  // Priced lines a flat booking persisted (CreateManualJob's replaceLines call), keyed by job id.
  readonly linesByJob = new Map<string, readonly JobLine[]>();
  private seq = 0;

  async nextNumber(): Promise<string> {
    this.seq += 1;
    return `JOB-${this.seq}`;
  }
  async insertManual(job: Job): Promise<void> {
    this.jobs.set(job.props.id, job);
  }
  async replaceLines(jobId: JobId, lines: readonly JobLine[], _now: Date): Promise<void> {
    this.linesByJob.set(jobId, lines);
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

export const settingsFrom = (over: Partial<OrgSettingsProps> = {}): OrgSettings => {
  const result = OrgSettings.create(baseSettingsProps({ orgId: ORG, ...over }));
  if (!result.ok) throw new Error(`settings fixture: ${result.error.message}`);
  return result.value;
};

const fakeSettings = (settings: OrgSettings | null): SettingsReader => ({
  async getByOrg() {
    return settings;
  },
});

export interface Harness {
  ctx: VoiceToolContext;
  leads: FakeLeadRepository;
  jobs: FakeJobStore;
  tasks: FakeTaskRepository;
  // The booking confirmation goes through a real SendNotificationUseCase; `sms` exposes both the
  // sender's captured commands (`sent`) and the persisted notification rows (`rows`).
  sms: RecordingSendNotification;
}

// A stable field-crew user id the book_visit auto-assign tests target (the "first field crew").
export const FIRST_CREW_UUID = "44444444-4444-4444-4444-444444444444";
export const SECOND_CREW_UUID = "55555555-5555-5555-5555-555555555555";

// A fake AvailabilityReader for the book_visit tests: reports the given field-crew ids (in order)
// and, unless `throws` / `sameDayLoadsThrows`, degrades gracefully. Extracted so buildHarness stays
// simple. `sameDayCrewLoads` defaults to [] → chooseCrew returns null → UNASSIGNED (preserving
// current zero-crew behaviour for tests that don't set it).
const fakeAvailability = (
  fieldCrewIds: readonly UserId[],
  throws: boolean,
  sameDayCrewLoads: readonly CrewLoad[],
  sameDayLoadsThrows: boolean,
) => ({
  async read() {
    return { crewCount: fieldCrewIds.length, visits: [] as never[] };
  },
  async readFieldCrewIds() {
    if (throws) throw new Error("field crew read failed");
    return [...fieldCrewIds];
  },
  async readCrewSchedules() {
    return [];
  },
  async readSameDayCrewLoads(_date: string) {
    if (sameDayLoadsThrows) throw new Error("crew loads read failed");
    return [...sameDayCrewLoads];
  },
});

interface HarnessOverrides {
  settings?: OrgSettings | null;
  leads?: LeadRepository;
  jobs?: FakeJobStore;
  createManualJob?: CreateManualJobUseCase;
  createVisit?: CreateVisitUseCase;
  createTask?: CreateTaskUseCase;
  smsMode?: SendMode;
  // Field-crew ids the availability reader returns (for readFieldCrewIds — used by check_availability).
  // Defaults to none (zero field crew → the visit stays UNASSIGNED, as before).
  fieldCrewIds?: readonly UserId[];
  // When set, readFieldCrewIds throws — proves a crew-read failure degrades to UNASSIGNED, not a
  // failed booking.
  fieldCrewThrows?: boolean;
  // Crew loads for readSameDayCrewLoads — drives the proximity-dispatch assignment in book_visit.
  // Defaults to [] → chooseCrew returns null → UNASSIGNED (unchanged zero-crew behaviour).
  sameDayCrewLoads?: readonly CrewLoad[];
  // When set, readSameDayCrewLoads throws — proves a crew-read failure degrades to UNASSIGNED, not
  // a failed booking (graceful-degrade hard rule).
  sameDayLoadsThrows?: boolean;
  // The geocoder the service-area check uses. Defaults to an inert one (always misses → "unknown" →
  // book normally), so existing booking tests are unaffected. Service-area tests pass a fixed point.
  geocoder?: Geocoder;
  // Whether the org's 10DLC campaign reads as active for the booking-confirmation SMS gate. Defaults
  // to true so every existing booking test (asserting the confirmation SMS actually sends) is
  // unaffected; the dedicated A2P-inactive test sets this to false to assert skip-not-throw.
  smsA2pActive?: boolean;
  // Pricebook prices for playbook-LINKED services. Defaults to undefined (no reader) → the stored
  // playbook price is used, exactly like a composition root that doesn't wire the reader.
  pricebookPrices?: PricebookPriceReader;
}

// Assemble the VoiceToolDeps from the resolved fakes. Split from buildHarness so each function keeps
// a low branching factor (the `over?.x ?? default` fallbacks all live here, in one place).
const buildDeps = (args: {
  over: HarnessOverrides;
  bus: InMemoryEventBus;
  ids: IdGenerator;
  leads: FakeLeadRepository;
  jobRepo: JobRepository;
  tasks: FakeTaskRepository;
  settings: OrgSettings | null;
  sms: RecordingSendNotification;
}): VoiceToolDeps => {
  const { over, bus, ids, leads, jobRepo, tasks, settings, sms } = args;
  return {
    ensureCustomer: new EnsureCustomerUseCase(over.leads ?? leads, bus, CLOCK),
    createManualJob: over.createManualJob ?? new CreateManualJobUseCase(jobRepo, bus, CLOCK, ids),
    createVisit: over.createVisit ?? new CreateVisitUseCase(jobRepo, CLOCK, ids),
    createTask: over.createTask ?? new CreateTaskUseCase(tasks, CLOCK, ids),
    settings: fakeSettings(settings),
    availability: fakeAvailability(
      over.fieldCrewIds ?? [],
      over.fieldCrewThrows ?? false,
      over.sameDayCrewLoads ?? [],
      over.sameDayLoadsThrows ?? false,
    ),
    geocoder: over.geocoder ?? inertGeocoder(),
    pricebookPrices: over.pricebookPrices,
    sendNotification: sms.useCase,
    canSendAutomatedSms: async () => over.smsA2pActive ?? true,
    bus,
    clock: CLOCK,
    ids,
  };
};

export const buildHarness = (over: HarnessOverrides = {}): Harness => {
  const bus = new InMemoryEventBus();
  const ids = seqIds();
  const leads = new FakeLeadRepository();
  const jobs = over.jobs ?? new FakeJobStore();
  const jobRepo = asJobRepository(jobs);
  const tasks = new FakeTaskRepository();
  const settings = over.settings === undefined ? settingsFrom() : over.settings;
  const sms = recordingSendNotification(over.smsMode ?? "ok");

  const deps = buildDeps({ over, bus, ids, leads, jobRepo, tasks, settings, sms });
  return { ctx: { tx: {} as never, orgId: ORG, principal: PRINCIPAL, deps }, leads, jobs, tasks, sms };
};

// LEGACY-lane input: an assistant built from the pre-collapse prompt still calls with "repair".
// The tool normalises it to an estimate-with-fee booking — this fixture is what pins that.
export const REPAIR_INPUT = {
  caller_name: "Jane Doe",
  phone: "(925) 555-0182",
  address: "12 Elm St, Pleasanton",
  service_name: "Leaky faucet",
  lane: "repair" as const,
  problem: "kitchen faucet dripping",
  slot_date: "2026-07-16", // a Thursday (weekday)
  slot_start: "08:00" as const, // an in-hours window start (weekday open in the fixture)
  urgency: "normal" as const,
};

export const onlyJob = (h: Harness): Job => {
  const all = [...h.jobs.jobs.values()];
  expect(all).toHaveLength(1);
  return all[0]!;
};
