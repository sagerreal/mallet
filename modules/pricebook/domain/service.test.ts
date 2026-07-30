import { describe, it, expect } from "vitest";
import { asServiceId, asOrgId, isOk } from "@mallet/shared/types";
import { Service, type ServiceProps } from "./service";

const baseProps = (overrides: Partial<ServiceProps> = {}): ServiceProps => ({
  id: asServiceId("11111111-1111-1111-1111-111111111111"),
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
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
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...overrides,
});

const unwrap = (r: ReturnType<typeof Service.create>): Service => {
  if (!isOk(r)) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};

describe("Service.create", () => {
  it("rejects an empty name", () => {
    const r = Service.create(baseProps({ name: "   " }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("name");
  });

  it("trims the name", () => {
    const service = unwrap(Service.create(baseProps({ name: "  Water Heater Install  " })));
    expect(service.props.name).toBe("Water Heater Install");
  });

  it("rejects a negative unitPriceCents", () => {
    const r = Service.create(baseProps({ unitPriceCents: -1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("unitPriceCents");
  });

  it("rejects a negative costCents", () => {
    const r = Service.create(baseProps({ costCents: -1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("costCents");
  });

  it("accepts a valid row", () => {
    const service = unwrap(Service.create(baseProps()));
    expect(service.props.unitPriceCents).toBe(150000);
    expect(service.props.costCents).toBe(90000);
  });

  it("accepts all nullable optional fields as null", () => {
    const service = unwrap(Service.create(baseProps()));
    expect(service.props.categoryId).toBeNull();
    expect(service.props.code).toBeNull();
    expect(service.props.description).toBeNull();
    expect(service.props.laborHours).toBeNull();
    expect(service.props.warrantyText).toBeNull();
    expect(service.props.imageUrl).toBeNull();
  });

  it("accepts all optional fields populated", () => {
    const service = unwrap(
      Service.create(
        baseProps({
          categoryId: "33333333-3333-3333-3333-333333333333",
          code: "WH-INSTALL",
          description: "Standard tank swap",
          laborHours: 2.5,
          warrantyText: "1 year parts and labor",
          imageUrl: "https://example.com/wh.jpg",
        }),
      ),
    );
    expect(service.props.categoryId).toBe("33333333-3333-3333-3333-333333333333");
    expect(service.props.code).toBe("WH-INSTALL");
    expect(service.props.description).toBe("Standard tank swap");
    expect(service.props.laborHours).toBe(2.5);
    expect(service.props.warrantyText).toBe("1 year parts and labor");
    expect(service.props.imageUrl).toBe("https://example.com/wh.jpg");
  });
});

describe("Service.create measuredBy", () => {
  it("accepts null (flat price — unchanged semantics)", () => {
    const service = unwrap(Service.create(baseProps({ measuredBy: null })));
    expect(service.props.measuredBy).toBeNull();
  });

  it("accepts each of the 6 valid painting quantity kinds", () => {
    const kinds = [
      "walls_sqft",
      "ceiling_sqft",
      "baseboard_lnft",
      "crown_lnft",
      "doors_count",
      "windows_count",
    ] as const;
    for (const kind of kinds) {
      const r = Service.create(baseProps({ measuredBy: kind }));
      expect(isOk(r)).toBe(true);
      if (isOk(r)) expect(r.value.props.measuredBy).toBe(kind);
    }
  });

  it("rejects a garbage measuredBy value", () => {
    const r = Service.create(baseProps({ measuredBy: "square_footage" as never }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("measuredBy");
  });
});

describe("Service.patch", () => {
  const now = new Date("2026-07-09T12:00:00Z");

  it("patches unitPriceCents and bumps updatedAt, leaving other fields intact", () => {
    const service = unwrap(Service.create(baseProps({ name: "Water Heater Install" })));
    const result = service.patch({ unitPriceCents: 175000 }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.unitPriceCents).toBe(175000);
      expect(result.value.props.name).toBe("Water Heater Install");
      expect(result.value.props.costCents).toBe(90000);
      expect(result.value.props.updatedAt.toISOString()).toBe(now.toISOString());
    }
  });

  it("rejects an empty name in patch", () => {
    const service = unwrap(Service.create(baseProps()));
    const result = service.patch({ name: "   " }, now);
    expect(isOk(result)).toBe(false);
  });

  it("rejects a negative unitPriceCents in patch", () => {
    const service = unwrap(Service.create(baseProps()));
    const result = service.patch({ unitPriceCents: -50 }, now);
    expect(isOk(result)).toBe(false);
  });

  it("allows patching optional fields to null", () => {
    const service = unwrap(
      Service.create(baseProps({ code: "WH-1", description: "Some notes" })),
    );
    const result = service.patch({ code: null, description: null }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.code).toBeNull();
      expect(result.value.props.description).toBeNull();
    }
  });

  it("undefined fields keep their current value", () => {
    const service = unwrap(
      Service.create(baseProps({ code: "WH-1", taxable: true, isAddon: true })),
    );
    const result = service.patch({ name: "New Name" }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.code).toBe("WH-1");
      expect(result.value.props.taxable).toBe(true);
      expect(result.value.props.isAddon).toBe(true);
    }
  });

  it("patches measuredBy to a valid kind", () => {
    const service = unwrap(Service.create(baseProps({ measuredBy: null })));
    const result = service.patch({ measuredBy: "walls_sqft" }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.measuredBy).toBe("walls_sqft");
  });

  it("patches measuredBy back to null", () => {
    const service = unwrap(Service.create(baseProps({ measuredBy: "walls_sqft" })));
    const result = service.patch({ measuredBy: null }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.measuredBy).toBeNull();
  });

  it("undefined measuredBy in patch keeps current value", () => {
    const service = unwrap(Service.create(baseProps({ measuredBy: "crown_lnft" })));
    const result = service.patch({ name: "New Name" }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value.props.measuredBy).toBe("crown_lnft");
  });

  it("rejects a garbage measuredBy in patch", () => {
    const service = unwrap(Service.create(baseProps({ measuredBy: null })));
    const result = service.patch({ measuredBy: "bogus_kind" as never }, now);
    expect(isOk(result)).toBe(false);
  });
});
