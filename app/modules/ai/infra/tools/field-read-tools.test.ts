// Unit tests for the field copilot read-only tool registry.
//
// These tests stay in-process with no live DB — all repo calls are faked via
// the FieldToolDeps.withTx closure. The key assertions are REDACTION: no cost
// anywhere, no rate/total when !seesPrice, no ballpark/price/serviceFee ever.
//
// The registry emits NO found-work marker — change orders replaced it.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { asOrgId, asJobId, asUserId } from "@mallet/shared/types";
import type { FieldToolScope, FieldToolDeps } from "./field-read-tools";
import { buildFieldTools, buildOrgOnlyFieldTools } from "./field-read-tools";

// ---------------------------------------------------------------------------
// Mocks — must be declared before any imports that pull the mocked modules
// ---------------------------------------------------------------------------

vi.mock("@mallet/jobs", () => ({
  DrizzleJobRepository: vi.fn(),
  toJobSummaryDTO: vi.fn(),
}));

vi.mock("@mallet/settings", () => ({
  DrizzleSettingsRepository: vi.fn(),
}));

vi.mock("../../../customers/infra/drizzle-lead-repository", () => ({
  DrizzleLeadRepository: vi.fn(),
}));

vi.mock("../../../jobs/app/list-jobs", () => ({
  ListJobsUseCase: vi.fn(),
}));

// money-redaction is a pure module — import the real thing
// (No mock needed; it has no DB deps)

import { DrizzleJobRepository } from "@mallet/jobs";
import { DrizzleSettingsRepository } from "@mallet/settings";
import { DrizzleLeadRepository } from "../../../customers/infra/drizzle-lead-repository";
import { ListJobsUseCase } from "../../../jobs/app/list-jobs";
// toJobSummaryDTO is mocked above; we control its output in each test
import { toJobSummaryDTO } from "@mallet/jobs";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const orgId = asOrgId(randomUUID());
const jobId = asJobId(randomUUID());
const userId = asUserId(randomUUID());
// get_my_day reads the CALLER's today — pinned so the assertions cannot drift with the clock.
const today = "2026-08-14";

const usd = (cents: number) => ({ cents, currency: "USD" as const });

/** Make a minimal fake job domain object with the given props shape. */
const makeJob = (overrides: {
  callbackOf?: string | null;
  callbackReason?: string | null;
  checklist?: { name: string; items: Array<{ id: string; text: string; type: "check" | "photo"; required: boolean }> } | null;
} = {}) => ({
  props: {
    id: jobId,
    num: "JOB-1",
    leadId: randomUUID(),
    sourceEstimateId: null,
    title: "Water heater replacement",
    svc: "plumbing",
    kind: "repair" as const,
    status: "in_progress" as const,
    assigneeUserId: randomUUID(),
    scheduledStart: new Date("2026-07-17T09:00:00Z"),
    scheduledEnd: null,
    startedAt: null,
    completedAt: null,
    canceledAt: null,
    cancelReason: null,
    total: 45000,
    notes: "Customer says it stopped working last night",
    scope: "Replace 40gal gas water heater",
    callbackOf: overrides.callbackOf ?? null,
    callbackReason: overrides.callbackReason ?? null,
    checklist: overrides.checklist ?? null,
    requiredCerts: ["Gas"],
    visits: [],
    createdAt: new Date("2026-07-15"),
  },
});

/** Fake execution data with full price info. */
const makeExecution = () => ({
  lines: [
    {
      props: {
        id: randomUUID(),
        description: "Water heater unit",
        quantity: 1,
        rate: 38000,
        cost: 22000,
        position: 0,
      },
    },
  ],
  addons: [
    {
      props: {
        id: randomUUID(),
        description: "Expansion tank",
        quantity: 1,
        rate: 7000,
        cost: 3500,
        isOptional: false,
        invoiceSkip: false,
        status: "proposed" as const,
        position: 0,
      },
    },
  ],
  verifyAnswers: [],
  photos: [
    {
      props: {
        id: randomUUID(),
        storagePath: "org/photos/photo1.jpg",
        caption: "Before photo",
        verifyPass: false,
        position: 0,
      },
    },
  ],
});

