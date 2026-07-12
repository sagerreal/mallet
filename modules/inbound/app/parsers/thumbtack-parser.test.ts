import { describe, it, expect } from "vitest";
import { ThumbtackLeadParser } from "./thumbtack-parser";
import { isErr } from "@mallet/shared/types";
const p = new ThumbtackLeadParser();
const unwrap = <T>(r: { ok: true; value: T } | { ok: false }) => { if (!r.ok) throw new Error("err"); return r.value; };

const sample = {
  leadID: "lead_abc123",
  customer: { customerID: "c1", name: "Maria Sanchez", phone: "925-555-0142" },
  request: {
    category: "Plumbing", title: "Leaky faucet", description: "Kitchen faucet drips",
    location: { city: "Fremont", state: "CA", zipCode: "94536" },
  },
};

describe("ThumbtackLeadParser", () => {
  it("maps the documented Thumbtack fields to a NormalizedLead", () => {
    const v = unwrap(p.parse(sample));
    expect(v.name).toBe("Maria Sanchez");
    expect(v.phone).toBe("925-555-0142");
    expect(v.email).toBeNull(); // Thumbtack does not provide email
    expect(v.address).toBe("Fremont CA 94536");
    expect(v.notes).toContain("Leaky faucet");
    expect(v.externalId).toBe("lead_abc123");
  });
  it("tolerates phone at the top level (docs are ambiguous on the exact path)", () => {
    const v = unwrap(p.parse({ ...sample, customer: { customerID: "c1", name: "Maria Sanchez" }, phone: "925-555-0142" }));
    expect(v.phone).toBe("925-555-0142");
  });
  it("rejects a payload with no customer name", () => {
    expect(isErr(p.parse({ ...sample, customer: { customerID: "c1" } }))).toBe(true);
  });
  it("requires leadID (the idempotency key)", () => {
    expect(isErr(p.parse({ ...sample, leadID: undefined }))).toBe(true);
  });
  it("rejects a whitespace-only leadID (would normalize to an empty idempotency key)", () => {
    expect(isErr(p.parse({ ...sample, leadID: "   " }))).toBe(true);
  });
});
