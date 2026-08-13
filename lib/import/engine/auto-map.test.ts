/**
 * lib/import/engine/auto-map.test.ts
 *
 * Header claiming. Targets are ordered by how specific they are (longest synonym first) and match
 * a header by SUBSTRING, which is what lets "Customer First Name" find `firstName`. The same
 * substring rule is how a supplier's "Unit Cost" column got eaten by `unitOfMeasure` — whose
 * synonym list includes a bare "unit" — leaving the cost unmapped and every material imported at
 * $0. An exact-header pass now runs first so a header that IS a field's name goes to that field.
 */
import { describe, it, expect } from "vitest";
import { autoMap } from "./auto-map";
import { MATERIAL_IMPORT, CUSTOMER_IMPORT } from "./descriptors";

describe("autoMap — exact header names win before substring matching", () => {
  it("gives a supplier's 'Unit Cost' column to the cost field, not to unit-of-measure", () => {
    const map = autoMap(["Name", "Unit Cost", "Sell Price"], MATERIAL_IMPORT);

    expect(map.unitCostCents).toBe("Unit Cost");
    expect(map.unitOfMeasure).not.toBe("Unit Cost");
  });

  it("still maps a real unit-of-measure column when one is present alongside cost", () => {
    const map = autoMap(["Name", "Unit of Measure", "Unit Cost"], MATERIAL_IMPORT);

    expect(map.unitOfMeasure).toBe("Unit of Measure");
    expect(map.unitCostCents).toBe("Unit Cost");
  });

  it("keeps the substring fallback for headers that only contain a synonym", () => {
    // "Material Unit" is nobody's exact name, so the old substring rule still has to place it.
    const map = autoMap(["Name", "Material Unit"], MATERIAL_IMPORT);

    expect(map.unitOfMeasure).toBe("Material Unit");
  });

  it("does not disturb specificity ordering on the customer sheet", () => {
    // "Last Name" (9) must keep beating "Name" (4) — the case the ordering exists for.
    const map = autoMap(["First Name", "Last Name", "Email"], CUSTOMER_IMPORT);

    expect(map.lastName).toBe("Last Name");
    expect(map.name).toBe("First Name");
  });
});