/** Make a fake dto that toJobSummaryDTO would produce (with real money values). */
const makeSummaryDto = () => ({
  id: jobId,
  num: "JOB-1",
  leadId: randomUUID(),
  sourceEstimateId: null,
  title: "Water heater replacement",
  svc: "plumbing",
  kind: "repair",
  status: "in_progress",
  assigneeUserId: randomUUID(),
  scheduledStart: "2026-07-17T09:00:00.000Z",
  total: usd(45000),
  notes: "Customer says it stopped working last night",
  scope: "Replace 40gal gas water heater",
  callbackOf: null,
  callbackReason: null,
  checklist: null,
  requiredCerts: ["Gas"],
  visits: [],
  createdAt: "2026-07-15T00:00:00.000Z",
  lines: [
    { id: randomUUID(), description: "Water heater unit", quantity: 1, rate: usd(38000), cost: usd(22000), position: 0 },
  ],
  addons: [
    { id: randomUUID(), description: "Expansion tank", quantity: 1, rate: usd(7000), cost: usd(3500), isOptional: false, invoiceSkip: false, status: "proposed" as const, position: 0 },
  ],
  verifyAnswers: [],
  photos: [
    { id: randomUUID(), storagePath: "org/photos/photo1.jpg", caption: "Before photo", verifyPass: false, position: 0 },
  ],
});

/** Build a fake FieldToolDeps where withTx immediately runs fn with a fake tx. */
const makeDeps = (): FieldToolDeps => ({
  withTx: (_orgId, fn) =>
    fn({} as Parameters<FieldToolDeps["withTx"]>[1] extends (tx: infer TX) => unknown ? TX : never),
});

/** Build scope for a tech who cannot see prices. */
const makeScope = (seesPrice: boolean): FieldToolScope => ({ orgId, jobId, seesPrice, userId, today });

function mockClass<T extends abstract new (...a: never[]) => unknown>(
  ctor: T,
  instance: Partial<InstanceType<T>>,
): void {
  vi.mocked(ctor as unknown as new (...a: never[]) => unknown).mockImplementation(function () {
    return instance;
  });
}

// ---------------------------------------------------------------------------
// buildFieldTools — registry shape
// ---------------------------------------------------------------------------

