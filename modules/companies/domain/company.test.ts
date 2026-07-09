import { describe, it, expect } from "vitest";
import { asCompanyId, asOrgId, isOk } from "@mallet/shared/types";
import { Company, type CompanyProps } from "./company";

const baseProps = (overrides: Partial<CompanyProps> = {}): CompanyProps => ({
  id: asCompanyId("11111111-1111-1111-1111-111111111111"),
  orgId: asOrgId("22222222-2222-2222-2222-222222222222"),
  name: "Acme Corp",
  phone: null,
  email: null,
  website: null,
  address: null,
  notes: null,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  updatedAt: new Date("2026-07-01T00:00:00Z"),
  ...overrides,
});

const unwrap = (r: ReturnType<typeof Company.create>): Company => {
  if (!isOk(r)) throw new Error(`expected ok, got ${JSON.stringify(r.error)}`);
  return r.value;
};

describe("Company.create", () => {
  it("rejects an empty name", () => {
    const r = Company.create(baseProps({ name: "   " }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe("name");
  });

  it("trims the name", () => {
    const company = unwrap(Company.create(baseProps({ name: "  Acme Corp  " })));
    expect(company.props.name).toBe("Acme Corp");
  });

  it("accepts all nullable optional fields as null", () => {
    const company = unwrap(Company.create(baseProps()));
    expect(company.props.phone).toBeNull();
    expect(company.props.email).toBeNull();
    expect(company.props.website).toBeNull();
    expect(company.props.address).toBeNull();
    expect(company.props.notes).toBeNull();
  });

  it("accepts all optional fields populated", () => {
    const company = unwrap(
      Company.create(
        baseProps({
          phone: "+15551234567",
          email: "info@acme.com",
          website: "https://acme.com",
          address: "123 Main St",
          notes: "VIP client",
        }),
      ),
    );
    expect(company.props.phone).toBe("+15551234567");
    expect(company.props.email).toBe("info@acme.com");
    expect(company.props.website).toBe("https://acme.com");
    expect(company.props.address).toBe("123 Main St");
    expect(company.props.notes).toBe("VIP client");
  });
});

describe("Company.patch", () => {
  const now = new Date("2026-07-09T12:00:00Z");

  it("patches name and bumps updatedAt", () => {
    const company = unwrap(Company.create(baseProps({ name: "Acme Corp" })));
    const result = company.patch({ name: "Acme Corp Ltd" }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.name).toBe("Acme Corp Ltd");
      expect(result.value.props.updatedAt.toISOString()).toBe(now.toISOString());
    }
  });

  it("rejects an empty name in patch", () => {
    const company = unwrap(Company.create(baseProps()));
    const result = company.patch({ name: "   " }, now);
    expect(isOk(result)).toBe(false);
  });

  it("allows patching optional fields to null", () => {
    const company = unwrap(
      Company.create(baseProps({ phone: "+15551234567", notes: "Some notes" })),
    );
    const result = company.patch({ phone: null, notes: null }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.phone).toBeNull();
      expect(result.value.props.notes).toBeNull();
    }
  });

  it("undefined fields keep their current value", () => {
    const company = unwrap(
      Company.create(baseProps({ phone: "+15551234567", email: "x@example.com" })),
    );
    const result = company.patch({ name: "New Name" }, now);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.props.phone).toBe("+15551234567");
      expect(result.value.props.email).toBe("x@example.com");
    }
  });
});
