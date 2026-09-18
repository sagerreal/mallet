import { describe, it, expect } from "vitest";
import { type MaterialRow, rowToMaterial } from "./material-mapper";

// ── Fixtures ────────────────────────────────────────────────────────────────

const ORG_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ROW_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const baseRow = (): MaterialRow => ({
  id: ROW_ID,
  orgId: ORG_ID,
  categoryId: null,
  code: null,
  name: "1/2in Copper Pipe",
  description: null,
  unitCostCents: 350,
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
  deletedAt: null,
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("rowToMaterial (material mapper)", () => {
  it("maps a valid DB row to a Material, unit_of_measure <- unitOfMeasure", () => {
    const material = rowToMaterial(baseRow());
    const p = material.props;

    expect(p.name).toBe("1/2in Copper Pipe");
    expect(p.unitCostCents).toBe(350);
    expect(p.unitOfMeasure).toBe("each");
    expect(p.taxable).toBe(false);
    expect(p.active).toBe(true);
  });

  it("passes through a null markup_bps as null (use the org default)", () => {
    const material = rowToMaterial(baseRow());
    expect(material.props.markupBps).toBeNull();
  });

  it("keeps a non-null markup_bps as a plain number (bps, not a fraction)", () => {
    const row = baseRow();
    row.markupBps = 5000;
    const material = rowToMaterial(row);
    expect(material.props.markupBps).toBe(5000);
    expect(typeof material.props.markupBps).toBe("number");
  });

  it("keeps unit_cost_cents an integer (no dollar conversion at this boundary)", () => {
    const material = rowToMaterial(baseRow());
    expect(Number.isInteger(material.props.unitCostCents)).toBe(true);
  });

  it("throws on a corrupt row (empty name violates the domain invariant)", () => {
    const row = baseRow();
    row.name = "";
    expect(() => rowToMaterial(row)).toThrow(/corrupt pricebook_material/);
  });

  it("throws on a corrupt row (negative unit cost violates the domain invariant)", () => {
    const row = baseRow();
    row.unitCostCents = -1;
    expect(() => rowToMaterial(row)).toThrow(/corrupt pricebook_material/);
  });

  it("throws on a corrupt row (negative markup_bps violates the domain invariant)", () => {
    const row = baseRow();
    row.markupBps = -100;
    expect(() => rowToMaterial(row)).toThrow(/corrupt pricebook_material/);
  });
});
