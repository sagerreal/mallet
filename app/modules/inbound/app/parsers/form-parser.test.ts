import { describe, it, expect } from "vitest";
import { FormLeadParser } from "./form-parser";
import { isOk, isErr } from "@mallet/shared/types";

const parser = new FormLeadParser();
const unwrap = <T>(r: { ok: true; value: T } | { ok: false }) => { if (!r.ok) throw new Error("err"); return r.value; };

describe("FormLeadParser", () => {
  it("normalizes a valid form submission (externalId null — form has none)", () => {
    const r = parser.parse({ name: "  Gary Pratt ", phone: "(925) 555-0100", email: "g@x.com", address: "1 Pine", notes: "leak" });
    expect(isOk(r)).toBe(true);
    const v = unwrap(r as never);
    expect(v).toEqual({ name: "Gary Pratt", phone: "(925) 555-0100", email: "g@x.com", address: "1 Pine", notes: "leak", externalId: null });
  });
  it("rejects a submission with no name", () => {
    expect(isErr(parser.parse({ name: "   ", phone: "5", email: "", address: "", notes: "" }))).toBe(true);
  });
  it("coerces missing optional fields to null", () => {
    const v = unwrap(parser.parse({ name: "Ann" }) as never);
    expect(v).toEqual({ name: "Ann", phone: null, email: null, address: null, notes: null, externalId: null });
  });
});
