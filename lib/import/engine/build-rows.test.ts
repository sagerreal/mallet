/**
 * Behaviour tests for the import engine.
 *
 * These assertions were carried over verbatim from the hand-written mappers this engine replaces
 * (map-rows.ts, map-service-rows.ts) and were run against BOTH implementations during the
 * refactor to prove byte-identical output. The comparison harness is gone with the old files;
 * the contract it protected lives here.
 *
 * The last block is the reason the engine exists: a new field is a descriptor entry, not code.
 */

import { describe, it, expect } from "vitest";
import { autoMap } from "./auto-map";
import { buildRows } from "./build-rows";
import { CUSTOMER_IMPORT, SERVICE_IMPORT } from "./descriptors";
import type { ImportDescriptor } from "./descriptor";

// ── customers ────────────────────────────────────────────────────────────────

const CUSTOMER_HEADERS = ["First Name", "Last Name", "Phone", "Email", "Billing Address", "Notes"];

const customerRecords: Record<string, string>[] = [
  {
    "First Name": "Ann", "Last Name": "Lee", Phone: "(925) 555-0100",
    Email: "ann@example.com", "Billing Address": "1 Pine Rd", Notes: "Gate code 4412",
  },
  // Unreadable phone AND email → two warnings, row still imports.
  {
    "First Name": "Bob", "Last Name": "", Phone: "555", Email: "not-an-email",
    "Billing Address": "", Notes: "",
  },
  // No name at all → skipped.
  {
    "First Name": "", "Last Name": "", Phone: "(925) 555-0102", Email: "x@y.com",
    "Billing Address": "9 Oak St", Notes: "",
  },
];

const buildCustomers = () =>
  buildRows(customerRecords, autoMap(CUSTOMER_HEADERS, CUSTOMER_IMPORT), CUSTOMER_IMPORT);

describe("customers import", () => {
  it("auto-maps split first/last name without either claiming the other's column", () => {
    const map = autoMap(CUSTOMER_HEADERS, CUSTOMER_IMPORT);
    expect(map.name).toBe("First Name");
    expect(map.lastName).toBe("Last Name");
    expect(map.phone).toBe("Phone");
    expect(map.email).toBe("Email");
    expect(map.address).toBe("Billing Address");
    expect(map.notes).toBe("Notes");
  });

  it("joins first + last name, leaving no trailing space when last is absent", () => {
    const built = buildCustomers();
    expect(built.rows[0]!.name).toBe("Ann Lee");
    expect(built.rows[1]!.name).toBe("Bob");
  });

  it("keeps a row whose phone and email are both unreadable, dropping only those fields", () => {
    const built = buildCustomers();
    const bob = built.rows.find((r) => r.name === "Bob")!;
    expect(bob).toBeDefined();
    expect(bob.phone).toBeNull();
    expect(bob.email).toBeNull();
    expect(built.warnings.filter((w) => w.rowIndex === 1)).toHaveLength(2);
  });

  it("skips a nameless row rather than failing the batch", () => {
    const built = buildCustomers();
    expect(built.skipped).toHaveLength(1);
    expect(built.skipped[0]!.rowIndex).toBe(2);
    expect(built.skipped[0]!.message).toBe("No name — row skipped.");
    expect(built.rows).toHaveLength(2);
  });

  it("applies the source constant to every row", () => {
    const built = buildCustomers();
    expect(built.rows.every((r) => r.source === "Import")).toBe(true);
  });

  it("clamps values to the server's bounds so one long cell can't reject the batch", () => {
    const long = "x".repeat(900);
    const built = buildRows(
      [{ "First Name": long, "Last Name": "", Phone: "", Email: "", "Billing Address": long, Notes: "" }],
      autoMap(CUSTOMER_HEADERS, CUSTOMER_IMPORT),
      CUSTOMER_IMPORT,
    );
    expect((built.rows[0]!.name as string).length).toBe(255);
    expect((built.rows[0]!.address as string).length).toBe(500);
  });
});

// ── services ─────────────────────────────────────────────────────────────────

