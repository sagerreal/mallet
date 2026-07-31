import { describe, it, expect } from "vitest";
import { asMaterialId, asOrgId, isOk } from "@mallet/shared/types";
import { Material, type MaterialProps } from "./material";

const baseProps = (overrides: Partial<MaterialProps> = {}): MaterialProps => ({
  id: asMaterialId("11111111-1111-1111-1111-111111111111"),
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
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

const unwrap = (r: ReturnType<typeof Material.create>): Material => {
  if (!isOk(r)) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};

describe("Material.create", () => {
  it("rejects an empty name", () => {
    const r = Material.create(baseProps({ name: "   " }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("name");
  });

  it("trims the name", () => {
    const material = unwrap(Material.create(baseProps({ name: "  1/2in Copper Pipe  " })));
    expect(material.props.name).toBe("1/2in Copper Pipe");
  });

  it("rejects a negative unitCostCents", () => {
    const r = Material.create(baseProps({ unitCostCents: -1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("unitCostCents");
  });

  it("rejects a negative markupBps", () => {
    const r = Material.create(baseProps({ markupBps: -1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("markupBps");
  });

  it("accepts a null markupBps", () => {
    const material = unwrap(Material.create(baseProps({ markupBps: null })));
    expect(material.props.markupBps).toBeNull();
  });

  it("accepts a valid non-negative markupBps", () => {
    const material = unwrap(Material.create(baseProps({ markupBps: 3500 })));
    expect(material.props.markupBps).toBe(3500);
  });

  it("accepts a valid row", () => {
    const material = unwrap(Material.create(baseProps()));
    expect(material.props.unitCostCents).toBe(250);
    expect(material.props.unitOfMeasure).toBe("each");
  });

  it("accepts all nullable optional fields as null", () => {
    const material = unwrap(Material.create(baseProps()));
    expect(material.props.categoryId).toBeNull();
    expect(material.props.code).toBeNull();
    expect(material.props.description).toBeNull();
    expect(material.props.markupBps).toBeNull();
    expect(material.props.vendor).toBeNull();
  });

  it("accepts all optional fields populated", () => {
    const material = unwrap(
      Material.create(
        baseProps({
          categoryId: "33333333-3333-3333-3333-333333333333",
          code: "CU-1-2",
          description: "Type L copper, 1/2 inch",
          markupBps: 4000,
          vendor: "Ferguson",
        }),
      ),
    );
    expect(material.props.categoryId).toBe("33333333-3333-3333-3333-333333333333");
    expect(material.props.code).toBe("CU-1-2");
    expect(material.props.description).toBe("Type L copper, 1/2 inch");
    expect(material.props.markupBps).toBe(4000);
    expect(material.props.vendor).toBe("Ferguson");
  });
});

describe("Material.patch", () => {
  const now = new Date("2026-07-12T12:00:00Z");

  it("patches unitCostCents and bumps updatedAt, leaving other fields intact", () => {
    const material = unwrap(Material.create(baseProps({ name: "1/2in Copper Pipe" })));
    const result = material.patch({ unitCostCents: 300 }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.unitCostCents).toBe(300);
      expect(result.value.props.name).toBe("1/2in Copper Pipe");
      expect(result.value.props.updatedAt.toISOString()).toBe(now.toISOString());
    }
  });

  it("rejects an empty name in patch", () => {
    const material = unwrap(Material.create(baseProps()));
    const result = material.patch({ name: "   " }, now);
    expect(isOk(result)).toBe(false);
  });

  it("rejects a negative unitCostCents in patch", () => {
    const material = unwrap(Material.create(baseProps()));
    const result = material.patch({ unitCostCents: -50 }, now);
    expect(isOk(result)).toBe(false);
  });

  it("rejects a negative markupBps in patch", () => {
    const material = unwrap(Material.create(baseProps()));
    const result = material.patch({ markupBps: -10 }, now);
    expect(isOk(result)).toBe(false);
  });

  it("allows patching optional fields to null", () => {
    const material = unwrap(
      Material.create(baseProps({ code: "CU-1-2", description: "Some notes", markupBps: 2000 })),
    );
    const result = material.patch({ code: null, description: null, markupBps: null }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.code).toBeNull();
      expect(result.value.props.description).toBeNull();
      expect(result.value.props.markupBps).toBeNull();
    }
  });

  it("undefined fields keep their current value", () => {
    const material = unwrap(
      Material.create(baseProps({ code: "CU-1-2", taxable: true, vendor: "Ferguson" })),
    );
    const result = material.patch({ name: "New Name" }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.code).toBe("CU-1-2");
      expect(result.value.props.taxable).toBe(true);
      expect(result.value.props.vendor).toBe("Ferguson");
    }
  });
});
