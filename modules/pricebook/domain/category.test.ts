import { describe, it, expect } from "vitest";
import { asCategoryId, asOrgId, isOk } from "@mallet/shared/types";
import { Category, type CategoryProps } from "./category";

const baseProps = (overrides: Partial<CategoryProps> = {}): CategoryProps => ({
  id: asCategoryId("11111111-1111-1111-1111-111111111111"),
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
  parentId: null,
  name: "Water Heaters",
  sortOrder: 0,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...overrides,
});

const unwrap = (r: ReturnType<typeof Category.create>): Category => {
  if (!isOk(r)) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};

describe("Category.create", () => {
  it("rejects an empty name", () => {
    const r = Category.create(baseProps({ name: "   " }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("name");
  });

  it("trims the name", () => {
    const category = unwrap(Category.create(baseProps({ name: "  Water Heaters  " })));
    expect(category.props.name).toBe("Water Heaters");
  });

  it("accepts a null parentId (top-level category)", () => {
    const category = unwrap(Category.create(baseProps()));
    expect(category.props.parentId).toBeNull();
  });

  it("accepts a populated parentId", () => {
    const category = unwrap(
      Category.create(baseProps({ parentId: "33333333-3333-3333-3333-333333333333" })),
    );
    expect(category.props.parentId).toBe("33333333-3333-3333-3333-333333333333");
  });
});

describe("Category.patch", () => {
  const now = new Date("2026-07-09T12:00:00Z");

  it("patches sortOrder and bumps updatedAt, leaving other fields intact", () => {
    const category = unwrap(Category.create(baseProps({ name: "Water Heaters", sortOrder: 0 })));
    const result = category.patch({ sortOrder: 3 }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.sortOrder).toBe(3);
      expect(result.value.props.name).toBe("Water Heaters");
      expect(result.value.props.updatedAt.toISOString()).toBe(now.toISOString());
    }
  });

  it("patches parentId", () => {
    const category = unwrap(Category.create(baseProps()));
    const result = category.patch(
      { parentId: "33333333-3333-3333-3333-333333333333" },
      now,
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.parentId).toBe("33333333-3333-3333-3333-333333333333");
    }
  });

  it("allows patching parentId back to null", () => {
    const category = unwrap(
      Category.create(baseProps({ parentId: "33333333-3333-3333-3333-333333333333" })),
    );
    const result = category.patch({ parentId: null }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.parentId).toBeNull();
    }
  });

  it("rejects an empty name in patch", () => {
    const category = unwrap(Category.create(baseProps()));
    const result = category.patch({ name: "   " }, now);
    expect(isOk(result)).toBe(false);
  });

  it("undefined fields keep their current value", () => {
    const category = unwrap(Category.create(baseProps({ sortOrder: 5 })));
    const result = category.patch({ name: "New Name" }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.sortOrder).toBe(5);
    }
  });
});
