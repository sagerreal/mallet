import { describe, it, expect } from "vitest";
import { type ServiceRow, laborHoursToColumn, rowToService } from "./service-mapper";

// ── Fixtures ────────────────────────────────────────────────────────────────

const ORG_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ROW_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const baseRow = (): ServiceRow => ({
  id: ROW_ID,
  orgId: ORG_ID,
  categoryId: null,
  code: null,
  label: "Water Heater Install",
  description: null,
  unitPriceCents: 129900,
  costCents: 45000,
  laborHours: "2.50",
  taxable: true,
  warrantyText: null,
  imageUrl: null,
  isAddon: false,
  active: true,
  position: 0,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  deletedAt: null,
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("rowToService (service mapper)", () => {
  it("maps a valid DB row to a Service, name <- label", () => {
    const service = rowToService(baseRow());
    const p = service.props;

    expect(p.name).toBe("Water Heater Install");
    expect(p.unitPriceCents).toBe(129900);
    expect(p.costCents).toBe(45000);
    expect(p.taxable).toBe(true);
    expect(p.active).toBe(true);
  });

  it("converts the numeric(5,2) labor_hours string to a number", () => {
    const service = rowToService(baseRow());
    expect(service.props.laborHours).toBe(2.5);
    expect(typeof service.props.laborHours).toBe("number");
  });

  it("passes through a null labor_hours as null (not NaN or 0)", () => {
    const row = baseRow();
    row.laborHours = null;
    const service = rowToService(row);
    expect(service.props.laborHours).toBeNull();
  });

  it("throws on a corrupt row (empty label violates the domain invariant)", () => {
    const row = baseRow();
    row.label = "";
    expect(() => rowToService(row)).toThrow(/corrupt pricebook_item/);
  });

  it("throws on a corrupt row (negative unit price violates the domain invariant)", () => {
    const row = baseRow();
    row.unitPriceCents = -1;
    expect(() => rowToService(row)).toThrow(/corrupt pricebook_item/);
  });
});

describe("laborHoursToColumn (write-side conversion)", () => {
  it("stringifies a number for the numeric column", () => {
    expect(laborHoursToColumn(2.5)).toBe("2.5");
  });

  it("passes null through as null", () => {
    expect(laborHoursToColumn(null)).toBeNull();
  });

  it("round-trips through rowToService", () => {
    const row = baseRow();
    row.laborHours = laborHoursToColumn(1.75);
    expect(rowToService(row).props.laborHours).toBe(1.75);
  });
});
