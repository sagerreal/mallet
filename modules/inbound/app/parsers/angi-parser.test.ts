import { describe, it, expect } from "vitest";
import { AngiLeadParser } from "./angi-parser";
import { isErr } from "@mallet/shared/types";
const p = new AngiLeadParser();
const unwrap = <T>(r: { ok: true; value: T } | { ok: false }) => { if (!r.ok) throw new Error("err"); return r.value; };

const sample = {
  name: "Gary Pratt", primaryPhone: "(925) 555-0100", email: "gary@x.com",
  address: "1 Pine Rd", city: "Oakland", stateProvince: "CA", postalCode: "94601",
  taskName: "Water heater repair", comments: "No hot water since Tuesday",
  leadOid: 887766, srOid: 445, fee: 35.0,
};

describe("AngiLeadParser", () => {
  it("maps the documented Angi fields to a NormalizedLead", () => {
    const v = unwrap(p.parse(sample));
    expect(v.name).toBe("Gary Pratt");
    expect(v.phone).toBe("(925) 555-0100");
    expect(v.email).toBe("gary@x.com");
    expect(v.address).toBe("1 Pine Rd, Oakland CA 94601");
    expect(v.notes).toContain("Water heater repair");
    expect(v.notes).toContain("No hot water since Tuesday");
    expect(v.externalId).toBe("887766"); // leadOid as string — the idempotency key
  });
  it("falls back to firstName + lastName when name is absent", () => {
    const v = unwrap(p.parse({ ...sample, name: undefined, firstName: "Ann", lastName: "Lee" }));
    expect(v.name).toBe("Ann Lee");
  });
  it("rejects a payload with no name and no first/last", () => {
    expect(isErr(p.parse({ ...sample, name: undefined, firstName: undefined, lastName: undefined }))).toBe(true);
  });
  it("requires leadOid (the idempotency key)", () => {
    expect(isErr(p.parse({ ...sample, leadOid: undefined }))).toBe(true);
  });
  it("rejects a whitespace-only leadOid (would normalize to an empty idempotency key)", () => {
    expect(isErr(p.parse({ ...sample, leadOid: "   " }))).toBe(true);
  });
});
