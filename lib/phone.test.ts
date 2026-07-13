import { describe, it, expect } from "vitest";
import { hasPhone, ADD_PHONE_TITLE } from "./phone";

describe("hasPhone", () => {
  it("true for a real phone number", () => {
    expect(hasPhone({ phone: "555-0101" })).toBe(true);
    expect(hasPhone({ phone: "+1 (925) 555-0100" })).toBe(true);
  });

  it("false for the em-dash placeholder", () => {
    expect(hasPhone({ phone: "—" })).toBe(false);
    expect(hasPhone({ phone: " — " })).toBe(false); // trimmed before comparing
  });

  it("false for empty / blank / null / undefined phone", () => {
    expect(hasPhone({ phone: "" })).toBe(false);
    expect(hasPhone({ phone: "   " })).toBe(false);
    expect(hasPhone({ phone: null })).toBe(false);
    expect(hasPhone({})).toBe(false);
  });

  it("false for a missing bearer (no lead at all)", () => {
    expect(hasPhone(null)).toBe(false);
    expect(hasPhone(undefined)).toBe(false);
  });

  it("exports the shared disabled-control title", () => {
    expect(ADD_PHONE_TITLE).toBe("Add a phone number first");
  });
});
