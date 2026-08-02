import { describe, it, expect } from "vitest";
import { asAssemblyId, asOrgId } from "@mallet/shared/types";
import { Assembly, type AssemblyProps } from "./assembly";
import { catalogAssemblyByKey } from "./assembly-defaults";

const driveway = catalogAssemblyByKey("driveway_replacement_3in")!;
const sealcoat = catalogAssemblyByKey("sealcoat_two_coats")!;

const base: AssemblyProps = {
  id: asAssemblyId("a1"),
  orgId: asOrgId("o1"),
  catalogKey: driveway.catalogKey,
  name: driveway.name,
  measurementBasis: driveway.measurementBasis,
  pricingMode: driveway.pricingMode,
  marginBps: driveway.marginBps,
  jobMinimumCents: driveway.jobMinimumCents,
  config: driveway.config,
  active: true,
  position: 0,
  createdAt: new Date("2026-08-01T00:00:00Z"),
  updatedAt: new Date("2026-08-01T00:00:00Z"),
};

describe("Assembly.create", () => {
  it("accepts a catalog-shaped assembly and trims the name", () => {
    const result = Assembly.create({ ...base, name: "  Driveway replacement, 3-inch  " });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.props.name).toBe("Driveway replacement, 3-inch");
  });

  it("rejects an empty name, an out-of-range margin, a negative minimum", () => {
    expect(Assembly.create({ ...base, name: "  " }).ok).toBe(false);
    expect(Assembly.create({ ...base, marginBps: 40_001 }).ok).toBe(false);
    expect(Assembly.create({ ...base, marginBps: 2500.5 }).ok).toBe(false);
    expect(Assembly.create({ ...base, jobMinimumCents: -1 }).ok).toBe(false);
  });

  it("accepts the line basis; rejects a count assembly priced unit-rate", () => {
    // Line assemblies price from classed roof linears — live since the roofing
    // recipes PR.
    expect(Assembly.create({ ...base, measurementBasis: "line" }).ok).toBe(true);
    expect(Assembly.create({ ...base, measurementBasis: "count" }).ok).toBe(true);
    const result = Assembly.create({
      ...base,
      measurementBasis: "count",
      pricingMode: "unit_rate",
      config: sealcoat.config, // has tiers, so only the count×unit_rate rule can fail
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("measurementBasis");
  });

  it("rejects a unit-rate assembly with no rate brackets", () => {
    const result = Assembly.create({
      ...base,
      pricingMode: "unit_rate",
      config: { ...driveway.config, tiers: null },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("config");
  });

  it("runs the config blob through the versioned schema (bad blob → validation err)", () => {
    const bad = {
      ...base,
      config: { version: 1, components: [], tiers: null } as unknown as AssemblyProps["config"],
    };
    const result = Assembly.create(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe("config");
  });
});

describe("Assembly.patch", () => {
  it("patches immutably and re-validates", () => {
    const created = Assembly.create(base);
    if (!created.ok) throw new Error("setup");
    const now = new Date("2026-08-02T00:00:00Z");
    const patched = created.value.patch({ marginBps: 3000, config: sealcoat.config }, now);
    expect(patched.ok).toBe(true);
    if (patched.ok) {
      expect(patched.value.props.marginBps).toBe(3000);
      expect(patched.value.props.updatedAt).toBe(now);
      expect(created.value.props.marginBps).toBe(2500);
    }
  });

  it("a patch that breaks an invariant fails without touching the original", () => {
    const created = Assembly.create(base);
    if (!created.ok) throw new Error("setup");
    const patched = created.value.patch({ name: "" }, new Date());
    expect(patched.ok).toBe(false);
    expect(created.value.props.name).toBe(driveway.name);
  });
});
