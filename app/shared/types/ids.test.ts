import { describe, it, expect } from "vitest";
import { Phone } from "./ids";
import { isOk, isErr } from "./result";

describe("Phone.parse", () => {
  it("normalizes a formatted US number to E.164", () => {
    const result = Phone.parse("(555) 123-4567");
    expect(isOk(result)).toBe(true);
    if (result.ok) expect(result.value).toBe("+15551234567");
  });

  it("strips a leading country code", () => {
    const result = Phone.parse("1 (925) 555-0182");
    expect(isOk(result)).toBe(true);
    if (result.ok) expect(result.value).toBe("+19255550182");
  });

  it("rejects a non-phone with a validation error", () => {
    const result = Phone.parse("not a phone");
    expect(isErr(result)).toBe(true);
    if (!result.ok) {
      expect(result.error.kind).toBe("validation");
      expect(result.error.field).toBe("phone");
    }
  });
});
