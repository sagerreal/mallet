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
import { ArchiveServiceUseCase, type ArchiveServiceCommand } from "./archive-service";

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
  archiveCallCount = 0;
  archiveLastArgs: { id: ServiceId; now: Date } | null = null;

  seed(service: Service): void {
    this.store.set(service.props.id, service);
  }

  async archiveByLead(): Promise<number> { return 0; }
  async archive(id: ServiceId, now: Date): Promise<number> {
    this.archiveCallCount += 1;
    this.archiveLastArgs = { id, now };
    const exists = this.store.has(id);
    if (exists) {
      this.store.delete(id);
      return 1;
    }
    return 0;
  }

  async findById(id: ServiceId): Promise<Service | null> {
    return this.store.get(id) ?? null;
  }

  async save(): Promise<void> {
    throw new Error("save not used in archive tests");
  }

  async create(): Promise<Service> {
    throw new Error("create not used in archive tests");
  }

  async allNames(): Promise<string[]> {
    return [...this.store.values()].map((s) => s.props.name);
  }

  async list(_page: CursorPage, _filter: { search?: string; categoryId?: string | null }): Promise<Paginated<Service>> {
    throw new Error("list not used in archive tests");
  }
}

// ── ArchiveServiceUseCase ─────────────────────────────────────────────────────

describe("ArchiveServiceUseCase", () => {
  let clock: FixedClock;
  let repo: FakeServiceRepository;
  let useCase: ArchiveServiceUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    repo = new FakeServiceRepository();
    useCase = new ArchiveServiceUseCase(repo, clock);
  });

  // ── not_found (count === 0) ───────────────────────────────────────────────

  it("returns not_found error when the service does not exist", async () => {
    const cmd: ArchiveServiceCommand = { serviceId: MISSING_ID };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not_found");
  });

  it("returns not_found error when the service was already archived (count === 0)", async () => {
    const cmd: ArchiveServiceCommand = { serviceId: SERVICE_ID };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not_found");
  });

  it("passes clock.now() to archive so the deletedAt timestamp is correct", async () => {
    const cmd: ArchiveServiceCommand = { serviceId: MISSING_ID };
    await useCase.exec(cmd, ORG);

    expect(repo.archiveLastArgs?.now.toISOString()).toBe(clock.now().toISOString());
  });

  // ── happy path ────────────────────────────────────────────────────────────

  it("returns { ok: true } when the service is successfully archived", async () => {
    repo.seed(makeService());

    const cmd: ArchiveServiceCommand = { serviceId: SERVICE_ID };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(true);
    if (isOk(result)) expect(result.value.ok).toBe(true);
  });

  it("calls archive exactly once on the happy path", async () => {
    repo.seed(makeService());

    const cmd: ArchiveServiceCommand = { serviceId: SERVICE_ID };
    await useCase.exec(cmd, ORG);

    expect(repo.archiveCallCount).toBe(1);
  });

  it("forwards the correct serviceId to archive", async () => {
    repo.seed(makeService());

    const cmd: ArchiveServiceCommand = { serviceId: SERVICE_ID };
    await useCase.exec(cmd, ORG);

    expect(repo.archiveLastArgs?.id).toBe(SERVICE_ID);
  });
});