const SERVICE_HEADERS = ["Item Code", "Service Name", "Category", "Price", "Our Cost", "Description", "Taxable"];

const serviceRecords: Record<string, string>[] = [
  {
    "Item Code": "WH-50", "Service Name": "Water heater swap", Category: "Water heaters",
    Price: "$1,250.00", "Our Cost": "$620", Description: "50 gal", Taxable: "yes",
  },
  // Unreadable price → warning, imported at $0 (NOT skipped).
  {
    "Item Code": "DR-01", "Service Name": "Drain clear", Category: "Drains",
    Price: "call for price", "Our Cost": "", Description: "", Taxable: "no",
  },
  // No name → skipped.
  {
    "Item Code": "XX", "Service Name": "", Category: "", Price: "10",
    "Our Cost": "", Description: "", Taxable: "",
  },
];

const buildServices = () =>
  buildRows(serviceRecords, autoMap(SERVICE_HEADERS, SERVICE_IMPORT), SERVICE_IMPORT);

describe("services import", () => {
  it("claims 'Item Code' for code before name's 'item' synonym can take it", () => {
    const map = autoMap(SERVICE_HEADERS, SERVICE_IMPORT);
    expect(map.code).toBe("Item Code");
    expect(map.name).toBe("Service Name");
    expect(map.unitPriceCents).toBe("Price");
    expect(map.costCents).toBe("Our Cost");
  });

  it("parses money to integer cents", () => {
    const built = buildServices();
    expect(built.rows[0]!.unitPriceCents).toBe(125_000);
    expect(built.rows[0]!.costCents).toBe(62_000);
  });

  it("falls back to $0 on an unreadable price instead of dropping the row", () => {
    const built = buildServices();
    const drain = built.rows.find((r) => r.name === "Drain clear")!;
    expect(drain).toBeDefined();
    expect(drain.unitPriceCents).toBe(0);
    expect(built.warnings.some((w) => w.rowIndex === 1)).toBe(true);
  });

  it("defaults a blank cost to zero without warning", () => {
    const built = buildServices();
    expect(built.rows[1]!.costCents).toBe(0);
    expect(built.warnings.filter((w) => w.rowIndex === 1)).toHaveLength(1); // price only
  });

  it("coerces taxable spellings", () => {
    const built = buildServices();
    expect(built.rows[0]!.taxable).toBe(true);
    expect(built.rows[1]!.taxable).toBe(false);
  });

  it("skips a nameless row", () => {
    const built = buildServices();
    expect(built.skipped).toHaveLength(1);
    expect(built.rows).toHaveLength(2);
  });
});

// ── the extensibility claim ──────────────────────────────────────────────────

describe("adding a field needs no engine change", () => {
  const withLeadTime: ImportDescriptor = {
    ...SERVICE_IMPORT,
    fields: [
      ...SERVICE_IMPORT.fields,
      { key: "leadTimeDays", label: "Lead time", synonyms: ["lead time", "days"], coerce: "integer" },
    ],
  };
  const headers = [...SERVICE_HEADERS, "Lead Time"];

  it("imports a new field declared only in a descriptor", () => {
    const built = buildRows(
      [{ ...serviceRecords[0]!, "Lead Time": "3" }],
      autoMap(headers, withLeadTime),
      withLeadTime,
    );
    expect(built.rows[0]!.leadTimeDays).toBe(3);
  });

  it("warns rather than failing when the new field is unreadable", () => {
    const built = buildRows(
      [{ ...serviceRecords[0]!, "Lead Time": "about a week" }],
      autoMap(headers, withLeadTime),
      withLeadTime,
    );
    expect(built.rows).toHaveLength(1);
    expect(built.rows[0]!.leadTimeDays).toBeNull();
    expect(built.warnings).toHaveLength(1);
  });

  it("leaves the new field null when its column is absent entirely", () => {
    const built = buildRows(
      [serviceRecords[0]!],
      autoMap(SERVICE_HEADERS, withLeadTime),
      withLeadTime,
    );
    expect(built.rows[0]!.leadTimeDays).toBeNull();
    expect(built.warnings).toHaveLength(0);
  });
});
