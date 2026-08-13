import { describe, it, expect, beforeEach } from "vitest";
import {
  asMaterialId,
  asOrgId,
  asServiceId,
  isOk,
  type MaterialId,
  type OrgId,
  type ServiceId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { Service, type ServiceProps } from "../domain/service";
import type { ServiceRepository } from "../domain/service-repository";
import { Material, type MaterialProps } from "../domain/material";
import type { MaterialRepository } from "../domain/material-repository";
import type { ServiceMaterial, ServiceMaterialRepository } from "../domain/service-material";
import { AttachMaterialUseCase, type AttachMaterialCommand } from "./attach-material";

// ── constants ─────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const SERVICE_ID: ServiceId = asServiceId("11111111-1111-1111-1111-111111111111");
const MISSING_SERVICE_ID: ServiceId = asServiceId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const MATERIAL_ID: MaterialId = asMaterialId("33333333-3333-3333-3333-333333333333");
const MISSING_MATERIAL_ID: MaterialId = asMaterialId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

// ── helpers ───────────────────────────────────────────────────────────────────

const baseServiceProps = (overrides: Partial<ServiceProps> = {}): ServiceProps => ({
  id: SERVICE_ID,
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
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...overrides,
});

const makeService = (overrides: Partial<ServiceProps> = {}): Service => {
  const r = Service.create(baseServiceProps(overrides));
  if (!isOk(r)) throw new Error(`Service.create failed: ${JSON.stringify(r.error)}`);
  return r.value;
};

const baseMaterialProps = (overrides: Partial<MaterialProps> = {}): MaterialProps => ({
  id: MATERIAL_ID,
  orgId: ORG,
  categoryId: null,
  code: null,
  name: "1/2in Copper Pipe",
  description: null,
  unitCostCents: 250,
  unitPriceCents: 0,
  pricingMode: "rule" as const,
  unitOfMeasure: "each",
  markupBps: null,
  taxable: false,
  vendor: null,
  active: true,
  position: 0,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...overrides,
});

const makeMaterial = (overrides: Partial<MaterialProps> = {}): Material => {
  const r = Material.create(baseMaterialProps(overrides));
  if (!isOk(r)) throw new Error(`Material.create failed: ${JSON.stringify(r.error)}`);
  return r.value;
};

// ── FakeServiceRepository ─────────────────────────────────────────────────────

class FakeServiceRepository implements ServiceRepository {
  private readonly store = new Map<ServiceId, Service>();
  findByIdCallCount = 0;

  seed(service: Service): void {
    this.store.set(service.props.id, service);
  }

  async findById(id: ServiceId): Promise<Service | null> {
    this.findByIdCallCount += 1;
    return this.store.get(id) ?? null;
  }

  async create(): Promise<Service> {
    throw new Error("create not used in attach tests");
  }

  async save(): Promise<void> {
    throw new Error("save not used in attach tests");
  }

  async archiveByLead(): Promise<number> { return 0; }
  async archive(): Promise<number> {
    throw new Error("archive not used in attach tests");
  }

  async allNames(): Promise<string[]> {
    return [...this.store.values()].map((s) => s.props.name);
  }

  async list(
    _page: CursorPage,
    _filter: { search?: string; categoryId?: string | null },
  ): Promise<Paginated<Service>> {
    throw new Error("list not used in attach tests");
  }
}

// ── FakeMaterialRepository ────────────────────────────────────────────────────

class FakeMaterialRepository implements MaterialRepository {
  private readonly store = new Map<MaterialId, Material>();
  findByIdCallCount = 0;

  seed(material: Material): void {
    this.store.set(material.props.id, material);
  }

  async findById(id: MaterialId): Promise<Material | null> {
    this.findByIdCallCount += 1;
    return this.store.get(id) ?? null;
  }

  async create(): Promise<Material> {
    throw new Error("create not used in attach tests");
  }

  async save(): Promise<void> {
    throw new Error("save not used in attach tests");
  }

  async archive(): Promise<number> {
    throw new Error("archive not used in attach tests");
  }

  async allNames(): Promise<string[]> {
    return [...this.store.values()].map((m) => m.props.name);
  }

  async list(
    _page: CursorPage,
    _filter: { search?: string; categoryId?: string | null },
  ): Promise<Paginated<Material>> {
    throw new Error("list not used in attach tests");
  }
}

// ── FakeServiceMaterialRepository ─────────────────────────────────────────────

class FakeServiceMaterialRepository implements ServiceMaterialRepository {
  attachCallCount = 0;
  lastAttachInput: Parameters<ServiceMaterialRepository["attach"]>[0] | undefined;

  async attach(input: Parameters<ServiceMaterialRepository["attach"]>[0]): Promise<void> {
    this.attachCallCount += 1;
    this.lastAttachInput = input;
  }

  async detach(): Promise<number> {
    throw new Error("detach not used in attach tests");
  }

  async listForService(): Promise<ServiceMaterial[]> {
    throw new Error("listForService not used in attach tests");
  }

  async listForServices(): Promise<ServiceMaterial[]> {
    throw new Error("listForServices not used in attach tests");
  }
}

// ── AttachMaterialUseCase ─────────────────────────────────────────────────────

describe("AttachMaterialUseCase", () => {
  let serviceRepo: FakeServiceRepository;
  let materialRepo: FakeMaterialRepository;
  let smRepo: FakeServiceMaterialRepository;
  let useCase: AttachMaterialUseCase;

  beforeEach(() => {
    serviceRepo = new FakeServiceRepository();
    materialRepo = new FakeMaterialRepository();
    smRepo = new FakeServiceMaterialRepository();
    useCase = new AttachMaterialUseCase(serviceRepo, materialRepo, smRepo);
  });

  // ── existence checks ──────────────────────────────────────────────────────

  it("returns not_found when the service does not exist", async () => {
    materialRepo.seed(makeMaterial());

    const cmd: AttachMaterialCommand = {
      serviceId: MISSING_SERVICE_ID,
      materialId: MATERIAL_ID,
      quantity: 2,
    };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not_found");
  });

  it("does not call materialRepo.findById or smRepo.attach when the service is missing", async () => {
    materialRepo.seed(makeMaterial());

    const cmd: AttachMaterialCommand = {
      serviceId: MISSING_SERVICE_ID,
      materialId: MATERIAL_ID,
      quantity: 2,
    };
    await useCase.exec(cmd, ORG);

    expect(materialRepo.findByIdCallCount).toBe(0);
    expect(smRepo.attachCallCount).toBe(0);
  });

  it("returns not_found when the material does not exist", async () => {
    serviceRepo.seed(makeService());

    const cmd: AttachMaterialCommand = {
      serviceId: SERVICE_ID,
      materialId: MISSING_MATERIAL_ID,
      quantity: 2,
    };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not_found");
  });

  it("does not call smRepo.attach when the material is missing", async () => {
    serviceRepo.seed(makeService());

    const cmd: AttachMaterialCommand = {
      serviceId: SERVICE_ID,
      materialId: MISSING_MATERIAL_ID,
      quantity: 2,
    };
    await useCase.exec(cmd, ORG);

    expect(smRepo.attachCallCount).toBe(0);
  });

  // ── quantity validation (via ServiceMaterial.create) ─────────────────────

  it("returns a validation error when quantity is 0", async () => {
    serviceRepo.seed(makeService());
    materialRepo.seed(makeMaterial());

    const cmd: AttachMaterialCommand = { serviceId: SERVICE_ID, materialId: MATERIAL_ID, quantity: 0 };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") {
      expect(result.error.field).toBe("quantity");
    }
  });

  it("returns a validation error when quantity is negative", async () => {
    serviceRepo.seed(makeService());
    materialRepo.seed(makeMaterial());

    const cmd: AttachMaterialCommand = { serviceId: SERVICE_ID, materialId: MATERIAL_ID, quantity: -1 };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("validation");
  });

  it("does not call smRepo.attach when quantity validation fails", async () => {
    serviceRepo.seed(makeService());
    materialRepo.seed(makeMaterial());

    const cmd: AttachMaterialCommand = { serviceId: SERVICE_ID, materialId: MATERIAL_ID, quantity: 0 };
    await useCase.exec(cmd, ORG);

    expect(smRepo.attachCallCount).toBe(0);
  });

  // ── happy path ────────────────────────────────────────────────────────────

  it("attaches the material and returns ok when both the service and material exist", async () => {
    serviceRepo.seed(makeService());
    materialRepo.seed(makeMaterial());

    const cmd: AttachMaterialCommand = { serviceId: SERVICE_ID, materialId: MATERIAL_ID, quantity: 3 };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    expect(smRepo.attachCallCount).toBe(1);
  });

  it("forwards serviceId, materialId, quantity, and orgId to smRepo.attach", async () => {
    serviceRepo.seed(makeService());
    materialRepo.seed(makeMaterial());

    const cmd: AttachMaterialCommand = { serviceId: SERVICE_ID, materialId: MATERIAL_ID, quantity: 3 };
    await useCase.exec(cmd, ORG);

    expect(smRepo.lastAttachInput).toEqual({
      orgId: ORG,
      serviceId: SERVICE_ID,
      materialId: MATERIAL_ID,
      quantity: 3,
    });
  });

  it("checks findById on both repos before attaching", async () => {
    serviceRepo.seed(makeService());
    materialRepo.seed(makeMaterial());

    const cmd: AttachMaterialCommand = { serviceId: SERVICE_ID, materialId: MATERIAL_ID, quantity: 3 };
    await useCase.exec(cmd, ORG);

    expect(serviceRepo.findByIdCallCount).toBe(1);
    expect(materialRepo.findByIdCallCount).toBe(1);
  });
});
