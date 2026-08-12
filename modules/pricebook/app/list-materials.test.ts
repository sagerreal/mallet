import { describe, it, expect, beforeEach } from "vitest";
import {
  asMaterialId,
  asOrgId,
  isOk,
  type MaterialId,
  type OrgId,
  type CursorPage,
  type Paginated,
} from "@mallet/shared/types";
import { Material, type MaterialProps } from "../domain/material";
import type { MaterialRepository } from "../domain/material-repository";
import { ListMaterialsUseCase, type ListMaterialsQuery } from "./list-materials";

// ── constants ─────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const MATERIAL_ID_A: MaterialId = asMaterialId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const MATERIAL_ID_B: MaterialId = asMaterialId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

// ── helpers ───────────────────────────────────────────────────────────────────

const baseProps = (overrides: Partial<MaterialProps> = {}): MaterialProps => ({
  id: MATERIAL_ID_A,
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
  const r = Material.create(baseProps(overrides));
  if (!isOk(r)) throw new Error(`Material.create failed: ${JSON.stringify(r.error)}`);
  return r.value;
};

// ── FakeMaterialRepository ────────────────────────────────────────────────────

class FakeMaterialRepository implements MaterialRepository {
  private readonly store: Material[] = [];
  listCallCount = 0;
  lastListPage: CursorPage | null = null;
  lastListFilter: { search?: string; categoryId?: string | null } | null = null;

  private _nextResult: Paginated<Material> | null = null;

  seed(material: Material): void {
    this.store.push(material);
  }

  setNextResult(result: Paginated<Material>): void {
    this._nextResult = result;
  }

  async allNames(): Promise<string[]> {
    return [...this.store.values()].map((m) => m.props.name);
  }

  async list(
    page: CursorPage,
    filter: { search?: string; categoryId?: string | null },
  ): Promise<Paginated<Material>> {
    this.listCallCount += 1;
    this.lastListPage = page;
    this.lastListFilter = filter;
    if (this._nextResult !== null) return this._nextResult;
    return { items: [...this.store], nextCursor: null };
  }

  async create(): Promise<Material> {
    throw new Error("create not used in list tests");
  }

  async findById(): Promise<Material | null> {
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

// ── ListMaterialsUseCase ──────────────────────────────────────────────────────

describe("ListMaterialsUseCase", () => {
  let repo: FakeMaterialRepository;
  let useCase: ListMaterialsUseCase;

  beforeEach(() => {
    repo = new FakeMaterialRepository();
    useCase = new ListMaterialsUseCase(repo);
  });

  // ── delegation ────────────────────────────────────────────────────────────

  it("calls repo.list exactly once per exec invocation", async () => {
    const query: ListMaterialsQuery = { page: { limit: 25, cursor: null } };
    await useCase.exec(query);
    expect(repo.listCallCount).toBe(1);
  });

  it("forwards the page parameter from the query to repo.list", async () => {
    const page: CursorPage = { limit: 10, cursor: "some-cursor" };
    const query: ListMaterialsQuery = { page };
    await useCase.exec(query);
    expect(repo.lastListPage).toEqual(page);
  });

  it("forwards the search filter to repo.list", async () => {
    const query: ListMaterialsQuery = { page: { limit: 25, cursor: null }, search: "copper" };
    await useCase.exec(query);
    expect(repo.lastListFilter?.search).toBe("copper");
  });

  it("forwards the categoryId filter to repo.list", async () => {
    const query: ListMaterialsQuery = {
      page: { limit: 25, cursor: null },
      categoryId: "cat-1",
    };
    await useCase.exec(query);
    expect(repo.lastListFilter?.categoryId).toBe("cat-1");
  });

  it("forwards undefined search/categoryId when the query omits them", async () => {
    const query: ListMaterialsQuery = { page: { limit: 25, cursor: null } };
    await useCase.exec(query);
    expect(repo.lastListFilter?.search).toBeUndefined();
    expect(repo.lastListFilter?.categoryId).toBeUndefined();
  });

  // ── result pass-through ───────────────────────────────────────────────────

  it("returns the exact Paginated result the repository resolves with", async () => {
    const materialA = makeMaterial({ id: MATERIAL_ID_A, name: "1/2in Copper Pipe" });
    const materialB = makeMaterial({ id: MATERIAL_ID_B, name: "3/4in Copper Pipe" });
    const expected: Paginated<Material> = { items: [materialA, materialB], nextCursor: null };
    repo.setNextResult(expected);

    const result = await useCase.exec({ page: { limit: 25, cursor: null } });

    expect(result).toBe(expected);
  });

  it("returns an empty items array when the repository returns no materials", async () => {
    repo.setNextResult({ items: [], nextCursor: null });

    const result = await useCase.exec({ page: { limit: 25, cursor: null } });

    expect(result.items).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  it("returns a non-null nextCursor when the repository signals more pages", async () => {
    const material = makeMaterial();
    const nextCursor = "bmV4dC1wYWdl";
    repo.setNextResult({ items: [material], nextCursor });

    const result = await useCase.exec({ page: { limit: 1, cursor: null } });

    expect(result.nextCursor).toBe(nextCursor);
  });
});
