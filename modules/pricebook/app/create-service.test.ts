import { describe, it, expect, beforeEach } from "vitest";
import {
  asServiceId,
  asOrgId,
  FixedClock,
  isOk,
  type ServiceId,
  type OrgId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { Service, type ServiceProps } from "../domain/service";
import type { ServiceRepository } from "../domain/service-repository";
import { CreateServiceUseCase, type CreateServiceCommand } from "./create-service";

// ── constants ─────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const FIXED_ID = "11111111-1111-1111-1111-111111111111";
const MINTED_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

// ── helpers ───────────────────────────────────────────────────────────────────

const baseProps = (overrides: Partial<ServiceProps> = {}): ServiceProps => ({
  id: asServiceId(FIXED_ID),
  orgId: ORG,
  categoryId: null,
  code: null,
  name: "Water Heater Install",
  description: null,
  unitPriceCents: 150000,
  costCents: 90000,
  laborHours: null,
  taxable: false,
  warrantyText: null,
  imageUrl: null,
  isAddon: false,
  active: true,
  position: 0,
  measuredBy: null,
  unit: null,
  defaultQuantity: null,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...overrides,
});

const makeService = (overrides: Partial<ServiceProps> = {}): Service => {
  const r = Service.create(baseProps(overrides));
  if (!isOk(r)) throw new Error(`Service.create failed: ${JSON.stringify(r.error)}`);
  return r.value;
};

// ── FakeServiceRepository ─────────────────────────────────────────────────────

class FakeServiceRepository implements ServiceRepository {
  private readonly store = new Map<ServiceId, Service>();
  createCallCount = 0;
  lastCreatedInput: Parameters<ServiceRepository["create"]>[0] | undefined;
  listCallCount = 0;

  seed(service: Service): void {
    this.store.set(service.props.id, service);
  }

  async create(input: Parameters<ServiceRepository["create"]>[0]): Promise<Service> {
    this.createCallCount += 1;
    this.lastCreatedInput = input;
    const service = makeService({
      id: asServiceId(input.id),
      orgId: asOrgId(input.orgId),
      categoryId: input.categoryId,
      code: input.code,
      name: input.name,
      description: input.description,
      unitPriceCents: input.unitPriceCents,
      costCents: input.costCents,
      laborHours: input.laborHours,
      taxable: input.taxable,
      warrantyText: input.warrantyText,
      imageUrl: input.imageUrl,
      isAddon: input.isAddon,
      active: input.active,
      position: input.position,
    });
    this.store.set(service.props.id, service);
    return service;
  }

  async findById(id: ServiceId): Promise<Service | null> {
    return this.store.get(id) ?? null;
  }

  async allNames(): Promise<string[]> {
    return [...this.store.values()].map((s) => s.props.name);
  }

  async list(
    _page: CursorPage,
    filter: { search?: string; categoryId?: string | null },
  ): Promise<Paginated<Service>> {
    this.listCallCount += 1;
    const search = filter.search?.trim().toLowerCase();
    const items = [...this.store.values()].filter((s) =>
      search ? s.props.name.toLowerCase().includes(search) : true,
    );
    return { items, nextCursor: null };
  }

  async save(): Promise<void> {
    throw new Error("save not used in create tests");
  }

  async archiveByLead(): Promise<number> { return 0; }
  async archive(): Promise<number> {
    throw new Error("archive not used in create tests");
  }
}

const fixedIds = (id: string = MINTED_ID) => ({ newId: () => id });

// ── CreateServiceUseCase ──────────────────────────────────────────────────────

describe("CreateServiceUseCase", () => {
  let clock: FixedClock;
  let repo: FakeServiceRepository;
  let useCase: CreateServiceUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    repo = new FakeServiceRepository();
    useCase = new CreateServiceUseCase(repo, clock, fixedIds());
  });

  // ── validation — empty name ───────────────────────────────────────────────

  it("returns a validation error when name is empty string", async () => {
    const cmd: CreateServiceCommand = { name: "", unitPriceCents: 100, costCents: 0 };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") {
      expect(result.error.field).toBe("name");
    }
  });

  it("returns a validation error when name is only whitespace", async () => {
    const cmd: CreateServiceCommand = { name: "   ", unitPriceCents: 100, costCents: 0 };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") {
      expect(result.error.field).toBe("name");
    }
  });

  it("does not call repo.create when name validation fails", async () => {
    const cmd: CreateServiceCommand = { name: "  ", unitPriceCents: 100, costCents: 0 };
    await useCase.exec(cmd, ORG);

    expect(repo.createCallCount).toBe(0);
  });

  // ── dedupe — case-insensitive name conflict ──────────────────────────────

  it("returns a conflict error when a service with the same name (any case) already exists", async () => {
    repo.seed(makeService({ name: "Water Heater Install" }));

    const cmd: CreateServiceCommand = {
      name: "water heater install",
      unitPriceCents: 100,
      costCents: 0,
    };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("conflict");
  });

  it("does not call repo.create when the name is a duplicate", async () => {
    repo.seed(makeService({ name: "Water Heater Install" }));

    const cmd: CreateServiceCommand = {
      name: "WATER HEATER INSTALL",
      unitPriceCents: 100,
      costCents: 0,
    };
    await useCase.exec(cmd, ORG);

    expect(repo.createCallCount).toBe(0);
  });

  it("allows a distinct name to be created", async () => {
    repo.seed(makeService({ name: "Water Heater Install" }));

    const cmd: CreateServiceCommand = {
      name: "Drain Cleaning",
      unitPriceCents: 100,
      costCents: 0,
    };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
  });

  // ── cents clamping ────────────────────────────────────────────────────────

  it("clamps a negative unitPriceCents to 0", async () => {
    const cmd: CreateServiceCommand = { name: "Fresh", unitPriceCents: -500, costCents: 0 };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.unitPriceCents).toBe(0);
  });

  it("clamps a negative costCents to 0", async () => {
    const cmd: CreateServiceCommand = { name: "Fresh", unitPriceCents: 100, costCents: -500 };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.costCents).toBe(0);
  });

  it("rounds fractional cents", async () => {
    const cmd: CreateServiceCommand = { name: "Fresh", unitPriceCents: 100.6, costCents: 50.4 };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.unitPriceCents).toBe(101);
      expect(result.value.props.costCents).toBe(50);
    }
  });

  // ── happy path — id provided by caller ───────────────────────────────────

  it("uses the caller-provided id when present", async () => {
    const cmd: CreateServiceCommand = {
      id: FIXED_ID,
      name: "Fresh Service",
      unitPriceCents: 100,
      costCents: 0,
    };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.id).toBe(FIXED_ID);
  });

  it("mints a new id from IdGenerator when no id is provided", async () => {
    const cmd: CreateServiceCommand = {
      name: "Fresh Service",
      unitPriceCents: 100,
      costCents: 0,
    };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.id).toBe(MINTED_ID);
  });

  // ── defaults for unspecified fields ──────────────────────────────────────

  it("defaults optional fields when the command omits them", async () => {
    const cmd: CreateServiceCommand = { name: "Bare Service", unitPriceCents: 100, costCents: 0 };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.categoryId).toBeNull();
      expect(result.value.props.code).toBeNull();
      expect(result.value.props.description).toBeNull();
      expect(result.value.props.laborHours).toBeNull();
      // TRUE by default, matching the column — an unanswered item is one the shop charges tax on.
      expect(result.value.props.taxable).toBe(true);
      expect(result.value.props.warrantyText).toBeNull();
      expect(result.value.props.imageUrl).toBeNull();
      expect(result.value.props.isAddon).toBe(false);
      expect(result.value.props.active).toBe(true);
      expect(result.value.props.position).toBe(0);
    }
  });

  it("passes provided optional fields through to repo.create", async () => {
    const cmd: CreateServiceCommand = {
      name: "Full Service",
      categoryId: "33333333-3333-3333-3333-333333333333",
      code: "WH-1",
      description: "Standard install",
      unitPriceCents: 100,
      costCents: 0,
      laborHours: 2.5,
      taxable: true,
      warrantyText: "1 year",
      imageUrl: "https://example.com/x.jpg",
      isAddon: true,
      active: false,
      position: 3,
    };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.categoryId).toBe("33333333-3333-3333-3333-333333333333");
      expect(result.value.props.code).toBe("WH-1");
      expect(result.value.props.description).toBe("Standard install");
      expect(result.value.props.laborHours).toBe(2.5);
      expect(result.value.props.taxable).toBe(true);
      expect(result.value.props.warrantyText).toBe("1 year");
      expect(result.value.props.imageUrl).toBe("https://example.com/x.jpg");
      expect(result.value.props.isAddon).toBe(true);
      expect(result.value.props.active).toBe(false);
      expect(result.value.props.position).toBe(3);
    }
  });

  it("trims whitespace from the name before creating", async () => {
    const cmd: CreateServiceCommand = {
      name: "  Trimmed Service  ",
      unitPriceCents: 100,
      costCents: 0,
    };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.name).toBe("Trimmed Service");
  });

  it("passes the orgId to repo.create", async () => {
    const cmd: CreateServiceCommand = { name: "Org Check", unitPriceCents: 100, costCents: 0 };
    await useCase.exec(cmd, ORG);

    expect(repo.lastCreatedInput?.orgId).toBe(ORG);
  });
});
