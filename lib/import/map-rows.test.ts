import { describe, it, expect } from "vitest";
import { autoMap, buildImportRows } from "./map-rows";

describe("autoMap", () => {
  it("guesses common QuickBooks/Google headers, incl. split first/last name", () => {
    const m = autoMap(["First Name", "Last Name", "Phone", "Email Address", "Billing Address"]);
    expect(m.name).toBe("First Name");
    expect(m.lastName).toBe("Last Name");
    expect(m.phone).toBe("Phone");
    expect(m.email).toBe("Email Address");
    expect(m.address).toBe("Billing Address");
  });

  it("uses a single 'Customer' column as the name when there is no first/last", () => {
    const m = autoMap(["Customer", "Mobile", "E-mail"]);
    expect(m.name).toBe("Customer");
    expect(m.lastName).toBeNull();
    expect(m.phone).toBe("Mobile");
    expect(m.email).toBe("E-mail");
  });

  it("does not double-assign a header (email header not also grabbed as address)", () => {
    const m = autoMap(["Name", "Phone", "Email Address"]);
    expect(m.email).toBe("Email Address");
    expect(m.address).toBeNull();
  });

  it("gives a shared 'contact' header to phone, not name", () => {
    const m = autoMap(["Customer", "Contact Phone"]);
    expect(m.phone).toBe("Contact Phone");
    expect(m.name).toBe("Customer");
  });
});

describe("buildImportRows", () => {
  const map = { name: "First Name", lastName: "Last Name", phone: "Phone", email: "Email", address: "Address", notes: null, sourceTag: "Import" };

  it("combines first+last, tags source, keeps valid rows", () => {
    const out = buildImportRows(
      [{ "First Name": "Gary", "Last Name": "Pratt", Phone: "(925) 555-0100", Email: "g@x.com", Address: "1 Pine" }],
      map,
    );
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toEqual({ name: "Gary Pratt", phone: "(925) 555-0100", email: "g@x.com", address: "1 Pine", source: "Import", notes: null });
    expect(out.skipped).toHaveLength(0);
  });

  it("skips rows with no name", () => {
    const out = buildImportRows([{ "First Name": "", "Last Name": "" }], map);
    expect(out.rows).toHaveLength(0);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0]!.message).toMatch(/name/i);
  });

  it("warns and nulls an unreadable phone (row still imports)", () => {
    const out = buildImportRows([{ "First Name": "Ann", Phone: "call me maybe" }], map);
    expect(out.rows[0]!.phone).toBeNull();
    expect(out.warnings.some((w) => /phone/i.test(w.message))).toBe(true);
  });

  it("warns and nulls a malformed email (row still imports)", () => {
    const out = buildImportRows([{ "First Name": "Ann", Email: "not-an-email" }], map);
    expect(out.rows[0]!.email).toBeNull();
    expect(out.warnings.some((w) => /email/i.test(w.message))).toBe(true);
  });
});
