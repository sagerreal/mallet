import { describe, it, expect } from "vitest";
import { toQboCustomer, NO_NAME, NAME_TOO_LONG, type SyncableCustomer } from "./customer-mapping";

const customer = (over: Partial<SyncableCustomer> = {}): SyncableCustomer => ({
  id: "lead-1",
  name: "Dave's Plumbing",
  email: "dave@example.com",
  phone: "555-0100",
  address: "12 Mill Lane, Springfield",
  ...over,
});

describe("toQboCustomer", () => {
  it("carries the fields QuickBooks can hold", () => {
    const r = toQboCustomer(customer());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      displayName: "Dave's Plumbing",
      email: "dave@example.com",
      phone: "555-0100",
      addressLine1: "12 Mill Lane, Springfield",
    });
  });

  it("trims, and treats whitespace-only optional fields as absent", () => {
    const r = toQboCustomer(customer({ name: "  Acme  ", email: "   ", phone: "", address: "  " }));
    expect(r.ok && r.value).toEqual({
      displayName: "Acme",
      email: null,
      phone: null,
      addressLine1: null,
    });
  });

  it("refuses a customer with no name to file under", () => {
    const r = toQboCustomer(customer({ name: "   " }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe(NO_NAME);
  });

  /**
   * Reported, never truncated. A customer filed under a clipped name is one nobody can find again,
   * and QuickBooks would reject it anyway — this turns a remote 400 into a local message that
   * names the customer.
   */
  it("refuses a name longer than QuickBooks allows rather than shortening it", () => {
    const r = toQboCustomer(customer({ name: "x".repeat(101) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.field).toBe(NAME_TOO_LONG);
  });

  it("allows a name exactly at the limit", () => {
    expect(toQboCustomer(customer({ name: "x".repeat(100) })).ok).toBe(true);
  });

  // Mallet holds one free-text address; QuickBooks wants structured parts. Guessing at them would
  // invent a sales-tax jurisdiction, so the whole string goes to Line1 untouched.
  it("passes the address through as one unparsed line", () => {
    const r = toQboCustomer(customer({ address: "Unit 4, 7 High St, Springfield IL 62704" }));
    expect(r.ok && r.value.addressLine1).toBe("Unit 4, 7 High St, Springfield IL 62704");
  });
});
