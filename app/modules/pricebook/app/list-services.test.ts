import { describe, it, expect, beforeEach } from "vitest";
import {
  asServiceId,
  asOrgId,
  isOk,
  type ServiceId,
  type OrgId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { Service, type ServiceProps } from "../domain/service";
import type { ServiceRepository } from "../domain/service-repository";
import { ListServicesUseCase, type ListServicesQuery } from "./list-services";

// ── constants ─────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const SERVICE_ID_A: ServiceId = asServiceId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const SERVICE_ID_B: ServiceId = asServiceId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

// ── helpers ───────────────────────────────────────────────────────────────────

const baseProps = (overrides: Partial<ServiceProps> = {}): ServiceProps => ({
  id: SERVICE_ID_A,
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
  private readonly store: Service[] = [];
  listCallCount = 0;
  lastListPage: CursorPage | null = null;
  lastListFilter: { search?: string; categoryId?: string | null } | null = null;

  private _nextResult: Paginated<Service> | null = null;

  seed(service: Service): void {
    this.store.push(service);
  }

  setNextResult(result: Paginated<Service>): void {
    this._nextResult = result;
  }

  async allNames(): Promise<string[]> {
    return [...this.store.values()].map((s) => s.props.name);
  }

  async list(
    page: CursorPage,
    filter: { search?: string; categoryId?: string | null },
  ): Promise<Paginated<Service>> {
    this.listCallCount += 1;
    this.lastListPage = page;
    this.lastListFilter = filter;
    if (this._nextResult !== null) return this._nextResult;
    return { items: [...this.store], nextCursor: null };
  }

  async create(): Promise<Service> {
    throw new Error("create not used in list tests");
  }

  async findById(): Promise<Service | null> {
    throw new Error("findById not used in list tests");
  }

  async save(): Promise<void> {
    throw new Error("save not used in list tests");
  }

  async archiveByLead(): Promise<number> { return 0; }
  async archive(): Promise<number> {
    throw new Error("archive not used in list tests");
  }
}

// ── ListServicesUseCase ───────────────────────────────────────────────────────

describe("ListServicesUseCase", () => {
  let repo: FakeServiceRepository;
  let useCase: ListServicesUseCase;

  beforeEach(() => {
    repo = new FakeServiceRepository();
    useCase = new ListServicesUseCase(repo);
  });

  // ── delegation ────────────────────────────────────────────────────────────

  it("calls repo.list exactly once per exec invocation", async () => {
    const query: ListServicesQuery = { page: { limit: 25, cursor: null } };
    await useCase.exec(query);
    expect(repo.listCallCount).toBe(1);
  });

  it("forwards the page parameter from the query to repo.list", async () => {
    const page: CursorPage = { limit: 10, cursor: "some-cursor" };
    const query: ListServicesQuery = { page };
    await useCase.exec(query);
    expect(repo.lastListPage).toEqual(page);
  });

  it("forwards the search filter to repo.list", async () => {
    const query: ListServicesQuery = { page: { limit: 25, cursor: null }, search: "heater" };
    await useCase.exec(query);
    expect(repo.lastListFilter?.search).toBe("heater");
  });

  it("forwards the categoryId filter to repo.list", async () => {
    const query: ListServicesQuery = {
      page: { limit: 25, cursor: null },
      categoryId: "cat-1",
    };
    await useCase.exec(query);
    expect(repo.lastListFilter?.categoryId).toBe("cat-1");
  });

  it("forwards undefined search/categoryId when the query omits them", async () => {
    const query: ListServicesQuery = { page: { limit: 25, cursor: null } };
    await useCase.exec(query);
    expect(repo.lastListFilter?.search).toBeUndefined();
    expect(repo.lastListFilter?.categoryId).toBeUndefined();
  });

  // ── result pass-through ───────────────────────────────────────────────────

  it("returns the exact Paginated result the repository resolves with", async () => {
    const serviceA = makeService({ id: SERVICE_ID_A, name: "Water Heater Install" });
    const serviceB = makeService({ id: SERVICE_ID_B, name: "Drain Cleaning" });
    const expected: Paginated<Service> = { items: [serviceA, serviceB], nextCursor: null };
    repo.setNextResult(expected);

    const result = await useCase.exec({ page: { limit: 25, cursor: null } });

    expect(result).toBe(expected);
  });

  it("returns an empty items array when the repository returns no services", async () => {
    repo.setNextResult({ items: [], nextCursor: null });

    const result = await useCase.exec({ page: { limit: 25, cursor: null } });

    expect(result.items).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it("returns a non-null nextCursor when the repository signals more pages", async () => {
    const service = makeService();
    const nextCursor = "bmV4dC1wYWdl";
    repo.setNextResult({ items: [service], nextCursor });

    const result = await useCase.exec({ page: { limit: 1, cursor: null } });

    expect(result.nextCursor).toBe(nextCursor);
  });
});
