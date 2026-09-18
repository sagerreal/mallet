import { describe, it, expect, beforeEach } from "vitest";
import { asCategoryId, asOrgId, isOk, type CategoryId, type OrgId } from "@mallet/shared/types";
import { Category, type CategoryProps } from "../domain/category";
import type { CategoryRepository } from "../domain/category-repository";
import { ListCategoriesUseCase } from "./list-categories";

// ── constants ─────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const CATEGORY_ID_A: CategoryId = asCategoryId("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const CATEGORY_ID_B: CategoryId = asCategoryId("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

// ── helpers ───────────────────────────────────────────────────────────────────

const baseProps = (overrides: Partial<CategoryProps> = {}): CategoryProps => ({
  id: CATEGORY_ID_A,
  orgId: ORG,
  parentId: null,
  name: "Water Heaters",
  sortOrder: 0,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...overrides,
});

const makeCategory = (overrides: Partial<CategoryProps> = {}): Category => {
  const r = Category.create(baseProps(overrides));
  if (!isOk(r)) throw new Error(`Category.create failed: ${JSON.stringify(r.error)}`);
  return r.value;
};

// ── FakeCategoryRepository ────────────────────────────────────────────────────

class FakeCategoryRepository implements CategoryRepository {
  listCallCount = 0;
  private _nextResult: Category[] | null = null;

  setNextResult(result: Category[]): void {
    this._nextResult = result;
  }

  async list(): Promise<Category[]> {
    this.listCallCount += 1;
    return this._nextResult ?? [];
  }

  async create(): Promise<Category> {
    throw new Error("create not used in list tests");
  }

  async save(): Promise<void> {
    throw new Error("save not used in list tests");
  }

  async archiveByLead(): Promise<number> { return 0; }
  async archive(): Promise<number> {
    throw new Error("archive not used in list tests");
  }
}

// ── ListCategoriesUseCase ─────────────────────────────────────────────────────

describe("ListCategoriesUseCase", () => {
  let repo: FakeCategoryRepository;
  let useCase: ListCategoriesUseCase;

  beforeEach(() => {
    repo = new FakeCategoryRepository();
    useCase = new ListCategoriesUseCase(repo);
  });

  it("calls repo.list exactly once per exec invocation", async () => {
    await useCase.exec();
    expect(repo.listCallCount).toBe(1);
  });

  it("returns the exact array the repository resolves with", async () => {
    const categoryA = makeCategory({ id: CATEGORY_ID_A, name: "Water Heaters" });
    const categoryB = makeCategory({ id: CATEGORY_ID_B, name: "Drains" });
    repo.setNextResult([categoryA, categoryB]);

    const result = await useCase.exec();

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(categoryA);
    expect(result[1]).toBe(categoryB);
  });

  it("returns an empty array when the repository has no categories", async () => {
    repo.setNextResult([]);

    const result = await useCase.exec();

    expect(result).toHaveLength(0);
  });

  it("propagates a rejection thrown by repo.list", async () => {
    const error = new Error("database connection lost");
    repo.list = async () => {
      throw error;
    };

    await expect(useCase.exec()).rejects.toThrow("database connection lost");
  });
});
