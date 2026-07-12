import { describe, it, expect, beforeEach } from "vitest";
import {
  asCategoryId,
  asOrgId,
  FixedClock,
  isOk,
  type CategoryId,
  type OrgId,
} from "@mallet/shared/types";
import { Category, type CategoryProps } from "../domain/category";
import type { CategoryRepository } from "../domain/category-repository";
import { CreateCategoryUseCase, type CreateCategoryCommand } from "./create-category";

// ── constants ─────────────────────────────────────────────────────────────────

const ORG: OrgId = asOrgId("22222222-2222-2222-2222-222222222222");
const FIXED_ID = "11111111-1111-1111-1111-111111111111";
const MINTED_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

// ── helpers ───────────────────────────────────────────────────────────────────

const baseProps = (overrides: Partial<CategoryProps> = {}): CategoryProps => ({
  id: asCategoryId(FIXED_ID),
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
  private readonly store = new Map<CategoryId, Category>();
  createCallCount = 0;
  lastCreatedInput: Parameters<CategoryRepository["create"]>[0] | undefined;

  async create(input: Parameters<CategoryRepository["create"]>[0]): Promise<Category> {
    this.createCallCount += 1;
    this.lastCreatedInput = input;
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
    throw new Error("list not used in create tests");
  }

  async save(): Promise<void> {
    throw new Error("save not used in create tests");
  }

  async archive(): Promise<number> {
    throw new Error("archive not used in create tests");
  }
}

const fixedIds = (id: string = MINTED_ID) => ({ newId: () => id });

// ── CreateCategoryUseCase ─────────────────────────────────────────────────────

describe("CreateCategoryUseCase", () => {
  let clock: FixedClock;
  let repo: FakeCategoryRepository;
  let useCase: CreateCategoryUseCase;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-09T12:00:00Z"));
    repo = new FakeCategoryRepository();
    useCase = new CreateCategoryUseCase(repo, clock, fixedIds());
  });

  // ── validation — empty name ───────────────────────────────────────────────

  it("returns a validation error when name is empty string", async () => {
    const cmd: CreateCategoryCommand = { name: "" };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") {
      expect(result.error.field).toBe("name");
    }
  });

  it("returns a validation error when name is only whitespace", async () => {
    const cmd: CreateCategoryCommand = { name: "   " };
    const result = await useCase.exec(cmd, ORG);

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === "validation") {
      expect(result.error.field).toBe("name");
    }
  });

  it("does not call repo.create when name validation fails", async () => {
    const cmd: CreateCategoryCommand = { name: "  " };
    await useCase.exec(cmd, ORG);

    expect(repo.createCallCount).toBe(0);
  });

  // ── happy path — id provided by caller ───────────────────────────────────

  it("uses the caller-provided id when present", async () => {
    const cmd: CreateCategoryCommand = { id: FIXED_ID, name: "Water Heaters" };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.id).toBe(FIXED_ID);
  });

  it("mints a new id from IdGenerator when no id is provided", async () => {
    const cmd: CreateCategoryCommand = { name: "Water Heaters" };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.id).toBe(MINTED_ID);
  });

  // ── defaults + field propagation ──────────────────────────────────────────

  it("defaults parentId to null and sortOrder to 0 when omitted", async () => {
    const cmd: CreateCategoryCommand = { name: "Water Heaters" };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.parentId).toBeNull();
      expect(result.value.props.sortOrder).toBe(0);
    }
  });

  it("passes a provided parentId and sortOrder through to repo.create", async () => {
    const cmd: CreateCategoryCommand = {
      name: "Tankless Water Heaters",
      parentId: "33333333-3333-3333-3333-333333333333",
      sortOrder: 5,
    };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.parentId).toBe("33333333-3333-3333-3333-333333333333");
      expect(result.value.props.sortOrder).toBe(5);
    }
  });

  it("trims whitespace from the name before creating", async () => {
    const cmd: CreateCategoryCommand = { name: "  Trimmed Category  " };
    const result = await useCase.exec(cmd, ORG);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.name).toBe("Trimmed Category");
  });

  it("passes the orgId to repo.create", async () => {
    const cmd: CreateCategoryCommand = { name: "Org Check" };
    await useCase.exec(cmd, ORG);

    expect(repo.lastCreatedInput?.orgId).toBe(ORG);
  });
});
