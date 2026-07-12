import { describe, it, expect } from "vitest";
import { type CategoryRow, rowToCategory } from "./category-mapper";

// ── Fixtures ────────────────────────────────────────────────────────────────

const ORG_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ROW_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const baseRow = (): CategoryRow => ({
  id: ROW_ID,
  orgId: ORG_ID,
  parentId: null,
  name: "Water Heaters",
  sortOrder: 1,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  deletedAt: null,
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("rowToCategory (category mapper)", () => {
  it("maps a valid DB row to a Category", () => {
    const category = rowToCategory(baseRow());
    const p = category.props;

    expect(p.name).toBe("Water Heaters");
    expect(p.parentId).toBeNull();
    expect(p.sortOrder).toBe(1);
  });

  it("preserves a non-null parentId (subcategory)", () => {
    const row = baseRow();
    row.parentId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const category = rowToCategory(row);
    expect(category.props.parentId).toBe("cccccccc-cccc-cccc-cccc-cccccccccccc");
  });

  it("throws on a corrupt row (empty name violates the domain invariant)", () => {
    const row = baseRow();
    row.name = "";
    expect(() => rowToCategory(row)).toThrow(/corrupt pricebook_category/);
  });
});
