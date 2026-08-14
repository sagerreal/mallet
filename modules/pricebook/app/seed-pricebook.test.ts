import { describe, it, expect, beforeEach } from "vitest";
import {
  asServiceId,
  asCategoryId,
  asMaterialId,
  asOrgId,
  FixedClock,
  isOk,
  type ServiceId,
  type CategoryId,
  type OrgId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { Material } from "../domain/material";
import { Service, type ServiceProps } from "../domain/service";
import { Category, type CategoryProps } from "../domain/category";
import type { ServiceRepository } from "../domain/service-repository";
import type { CategoryRepository } from "../domain/category-repository";
import { SeedPricebookUseCase, type SeedPricebookInput } from "./seed-pricebook";

// ── constants ─────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
let nextMintedId = 0;

// ── helpers ───────────────────────────────────────────────────────────────────

const baseServiceProps = (overrides: Partial<ServiceProps> = {}): ServiceProps => ({
  id: asServiceId("11111111-1111-1111-1111-111111111111"),
  orgId: ORG,
  categoryId: null,
  code: null,
  name: "Fixture Service",
  description: null,
  unitPriceCents: 10000,
  costCents: 4000,
  laborHours: null,
  taxable: false,
  warrantyText: null,
  imageUrl: null,
  isAddon: false,
  active: true,
  position: 0,
  measuredBy: null,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...overrides,
});

const makeService = (overrides: Partial<ServiceProps> = {}): Service => {
  const r = Service.create(baseServiceProps(overrides));
  if (!isOk(r)) throw new Error(`Service.create failed: ${JSON.stringify(r.error)}`);
  return r.value;
};

const baseCategoryProps = (overrides: Partial<CategoryProps> = {}): CategoryProps => ({
  id: asCategoryId("33333333-3333-3333-3333-333333333333"),
  orgId: ORG,
  parentId: null,
  name: "Fixture Category",
  sortOrder: 0,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...overrides,
});

const makeCategory = (overrides: Partial<CategoryProps> = {}): Category => {
  const r = Category.create(baseCategoryProps(overrides));
  if (!isOk(r)) throw new Error(`Category.create failed: ${JSON.stringify(r.error)}`);
  return r.value;
};

// ── FakeServiceRepository ─────────────────────────────────────────────────────

class FakeServiceRepository implements ServiceRepository {
  readonly store = new Map<ServiceId, Service>();
  createCallCount = 0;

  async create(input: Parameters<ServiceRepository["create"]>[0]): Promise<Service> {
    this.createCallCount += 1;
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
    page: CursorPage,
    filter: { search?: string; categoryId?: string | null },
  ): Promise<Paginated<Service>> {
    const search = filter.search?.trim().toLowerCase();
    const items = [...this.store.values()].filter((s) =>
      search ? s.props.name.toLowerCase().includes(search) : true,
    );
    // Mirror the real repo's bounded behavior: never return more than `limit` rows.
    return { items: items.slice(0, page.limit), nextCursor: null };
  }

  async save(): Promise<void> {
    throw new Error("save not used in seed tests");
  }

  async archiveByLead(): Promise<number> { return 0; }
  async archive(): Promise<number> {
    throw new Error("archive not used in seed tests");
  }
}

// ── FakeCategoryRepository ────────────────────────────────────────────────────

class FakeCategoryRepository implements CategoryRepository {
  readonly store = new Map<CategoryId, Category>();
  createCallCount = 0;

  async create(input: Parameters<CategoryRepository["create"]>[0]): Promise<Category> {
    this.createCallCount += 1;
    const category = makeCategory({
      id: asCategoryId(input.id),
      orgId: asOrgId(input.orgId),
      parentId: input.parentId,
      name: input.name,
      sortOrder: input.sortOrder,
    });
    this.store.set(category.props.id, category);
    return category;
  }

  async list(): Promise<Category[]> {
    return [...this.store.values()];
  }

  async save(): Promise<void> {
    throw new Error("save not used in seed tests");
  }

  async archive(): Promise<number> {
    throw new Error("archive not used in seed tests");
  }
}

const fixedIds = () => ({
  newId: () => {
    nextMintedId += 1;
    return `minted-${nextMintedId}`;
  },
});

const SEED_INPUT: SeedPricebookInput = {
  categories: [{ name: "Water Heaters" }, { name: "Drains" }],
  services: [
    {
      name: "Replace water heater",
      categoryName: "Water Heaters",
      unitPriceCents: 240000,
      costCents: 118000,
    },
    {
      name: "Drain cleaning",
      categoryName: "Drains",
      unitPriceCents: 22500,
      costCents: 4000,
    },
    {
      name: "Toilet reset",
      categoryName: "Water Heaters",
      unitPriceCents: 22000,
      costCents: 4000,
    },
  ],
};

// ── SeedPricebookUseCase ──────────────────────────────────────────────────────

describe("SeedPricebookUseCase", () => {
  let clock: FixedClock;
  let serviceRepo: FakeServiceRepository;
  let categoryRepo: FakeCategoryRepository;
  let useCase: SeedPricebookUseCase;

  beforeEach(() => {
    nextMintedId = 0;
    clock = new FixedClock(new Date("2026-07-12T12:00:00Z"));
    serviceRepo = new FakeServiceRepository();
    categoryRepo = new FakeCategoryRepository();
    useCase = new SeedPricebookUseCase(serviceRepo, categoryRepo, clock, fixedIds());
  });

  it("seeds every category and service from the input when the org has no services", async () => {
    const result = await useCase.exec(ORG, SEED_INPUT);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.categories).toHaveLength(2);
      expect(result.value.services).toHaveLength(3);
    }
    expect(categoryRepo.store.size).toBe(2);
    expect(serviceRepo.store.size).toBe(3);
  });

  it("creates categories before services (services resolve a real categoryId)", async () => {
    const result = await useCase.exec(ORG, SEED_INPUT);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    const waterHeaterCategory = result.value.categories.find((c) => c.props.name === "Water Heaters");
    const drainsCategory = result.value.categories.find((c) => c.props.name === "Drains");
    expect(waterHeaterCategory).toBeDefined();
    expect(drainsCategory).toBeDefined();

    const heaterService = result.value.services.find((s) => s.props.name === "Replace water heater");
    const drainService = result.value.services.find((s) => s.props.name === "Drain cleaning");
    const toiletService = result.value.services.find((s) => s.props.name === "Toilet reset");

    expect(heaterService?.props.categoryId).toBe(waterHeaterCategory?.props.id);
    expect(drainService?.props.categoryId).toBe(drainsCategory?.props.id);
    expect(toiletService?.props.categoryId).toBe(waterHeaterCategory?.props.id);
  });

  it("preserves unitPriceCents and costCents from the input", async () => {
    const result = await useCase.exec(ORG, SEED_INPUT);
    expect(isOk(result)).toBe(true);
    if (!isOk(result)) return;

    const heaterService = result.value.services.find((s) => s.props.name === "Replace water heater");
    expect(heaterService?.props.unitPriceCents).toBe(240000);
    expect(heaterService?.props.costCents).toBe(118000);
  });

  it("is idempotent: seeding an org that already has a service creates nothing new", async () => {
    // Simulate a prior manual add — the org already has one service before seeding runs.
    const existing = await serviceRepo.create({
      id: "existing-1",
      orgId: ORG,
      categoryId: null,
      code: null,
      name: "Pre-existing Service",
      description: null,
      unitPriceCents: 5000,
      costCents: 1000,
      laborHours: null,
      taxable: false,
      warrantyText: null,
      imageUrl: null,
      isAddon: false,
      active: true,
      position: 0,
      measuredBy: null,
    });
    serviceRepo.createCallCount = 0; // reset — only count calls made by the use-case itself

    const result = await useCase.exec(ORG, SEED_INPUT);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.services).toHaveLength(0);
      expect(result.value.categories).toHaveLength(0);
    }
    // No new rows: the seed pack's services/categories were never created, and the
    // pre-existing service is untouched.
    expect(serviceRepo.createCallCount).toBe(0);
    expect(categoryRepo.createCallCount).toBe(0);
    expect(serviceRepo.store.size).toBe(1);
    expect(serviceRepo.store.get(existing.props.id)).toBeDefined();
  });

  it("checks existence via a bounded (limit 1) list call, never a full scan", async () => {
    // The FIRST repo.list call is the existence check; later calls belong to
    // CreateServiceUseCase's own per-service name-dedupe check (a different concern).
    let firstObservedLimit: number | undefined;
    const original = serviceRepo.list.bind(serviceRepo);
    serviceRepo.list = async (page, filter) => {
      if (firstObservedLimit === undefined) firstObservedLimit = page.limit;
      return original(page, filter);
    };

    await useCase.exec(ORG, SEED_INPUT);

    expect(firstObservedLimit).toBe(1);
  });

  it("running seed twice on an empty-turned-seeded org does not duplicate the second time", async () => {
    const first = await useCase.exec(ORG, SEED_INPUT);
    expect(isOk(first)).toBe(true);
    if (isOk(first)) expect(first.value.services).toHaveLength(3);

    const second = await useCase.exec(ORG, SEED_INPUT);
    expect(isOk(second)).toBe(true);
    if (isOk(second)) {
      expect(second.value.services).toHaveLength(0);
      expect(second.value.categories).toHaveLength(0);
    }
    expect(serviceRepo.store.size).toBe(3);
    expect(categoryRepo.store.size).toBe(2);
  });

  it("surfaces a create error instead of silently swallowing it", async () => {
    categoryRepo.create = async () => {
      throw new Error("db unavailable");
    };

    await expect(useCase.exec(ORG, SEED_INPUT)).rejects.toThrow("db unavailable");
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// MATERIALS
//
// A painter's pricebook is not finished at the service list. Paint is bought by the GALLON and
// consumed off wall area, so a shop whose Materials tab reads 0 has no cost basis for the thing
// it spends most of its money on — and no way to turn a scanned 210 sq ft bathroom into the two
// cans it actually takes. Service trades genuinely have no equivalent (a water heater is bought
// for one address), so this is opt-in per pack and absent means absent.
// ─────────────────────────────────────────────────────────────────────────────

class FakeMaterialRepo {
  readonly created: { name: string; unitCostCents: number; unitOfMeasure: string; position: number }[] = [];
  async create(input: { id: string; orgId: string; name: string; unitCostCents: number; unitOfMeasure: string; position: number }) {
    this.created.push({
      name: input.name,
      unitCostCents: input.unitCostCents,
      unitOfMeasure: input.unitOfMeasure,
      position: input.position,
    });
    const r = Material.create({
      id: asMaterialId(`00000000-0000-4000-8000-${String(this.created.length).padStart(12, "0")}`),
      orgId: ORG,
      categoryId: null,
      code: null,
      name: input.name,
      description: null,
      unitCostCents: input.unitCostCents,
      unitPriceCents: input.unitCostCents,
      unitOfMeasure: input.unitOfMeasure,
      markupBps: null,
      pricingMode: "rule",
      taxable: true,
      vendor: null,
      active: true,
      position: input.position,
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-01T00:00:00Z"),
    });
    if (!isOk(r)) throw new Error("Material.create failed in fake");
    return r.value;
  }
  async findById() { return null; }
  async allNames() { return this.created.map((m) => m.name); }
  async list() { return { items: [], nextCursor: null }; }
  async save() { throw new Error("unused"); }
  async archiveByLead() { return 0; }
  async archive() { throw new Error("unused"); }
}

const fakeBands = { list: async () => [], replaceAll: async () => {} };

const PAINT_PACK: SeedPricebookInput = {
  categories: [{ name: "Interior Walls & Ceilings" }],
  services: [
    { name: "Interior wall painting", categoryName: "Interior Walls & Ceilings", unitPriceCents: 225, costCents: 105, measuredBy: "walls_sqft" },
  ],
  materials: [
    { name: "Interior latex, eggshell", unitCostCents: 3800, unitOfMeasure: "gal", description: "Covers ~350 sq ft per coat.", categoryName: "Interior Walls & Ceilings" },
    { name: "Painter's caulk", unitCostCents: 350, unitOfMeasure: "tube" },
  ],
};

describe("SeedPricebookUseCase — materials", () => {
  let services: FakeServiceRepository;
  let categories: FakeCategoryRepository;
  let materials: FakeMaterialRepo;
  let useCase: SeedPricebookUseCase;

  beforeEach(() => {
    nextMintedId = 0;
    services = new FakeServiceRepository();
    categories = new FakeCategoryRepository();
    materials = new FakeMaterialRepo();
    useCase = new SeedPricebookUseCase(
      services,
      categories,
      new FixedClock(new Date("2026-08-14T12:00:00Z")),
      { newId: () => `00000000-0000-4000-8000-${String(++nextMintedId).padStart(12, "0")}` },
      materials as never,
      fakeBands,
    );
  });

  it("seeds the pack's materials alongside its services", async () => {
    const result = await useCase.exec(ORG, PAINT_PACK);

    expect(isOk(result)).toBe(true);
    expect(materials.created.map((m) => m.name)).toEqual([
      "Interior latex, eggshell",
      "Painter's caulk",
    ]);
  });

  it("keeps the supplier's unit — a gallon of paint is not a square foot of wall", async () => {
    await useCase.exec(ORG, PAINT_PACK);

    expect(materials.created[0]).toMatchObject({ unitOfMeasure: "gal", unitCostCents: 3800 });
    expect(materials.created[1]).toMatchObject({ unitOfMeasure: "tube", unitCostCents: 350 });
  });

  it("keeps the pack's own order, the way services do", async () => {
    await useCase.exec(ORG, PAINT_PACK);

    expect(materials.created.map((m) => m.position)).toEqual([0, 1]);
  });

  it("returns them, so the store adopts the seed instead of refetching", async () => {
    const result = await useCase.exec(ORG, PAINT_PACK);

    expect(isOk(result) && result.value.materials).toHaveLength(2);
  });

  it("seeds none for a pack that carries none — a service trade buys parts per address", async () => {
    const result = await useCase.exec(ORG, { categories: PAINT_PACK.categories, services: PAINT_PACK.services });

    expect(isOk(result) && result.value.materials).toEqual([]);
    expect(materials.created).toHaveLength(0);
  });

  // Same idempotence law the services follow: an org with a book already is left alone entirely,
  // so a re-clicked button cannot append a second set of paint.
  it("writes no material into a book that already has a service", async () => {
    services.store.set(asServiceId("11111111-1111-1111-1111-111111111111"), makeService());

    const result = await useCase.exec(ORG, PAINT_PACK);

    expect(isOk(result) && result.value.materials).toEqual([]);
    expect(materials.created).toHaveLength(0);
  });
});
