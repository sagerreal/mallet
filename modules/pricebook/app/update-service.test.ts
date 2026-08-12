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
import { UpdateServiceUseCase, type UpdateServiceCommand } from "./update-service";

// ── constants ─────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const SERVICE_ID: ServiceId = asServiceId("11111111-1111-1111-1111-111111111111");
const MISSING_ID: ServiceId = asServiceId("99999999-9999-9999-9999-999999999999");

// ── helpers ───────────────────────────────────────────────────────────────────

const baseProps = (overrides: Partial<ServiceProps> = {}): ServiceProps => ({
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
  const r = Service.create(baseProps(overrides));
  if (!isOk(r)) throw new Error(`Service.create failed: ${JSON.stringify(r.error)}`);
  return r.value;
};

// ── FakeServiceRepository ─────────────────────────────────────────────────────

class FakeServiceRepository implements ServiceRepository {
  private readonly store = new Map<ServiceId, Service>();
  saveCallCount = 0;

  seed(service: Service): void {
    this.store.set(service.props.id, service);
  }

  async findById(id: ServiceId): Promise<Service | null> {
    return this.store.get(id) ?? null;
  }

  async save(service: Service): Promise<void> {
    this.saveCallCount += 1;
    this.store.set(service.props.id, service);
  }

  async create(): Promise<Service> {
    throw new Error("create not used in update tests");
  }

  async allNames(): Promise<string[]> {
    return [...this.store.values()].map((s) => s.props.name);
  }

  async list(_page: CursorPage, _filter: { search?: string; categoryId?: string | null }): Promise<Paginated<Service>> {
    throw new Error("list not used in update tests");
  }

  async archiveByLead(): Promise<number> { return 0; }
  async archive(): Promise<number> {
    throw new Error("archive not used in update tests");
  }
}

// ── UpdateServiceUseCase ──────────────────────────────────────────────────────

describe("UpdateServiceUseCase", () => {
  let clock: FixedClock;
  let repo: FakeServiceRepository;
  let useCase: UpdateServiceUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    repo = new FakeServiceRepository();
    useCase = new UpdateServiceUseCase(repo, clock);
  });

  // ── not_found ─────────────────────────────────────────────────────────────

  it("returns not_found when the service does not exist", async () => {
    const cmd: UpdateServiceCommand = { serviceId: MISSING_ID, name: "New Name" };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not_found");
  });

  it("does not call save when service is not found", async () => {
    const cmd: UpdateServiceCommand = { serviceId: MISSING_ID, name: "New Name" };
    await useCase.exec(cmd, ORG);

    expect(repo.saveCallCount).toBe(0);
  });

  // ── domain validation failure (patch returns err) ─────────────────────────

  it("returns validation error when patch produces an empty name", async () => {
    repo.seed(makeService());

    const cmd: UpdateServiceCommand = { serviceId: SERVICE_ID, name: "   " };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") {
      expect(result.error.field).toBe("name");
    }
  });

  it("returns validation error when patch produces a negative unitPriceCents", async () => {
    repo.seed(makeService());

    const cmd: UpdateServiceCommand = { serviceId: SERVICE_ID, unitPriceCents: -1 };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("validation");
  });

  it("does not call save when patch validation fails", async () => {
    repo.seed(makeService());

    const cmd: UpdateServiceCommand = { serviceId: SERVICE_ID, name: "   " };
    await useCase.exec(cmd, ORG);

    expect(repo.saveCallCount).toBe(0);
  });

  // ── happy path ────────────────────────────────────────────────────────────

  it("returns the updated service on success", async () => {
    repo.seed(makeService());

    const cmd: UpdateServiceCommand = {
      serviceId: SERVICE_ID,
      name: "Water Heater Install (Tankless)",
      unitPriceCents: 200000,
    };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.name).toBe("Water Heater Install (Tankless)");
      expect(result.value.props.unitPriceCents).toBe(200000);
    }
  });

  it("stamps updatedAt with clock.now() on a successful update", async () => {
    repo.seed(makeService());

    const cmd: UpdateServiceCommand = { serviceId: SERVICE_ID, name: "Updated Name" };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.updatedAt.toISOString()).toBe(clock.now().toISOString());
    }
  });

  it("persists the patched service so a subsequent findById reflects the changes", async () => {
    repo.seed(makeService());

    const cmd: UpdateServiceCommand = { serviceId: SERVICE_ID, name: "Persisted Name" };
    await useCase.exec(cmd, ORG);

    const saved = await repo.findById(SERVICE_ID);
    expect(saved?.props.name).toBe("Persisted Name");
  });

  it("calls save exactly once on a successful update", async () => {
    repo.seed(makeService());

    const cmd: UpdateServiceCommand = { serviceId: SERVICE_ID, name: "Once" };
    await useCase.exec(cmd, ORG);

    expect(repo.saveCallCount).toBe(1);
  });

  it("allows clearing optional fields to null", async () => {
    repo.seed(makeService({ code: "WH-1", description: "Some notes" }));

    const cmd: UpdateServiceCommand = { serviceId: SERVICE_ID, code: null, description: null };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.code).toBeNull();
      expect(result.value.props.description).toBeNull();
    }
  });

  it("preserves fields that are not included in the command (undefined = keep current)", async () => {
    repo.seed(makeService({ code: "WH-1", taxable: true }));

    const cmd: UpdateServiceCommand = { serviceId: SERVICE_ID, name: "Changed" };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.code).toBe("WH-1");
      expect(result.value.props.taxable).toBe(true);
      expect(result.value.props.name).toBe("Changed");
    }
  });

  it("does not mutate the original service instance (immutability)", async () => {
    const original = makeService();
    repo.seed(original);

    const cmd: UpdateServiceCommand = { serviceId: SERVICE_ID, name: "Mutated?" };
    await useCase.exec(cmd, ORG);

    expect(original.props.name).toBe("Water Heater Install");
  });
});
