import { describe, it, expect } from "vitest";
import { autoMapService, buildServiceImportRows } from "./map-service-rows";

describe("autoMapService", () => {
  it("guesses common Housecall Pro / Jobber headers", () => {
    const m = autoMapService(["Service Name", "Category", "Description", "Code", "Customer Price", "Our Cost", "Taxable"]);
    expect(m.name).toBe("Service Name");
    expect(m.category).toBe("Category");
    expect(m.description).toBe("Description");
    expect(m.code).toBe("Code");
    expect(m.price).toBe("Customer Price");
    expect(m.cost).toBe("Our Cost");
    expect(m.taxable).toBe("Taxable");
  });

  it("claims 'Item code' for code before 'Item' is grabbed as name", () => {
    const m = autoMapService(["Item", "Item code"]);
    expect(m.code).toBe("Item code");
    expect(m.name).toBe("Item");
  });

  it("does not double-assign a header (price header not also grabbed as cost)", () => {
    const m = autoMapService(["Task", "Price"]);
    expect(m.price).toBe("Price");
    expect(m.cost).toBeNull();
  });

  it("matches a bare 'Name' header only when no more specific name synonym exists", () => {
    const m = autoMapService(["Name", "Type"]);
    expect(m.name).toBe("Name");
    expect(m.category).toBe("Type");
  });

  it("matches 'SKU' for code and 'Rate' for price", () => {
    const m = autoMapService(["Task", "SKU", "Rate", "Material Cost"]);
    expect(m.code).toBe("SKU");
    expect(m.price).toBe("Rate");
    expect(m.cost).toBe("Material Cost");
  });
});

describe("buildServiceImportRows", () => {
  const map = {
    name: "Service Name",
    category: "Category",
    description: "Description",
    code: "Code",
    price: "Price",
    cost: "Cost",
    taxable: "Taxable",
  };

  it("maps a clean row with all fields", () => {
    const out = buildServiceImportRows(
      [
        {
          "Service Name": "Water Heater Install",
          Category: "Plumbing",
          Description: "Install a new water heater",
          Code: "WH-100",
          Price: "$2,400",
          Cost: "1,200.50",
          Taxable: "Yes",
        },
      ],
      map,
    );
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toEqual({
      name: "Water Heater Install",
      category: "Plumbing",
      description: "Install a new water heater",
      code: "WH-100",
      unitPriceCents: 240000,
      costCents: 120050,
      taxable: true,
    });
    expect(out.skipped).toHaveLength(0);
    expect(out.warnings).toHaveLength(0);
  });

  it("skips a row with no name", () => {
    const out = buildServiceImportRows([{ "Service Name": "", Price: "$10" }], map);
    expect(out.rows).toHaveLength(0);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0]!.message).toMatch(/name/i);
  });

  it("warns and imports at 0 when price is unparseable", () => {
    const out = buildServiceImportRows([{ "Service Name": "Drain Cleaning", Price: "call for quote" }], map);
    expect(out.rows[0]!.unitPriceCents).toBe(0);
    expect(out.warnings.some((w) => /price/i.test(w.message))).toBe(true);
  });

  it("does not warn when price is simply blank", () => {
    const out = buildServiceImportRows([{ "Service Name": "Drain Cleaning", Price: "" }], map);
    expect(out.rows[0]!.unitPriceCents).toBe(0);
    expect(out.warnings).toHaveLength(0);
  });

  it("warns and imports cost at 0 when cost is unparseable", () => {
    const out = buildServiceImportRows([{ "Service Name": "Drain Cleaning", Cost: "n/a" }], map);
    expect(out.rows[0]!.costCents).toBe(0);
    expect(out.warnings.some((w) => /cost/i.test(w.message))).toBe(true);
  });

  it("parses taxable variants", () => {
    const yes = buildServiceImportRows([{ "Service Name": "A", Taxable: "Yes" }], map);
    const no = buildServiceImportRows([{ "Service Name": "B", Taxable: "no" }], map);
    const blank = buildServiceImportRows([{ "Service Name": "C", Taxable: "" }], map);
    const one = buildServiceImportRows([{ "Service Name": "D", Taxable: "1" }], map);
    expect(yes.rows[0]!.taxable).toBe(true);
    expect(no.rows[0]!.taxable).toBe(false);
    expect(blank.rows[0]!.taxable).toBe(false);
    expect(one.rows[0]!.taxable).toBe(true);
  });

  it("nulls category/code/description when blank", () => {
    const out = buildServiceImportRows([{ "Service Name": "Bare Service" }], map);
    expect(out.rows[0]!.category).toBeNull();
    expect(out.rows[0]!.code).toBeNull();
    expect(out.rows[0]!.description).toBeNull();
  });

  it("clamps overlong fields to the server's length limits", () => {
    const out = buildServiceImportRows(
      [
        {
          "Service Name": "N".repeat(600),
          Category: "C".repeat(300),
          Code: "X".repeat(200),
          Description: "D".repeat(10500),
        },
      ],
      map,
    );
    expect(out.rows[0]!.name).toHaveLength(500);
    expect(out.rows[0]!.category).toHaveLength(255);
    expect(out.rows[0]!.code).toHaveLength(120);
    expect(out.rows[0]!.description).toHaveLength(10000);
  });
});
