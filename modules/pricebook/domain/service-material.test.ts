import { describe, it, expect } from "vitest";
import { asMaterialId, asOrgId, asServiceId, isOk } from "@mallet/shared/types";
import { ServiceMaterial, type ServiceMaterialProps } from "./service-material";

const baseProps = (overrides: Partial<ServiceMaterialProps> = {}): ServiceMaterialProps => ({
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
  serviceId: asServiceId("11111111-1111-1111-1111-111111111111"),
  materialId: asMaterialId("33333333-3333-3333-3333-333333333333"),
  quantity: 2,
  ...overrides,
});

describe("ServiceMaterial.create", () => {
  it("rejects a zero quantity", () => {
    const r = ServiceMaterial.create(baseProps({ quantity: 0 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("quantity");
  });

  it("rejects a negative quantity", () => {
    const r = ServiceMaterial.create(baseProps({ quantity: -1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("quantity");
  });

  it("accepts a positive quantity", () => {
    const r = ServiceMaterial.create(baseProps({ quantity: 2.5 }));
    expect(isOk(r)).toBe(true);
    if (isOk(r)) expect(r.value.props.quantity).toBe(2.5);
  });
});