describe("buildFieldTools — registry shape", () => {
  it("returns exactly 4 tools", () => {
    const tools = buildFieldTools(makeDeps())(makeScope(true));
    expect(tools).toHaveLength(4);
  });

  it("every tool is mutating: false", () => {
    const tools = buildFieldTools(makeDeps())(makeScope(true));
    for (const tool of tools) {
      expect(tool.meta.mutating, `${tool.meta.name} should not be mutating`).toBe(false);
    }
  });

  it("tool names are correct", () => {
    const tools = buildFieldTools(makeDeps())(makeScope(true));
    const names = tools.map((t) => t.meta.name);
    expect(names).toContain("get_my_job");
    expect(names).toContain("get_my_day");
    expect(names).toContain("get_org_service_context");
    expect(names).toContain("get_callback_history");
  });

  it("no input schema has jobId or orgId (closure-scoped, model cannot inject)", () => {
    const tools = buildFieldTools(makeDeps())(makeScope(true));
    for (const tool of tools) {
      const schema = tool.meta.inputSchema as { properties?: Record<string, unknown> };
      expect(schema.properties?.jobId, `${tool.meta.name} must not expose jobId`).toBeUndefined();
      expect(schema.properties?.orgId, `${tool.meta.name} must not expose orgId`).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// get_my_job — redaction assertions
// ---------------------------------------------------------------------------

describe("get_my_job", () => {
  const toolOf = (seesPrice: boolean) => {
    const tools = buildFieldTools(makeDeps())(makeScope(seesPrice));
    const tool = tools.find((t) => t.meta.name === "get_my_job");
    if (!tool) throw new Error("get_my_job not found");
    return tool;
  };

  beforeEach(() => {
    vi.mocked(DrizzleJobRepository).mockClear();
    vi.mocked(toJobSummaryDTO).mockClear();
  });

  it("returns ok with JSON summary (happy path, seesPrice=true)", async () => {
    const dto = makeSummaryDto();
    vi.mocked(toJobSummaryDTO).mockReturnValue(dto as unknown as ReturnType<typeof toJobSummaryDTO>);
    mockClass(DrizzleJobRepository, {
      findById: vi.fn().mockResolvedValue(makeJob()),
      listExecution: vi.fn().mockResolvedValue(makeExecution()),
    });

    const tool = toolOf(true);
    const result = await tool.execute({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.summary) as Record<string, unknown>;
      expect(parsed).toBeTruthy();
    }
  });

  it("cost is NEVER present when seesPrice=true", async () => {
    const dto = makeSummaryDto();
    vi.mocked(toJobSummaryDTO).mockReturnValue(dto as unknown as ReturnType<typeof toJobSummaryDTO>);
    mockClass(DrizzleJobRepository, {
      findById: vi.fn().mockResolvedValue(makeJob()),
      listExecution: vi.fn().mockResolvedValue(makeExecution()),
    });

    const tool = toolOf(true);
    const result = await tool.execute({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.summary) as Record<string, unknown>;
      const lines = parsed.lines as Array<Record<string, unknown>>;
      const addons = parsed.addons as Array<Record<string, unknown>>;
      for (const line of lines ?? []) {
        expect(line.cost, "cost must be null on lines even when seesPrice=true").toBeNull();
      }
      for (const addon of addons ?? []) {
        expect(addon.cost, "cost must be null on addons even when seesPrice=true").toBeNull();
      }
    }
  });

  it("rate IS present when seesPrice=true", async () => {
    const dto = makeSummaryDto();
    vi.mocked(toJobSummaryDTO).mockReturnValue(dto as unknown as ReturnType<typeof toJobSummaryDTO>);
    mockClass(DrizzleJobRepository, {
      findById: vi.fn().mockResolvedValue(makeJob()),
      listExecution: vi.fn().mockResolvedValue(makeExecution()),
    });

    const tool = toolOf(true);
    const result = await tool.execute({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.summary) as Record<string, unknown>;
      const lines = parsed.lines as Array<Record<string, unknown>>;
      expect(lines?.[0]?.rate).not.toBeNull();
    }
  });

  it("rate is NULL when seesPrice=false (redaction)", async () => {
    const dto = makeSummaryDto();
    vi.mocked(toJobSummaryDTO).mockReturnValue(dto as unknown as ReturnType<typeof toJobSummaryDTO>);
    mockClass(DrizzleJobRepository, {
      findById: vi.fn().mockResolvedValue(makeJob()),
      listExecution: vi.fn().mockResolvedValue(makeExecution()),
    });

    const tool = toolOf(false);
    const result = await tool.execute({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.summary) as Record<string, unknown>;
      const lines = parsed.lines as Array<Record<string, unknown>>;
      const addons = parsed.addons as Array<Record<string, unknown>>;
      for (const line of lines ?? []) {
        expect(line.rate, "rate must be null when !seesPrice").toBeNull();
      }
      for (const addon of addons ?? []) {
        expect(addon.rate, "rate must be null when !seesPrice").toBeNull();
      }
    }
  });

  it("total is NEVER in the output (even when seesPrice=true)", async () => {
    const dto = makeSummaryDto();
    vi.mocked(toJobSummaryDTO).mockReturnValue(dto as unknown as ReturnType<typeof toJobSummaryDTO>);
    mockClass(DrizzleJobRepository, {
      findById: vi.fn().mockResolvedValue(makeJob()),
      listExecution: vi.fn().mockResolvedValue(makeExecution()),
    });

    // seesPrice=true — but total must still be absent
    const tool = toolOf(true);
    const result = await tool.execute({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.summary) as Record<string, unknown>;
      expect("total" in parsed, "total must not be present in get_my_job output").toBe(false);
    }
  });

  it("storagePaths are stripped from photos output", async () => {
    const dto = makeSummaryDto();
    vi.mocked(toJobSummaryDTO).mockReturnValue(dto as unknown as ReturnType<typeof toJobSummaryDTO>);
    mockClass(DrizzleJobRepository, {
      findById: vi.fn().mockResolvedValue(makeJob()),
      listExecution: vi.fn().mockResolvedValue(makeExecution()),
    });

    const tool = toolOf(true);
    const result = await tool.execute({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.summary) as Record<string, unknown>;
      const photos = parsed.photos as Array<Record<string, unknown>>;
      for (const photo of photos ?? []) {
        expect("storagePath" in photo, "storagePath must not appear in photo output").toBe(false);
      }
    }
  });

  it("returns not-found error when job does not exist", async () => {
    mockClass(DrizzleJobRepository, {
      findById: vi.fn().mockResolvedValue(null),
      listExecution: vi.fn().mockResolvedValue(makeExecution()),
    });

    const tool = toolOf(true);
    const result = await tool.execute({});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("not found");
    }
  });

  it("requiredCerts are included in the output", async () => {
    const dto = { ...makeSummaryDto(), requiredCerts: ["Gas", "Master Plumber"] };
    vi.mocked(toJobSummaryDTO).mockReturnValue(dto as unknown as ReturnType<typeof toJobSummaryDTO>);
    mockClass(DrizzleJobRepository, {
      findById: vi.fn().mockResolvedValue(makeJob()),
      listExecution: vi.fn().mockResolvedValue(makeExecution()),
    });

    const tool = toolOf(true);
    const result = await tool.execute({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.summary) as Record<string, unknown>;
      expect(parsed.requiredCerts).toEqual(["Gas", "Master Plumber"]);
    }
  });
});

// ---------------------------------------------------------------------------
// get_org_service_context — NO price, NO ballpark, NO serviceFee
// ---------------------------------------------------------------------------

describe("get_org_service_context", () => {
  const toolOf = (seesPrice: boolean) => {
    const tools = buildFieldTools(makeDeps())(makeScope(seesPrice));
    const tool = tools.find((t) => t.meta.name === "get_org_service_context");
    if (!tool) throw new Error("get_org_service_context not found");
    return tool;
  };

  beforeEach(() => {
    vi.mocked(DrizzleSettingsRepository).mockClear();
  });

  const makeSettingsWithServices = () => ({
    props: {
      booking: {
        services: [
          {
            name: "Water Heater Replacement",
            lane: "repair" as const,
            triggers: "no hot water, water heater broken",
            emergencyTriggers: "flooding",
            ballpark: "$1,500–$3,000",
            price: 200,
            requiredCerts: ["Gas"],
          },
          {
            name: "Drain Cleaning",
            lane: "flat" as const,
            triggers: "slow drain, blocked drain",
            // no emergencyTriggers, no requiredCerts, no ballpark
          },
        ],
        notServices: "HVAC, roofing",
        serviceFee: 89,
        feeCredited: true,
      },
    },
  });

  it("returns service names and triggers", async () => {
    mockClass(DrizzleSettingsRepository, {
      getConfig: vi.fn().mockResolvedValue(makeSettingsWithServices()),
    });

    const tool = toolOf(false);
    const result = await tool.execute({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.summary) as { services: Array<Record<string, unknown>> };
      expect(parsed.services?.[0]?.name).toBe("Water Heater Replacement");
      expect(parsed.services?.[0]?.lane).toBe("repair");
      expect(parsed.services?.[0]?.triggers).toContain("water heater");
      expect(parsed.services?.[0]?.emergencyTriggers).toBe("flooding");
      expect(parsed.services?.[0]?.requiredCerts).toEqual(["Gas"]);
    }
  });

  it("ballpark is NEVER in service context output (regardless of seesPrice)", async () => {
    mockClass(DrizzleSettingsRepository, {
      getConfig: vi.fn().mockResolvedValue(makeSettingsWithServices()),
    });

    for (const seesPrice of [true, false]) {
      const tool = toolOf(seesPrice);
      const result = await tool.execute({});
      expect(result.ok).toBe(true);
      if (result.ok) {
        const raw = result.summary;
        // ballpark value must not appear in the output
        expect(raw, `ballpark must not appear when seesPrice=${seesPrice}`).not.toContain("$1,500");
        expect(raw, `ballpark must not appear when seesPrice=${seesPrice}`).not.toContain("$3,000");
        expect(raw, `ballpark key must not appear when seesPrice=${seesPrice}`).not.toContain('"ballpark"');
      }
    }
  });

  it("price is NEVER in service context output", async () => {
    mockClass(DrizzleSettingsRepository, {
      getConfig: vi.fn().mockResolvedValue(makeSettingsWithServices()),
    });

    for (const seesPrice of [true, false]) {
      const tool = toolOf(seesPrice);
      const result = await tool.execute({});
      expect(result.ok).toBe(true);
      if (result.ok) {
        const parsed = JSON.parse(result.summary) as { services: Array<Record<string, unknown>> };
        for (const svc of parsed.services ?? []) {
          expect("price" in svc, `price must not appear in service when seesPrice=${seesPrice}`).toBe(false);
        }
      }
    }
  });

  it("serviceFee is NEVER in service context output", async () => {
    mockClass(DrizzleSettingsRepository, {
      getConfig: vi.fn().mockResolvedValue(makeSettingsWithServices()),
    });

    for (const seesPrice of [true, false]) {
      const tool = toolOf(seesPrice);
      const result = await tool.execute({});
      expect(result.ok).toBe(true);
      if (result.ok) {
        const raw = result.summary;
        expect(raw, `serviceFee must not appear when seesPrice=${seesPrice}`).not.toContain('"serviceFee"');
        expect(raw, `serviceFee value must not appear when seesPrice=${seesPrice}`).not.toContain('"89"');
      }
    }
  });

  it("returns 'No services configured' when the org has no services", async () => {
    mockClass(DrizzleSettingsRepository, {
      getConfig: vi.fn().mockResolvedValue({
        props: { booking: { services: [], notServices: "", serviceFee: 89, feeCredited: true } },
      }),
    });

    const tool = toolOf(false);
    const result = await tool.execute({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("No services configured");
    }
  });

  it("services without emergencyTriggers or requiredCerts omit those keys", async () => {
    mockClass(DrizzleSettingsRepository, {
      getConfig: vi.fn().mockResolvedValue(makeSettingsWithServices()),
    });

    const tool = toolOf(false);
    const result = await tool.execute({});
    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.summary) as { services: Array<Record<string, unknown>> };
      const drainService = parsed.services?.find((s) => s.name === "Drain Cleaning");
      expect(drainService).toBeDefined();
      expect("emergencyTriggers" in (drainService ?? {})).toBe(false);
      expect("requiredCerts" in (drainService ?? {})).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// get_callback_history — redaction + miss detection
// ---------------------------------------------------------------------------

describe("get_callback_history", () => {
  const toolOf = (seesPrice: boolean, customJobId?: ReturnType<typeof asJobId>) => {
    const scope: FieldToolScope = {
      orgId,
      jobId: customJobId ?? jobId,
      seesPrice,
      userId,
      today,
    };
    const tools = buildFieldTools(makeDeps())(scope);
    const tool = tools.find((t) => t.meta.name === "get_callback_history");
    if (!tool) throw new Error("get_callback_history not found");
    return tool;
  };

  beforeEach(() => {
    vi.mocked(DrizzleJobRepository).mockClear();
    vi.mocked(toJobSummaryDTO).mockClear();
  });

  it("returns 'not a callback' when callbackOf is null", async () => {
    mockClass(DrizzleJobRepository, {
      findById: vi.fn().mockResolvedValue(makeJob({ callbackOf: null })),
      listExecution: vi.fn().mockResolvedValue(makeExecution()),
    });

    const tool = toolOf(false);
    const result = await tool.execute({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.summary).toContain("not a callback");
    }
  });

  it("returns original job context when this is a callback", async () => {
    const originalJobId = randomUUID();
    const originalJob = makeJob({ callbackOf: null });
    const callbackJob = makeJob({ callbackOf: originalJobId, callbackReason: "parts_failure" });

    const originalDto = { ...makeSummaryDto(), id: originalJobId, callbackOf: null };

    vi.mocked(toJobSummaryDTO).mockReturnValue(originalDto as unknown as ReturnType<typeof toJobSummaryDTO>);
    mockClass(DrizzleJobRepository, {
      findById: vi.fn().mockImplementation((id: string) => {
        if (id === jobId) return Promise.resolve(callbackJob);
        if (id === originalJobId) return Promise.resolve(originalJob);
        return Promise.resolve(null);
      }),
      listExecution: vi.fn().mockResolvedValue(makeExecution()),
    });

    const tool = toolOf(false);
    const result = await tool.execute({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.summary) as Record<string, unknown>;
      expect(parsed.callbackReason).toBe("parts_failure");
      expect(parsed.originalJob).toBeDefined();
    }
  });

  it("no cost in originalJob output (redaction applies to callback original too)", async () => {
    const originalJobId = randomUUID();
    const originalDto = makeSummaryDto();
    vi.mocked(toJobSummaryDTO).mockReturnValue(originalDto as unknown as ReturnType<typeof toJobSummaryDTO>);
    mockClass(DrizzleJobRepository, {
      findById: vi.fn().mockImplementation((id: string) => {
        if (id === jobId) return Promise.resolve(makeJob({ callbackOf: originalJobId }));
        return Promise.resolve(makeJob({ callbackOf: null }));
      }),
      listExecution: vi.fn().mockResolvedValue(makeExecution()),
    });

    const tool = toolOf(false);
    const result = await tool.execute({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.summary) as { originalJob?: Record<string, unknown> };
      const lines = (parsed.originalJob?.lines ?? []) as Array<Record<string, unknown>>;
      for (const line of lines) {
        expect(line.cost, "cost must be null in originalJob output").toBeNull();
      }
    }
  });

  it("includes missedStepsOnOriginal when the original had a checklist with unanswered items", async () => {
    const originalJobId = randomUUID();
    const checklistItemId = randomUUID();
    const checklist = {
      name: "Water Heater Checklist",
      items: [
        { id: checklistItemId, text: "Check anode rod", type: "check" as const, required: true },
        { id: randomUUID(), text: "Test pressure relief valve", type: "check" as const, required: true },
      ],
    };

    const originalJobWithChecklist = makeJob({ callbackOf: null, checklist });
    const callbackJobObj = makeJob({ callbackOf: originalJobId, callbackReason: "incomplete_fix" });
    const originalDto = makeSummaryDto();

    vi.mocked(toJobSummaryDTO).mockReturnValue(originalDto as unknown as ReturnType<typeof toJobSummaryDTO>);

    // Original had one verified "pass" for checklistItemId, but NOT the pressure relief item
    const executionWithAnswer = {
      ...makeExecution(),
      verifyAnswers: [
        { props: { jobId: asJobId(originalJobId), itemId: checklistItemId, state: "pass" as const, via: null, reason: null } },
      ],
    };

    mockClass(DrizzleJobRepository, {
      findById: vi.fn().mockImplementation((id: string) => {
        if (id === jobId) return Promise.resolve(callbackJobObj);
        return Promise.resolve(originalJobWithChecklist);
      }),
      listExecution: vi.fn().mockResolvedValue(executionWithAnswer),
    });

    const tool = toolOf(false);
    const result = await tool.execute({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.summary) as { missedStepsOnOriginal?: string[] };
      expect(parsed.missedStepsOnOriginal).toBeDefined();
      expect(parsed.missedStepsOnOriginal).toContain("Test pressure relief valve");
      expect(parsed.missedStepsOnOriginal).not.toContain("Check anode rod");
    }
  });

  it("missedStepsOnOriginal is empty array when all items were passed", async () => {
    const originalJobId = randomUUID();
    const itemId1 = randomUUID();
    const itemId2 = randomUUID();
    const checklist = {
      name: "Basic Checklist",
      items: [
        { id: itemId1, text: "Step A", type: "check" as const, required: true },
        { id: itemId2, text: "Step B", type: "check" as const, required: false },
      ],
    };

    const originalJobWithChecklist = makeJob({ callbackOf: null, checklist });
    const callbackJobObj = makeJob({ callbackOf: originalJobId });
    const originalDto = makeSummaryDto();
    vi.mocked(toJobSummaryDTO).mockReturnValue(originalDto as unknown as ReturnType<typeof toJobSummaryDTO>);

    const executionAllPassed = {
      ...makeExecution(),
      verifyAnswers: [
        { props: { jobId: asJobId(originalJobId), itemId: itemId1, state: "pass" as const, via: null, reason: null } },
        { props: { jobId: asJobId(originalJobId), itemId: itemId2, state: "pass" as const, via: null, reason: null } },
      ],
    };

    mockClass(DrizzleJobRepository, {
      findById: vi.fn().mockImplementation((id: string) => {
        if (id === jobId) return Promise.resolve(callbackJobObj);
        return Promise.resolve(originalJobWithChecklist);
      }),
      listExecution: vi.fn().mockResolvedValue(executionAllPassed),
    });

    const tool = toolOf(false);
    const result = await tool.execute({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.summary) as { missedStepsOnOriginal?: string[] };
      expect(parsed.missedStepsOnOriginal).toEqual([]);
    }
  });

  it("no total in originalJob output", async () => {
    const originalJobId = randomUUID();
    const originalDto = makeSummaryDto();
    vi.mocked(toJobSummaryDTO).mockReturnValue(originalDto as unknown as ReturnType<typeof toJobSummaryDTO>);
    mockClass(DrizzleJobRepository, {
      findById: vi.fn().mockImplementation((id: string) => {
        if (id === jobId) return Promise.resolve(makeJob({ callbackOf: originalJobId }));
        return Promise.resolve(makeJob({ callbackOf: null }));
      }),
      listExecution: vi.fn().mockResolvedValue(makeExecution()),
    });

    const tool = toolOf(true);
    const result = await tool.execute({});

    expect(result.ok).toBe(true);
    if (result.ok) {
      const parsed = JSON.parse(result.summary) as { originalJob?: Record<string, unknown> };
      expect("total" in (parsed.originalJob ?? {}), "total must not be in originalJob context").toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// get_my_day — the caller's own route
// ---------------------------------------------------------------------------

describe("get_my_day", () => {
  const toolOf = (seesPrice = true) =>
    buildFieldTools(makeDeps())(makeScope(seesPrice)).find((t) => t.meta.name === "get_my_day")!;

  /** A job the ListJobsUseCase page can carry. Only the two ids the tool reads are real. */
  const jobRow = (leadId: string, id = randomUUID()) => ({ props: { id, leadId } });

  const wire = (rows: ReturnType<typeof jobRow>[], dto: Record<string, unknown>) => {
    mockClass(ListJobsUseCase, { exec: vi.fn().mockResolvedValue({ items: rows }) });
    mockClass(DrizzleJobRepository, {
      listExecutionForJobs: vi.fn().mockResolvedValue(new Map()),
    });
    mockClass(DrizzleLeadRepository, {
      findByIds: vi.fn().mockResolvedValue([{ props: { id: "lead-1", name: "Dana Whitfield" } }]),
    });
    vi.mocked(toJobSummaryDTO).mockReturnValue(dto as ReturnType<typeof toJobSummaryDTO>);
  };

  const fullDto = {
    num: "JOB-1007",
    title: "Water heater swap",
    customerName: null,
    addr: "12 Alder St",
    status: "scheduled",
    total: { cents: 84_500, currency: "USD" },
    visits: [
      { status: "canceled", scheduledStart: "07:00", durationMinutes: 30 },
      { status: "scheduled", scheduledStart: "09:30", durationMinutes: 90 },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scopes the read to the CALLER and the named day, and drops canceled work", async () => {
    wire([jobRow("lead-1")], fullDto);
    const result = await toolOf().execute({});
    expect(result.ok).toBe(true);

    const exec = vi.mocked(ListJobsUseCase).mock.results[0]?.value.exec;
    expect(exec).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: { assignedUserId: userId, visitFrom: today, visitTo: today, excludeCanceled: true },
      }),
    );
  });

  it("reads the first LIVE visit's clock, never the canceled one above it", async () => {
    wire([jobRow("lead-1")], fullDto);
    const result = await toolOf().execute({});
    const stop = JSON.parse((result as { summary: string }).summary).stops[0];
    expect(stop.scheduledStart).toBe("09:30");
    expect(stop.durationMinutes).toBe(90);
  });

  // The name is resolved from the batched lead read and handed to the DTO builder — asserted on
  // the call, because the builder is mocked here and would otherwise swallow the wiring.
  it("resolves the customer name from the batched lead read", async () => {
    wire([jobRow("lead-1")], fullDto);
    await toolOf().execute({});
    expect(vi.mocked(toJobSummaryDTO)).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      "Dana Whitfield",
    );
  });

  it("withholds the total when the tech cannot see prices", async () => {
    wire([jobRow("lead-1")], fullDto);
    const shown = JSON.parse((await toolOf(true).execute({}) as { summary: string }).summary);
    expect(shown.stops[0]).toHaveProperty("total");

    wire([jobRow("lead-1")], fullDto);
    const hidden = JSON.parse((await toolOf(false).execute({}) as { summary: string }).summary);
    expect(hidden.stops[0]).not.toHaveProperty("total");
  });

  it("says so plainly when the day is empty", async () => {
    wire([], fullDto);
    const result = await toolOf().execute({});
    expect((result as { summary: string }).summary).toContain("No stops scheduled");
    expect((result as { summary: string }).summary).toContain("today");
  });

  it("reads another day when the model names one", async () => {
    wire([jobRow("lead-1")], fullDto);
    await toolOf().execute({ date: "2026-08-15" });
    const exec = vi.mocked(ListJobsUseCase).mock.results[0]?.value.exec;
    expect(exec).toHaveBeenCalledWith(
      expect.objectContaining({ filter: expect.objectContaining({ visitFrom: "2026-08-15" }) }),
    );
  });

  // A model-supplied date is client input. Out of reach it must be refused, not turned into a
  // scan of the shop's whole history.
  it("refuses a date far outside the caller's own reach, without touching the DB", async () => {
    wire([jobRow("lead-1")], fullDto);
    const result = await toolOf().execute({ date: "2019-01-01" });
    expect(result.ok).toBe(false);
    expect(vi.mocked(ListJobsUseCase)).not.toHaveBeenCalled();
  });

  it("refuses an impossible-but-well-formed date rather than rolling it over", async () => {
    wire([jobRow("lead-1")], fullDto);
    // The Date constructor turns 2026-02-30 into March 2 — a round-trip check catches it.
    const result = await toolOf().execute({ date: "2026-02-30" });
    expect(result.ok).toBe(false);
  });

  it("exposes only `date` to the model — never a user or org id", () => {
    const schema = toolOf().meta.inputSchema as { properties?: Record<string, unknown> };
    expect(Object.keys(schema.properties ?? {})).toEqual(["date"]);
  });
});

// ---------------------------------------------------------------------------
// buildOrgOnlyFieldTools — the Ask tab's general chat
// ---------------------------------------------------------------------------

describe("buildOrgOnlyFieldTools", () => {
  const noJobScope = { orgId, seesPrice: true, userId, today };

  it("keeps the two tools that are not job-scoped", () => {
    const names = buildOrgOnlyFieldTools(makeDeps())(noJobScope).map((t) => t.meta.name);
    expect(names).toEqual(["get_my_day", "get_org_service_context"]);
  });

  /** Both close over a verified jobId; there is none, and a placeholder would read the wrong job. */
  it("withholds every job-scoped tool", () => {
    const names = buildOrgOnlyFieldTools(makeDeps())(noJobScope).map((t) => t.meta.name);
    expect(names).not.toContain("get_my_job");
    expect(names).not.toContain("get_callback_history");
  });

  // The regression Owen hit: asking "what have I got today" on the Ask tab answered that it had
  // no access to anything, because the agenda tool was not in the jobless registry.
  it("can answer the schedule question the tab exists for", () => {
    const tools = buildOrgOnlyFieldTools(makeDeps())(noJobScope);
    expect(tools.find((t) => t.meta.name === "get_my_day")).toBeDefined();
  });
});
