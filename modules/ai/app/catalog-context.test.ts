import { describe, it, expect } from "vitest";
import { asServiceId, asCategoryId, asOrgId } from "@mallet/shared/types";
import type { ServiceProps, CategoryProps } from "@mallet/pricebook";
import { toCatalogContext } from "./catalog-context";

// ── fixtures ──────────────────────────────────────────────────────────────────

const ORG = asOrgId("22222222-2222-2222-2222-222222222222");
const CAT_WATER_HEATERS = asCategoryId("33333333-3333-3333-3333-333333333333");

const baseService = (overrides: Partial<ServiceProps> = {}): ServiceProps => ({
  id: asServiceId("11111111-1111-1111-1111-111111111111"),
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
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...overrides,
});

const baseCategory = (overrides: Partial<CategoryProps> = {}): CategoryProps => ({
  id: CAT_WATER_HEATERS,
  orgId: ORG,
  parentId: null,
  name: "Water Heaters",
  sortOrder: 0,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...overrides,
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe("toCatalogContext", () => {
  it("maps name/unitPriceCents and resolves categoryId to the category's name", () => {
    const services = [baseService({ categoryId: CAT_WATER_HEATERS })];
    const categories = [baseCategory()];

    const result = toCatalogContext(services, categories);

    expect(result).toEqual([
      { name: "Water Heater Install", unitPriceCents: 150000, category: "Water Heaters", laborHours: null },
    ]);
  });

  it("maps category to null when the service has no categoryId", () => {
    const services = [baseService({ categoryId: null })];

    const result = toCatalogContext(services, []);

    expect(result).toEqual([{ name: "Water Heater Install", unitPriceCents: 150000, category: null, laborHours: null }]);
  });

  it("maps category to null when categoryId doesn't resolve to any known category (orphaned reference)", () => {
    const services = [baseService({ categoryId: "99999999-9999-9999-9999-999999999999" })];

    const result = toCatalogContext(services, [baseCategory()]);

    expect(result).toEqual([{ name: "Water Heater Install", unitPriceCents: 150000, category: null, laborHours: null }]);
  });

  it("excludes inactive services from the catalog context", () => {
    const services = [
      baseService({ id: asServiceId("11111111-1111-1111-1111-111111111111"), name: "Active service", active: true }),
      baseService({ id: asServiceId("44444444-4444-4444-4444-444444444444"), name: "Archived-from-sale service", active: false }),
    ];

    const result = toCatalogContext(services, []);

    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Active service");
  });

  it("returns an empty array when there are no services", () => {
    expect(toCatalogContext([], [baseCategory()])).toEqual([]);
  });
});
