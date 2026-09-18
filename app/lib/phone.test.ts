import { describe, it, expect } from "vitest";
import { hasPhone, ADD_PHONE_TITLE, formatPhone, phoneFieldError, PHONE_INVALID_MESSAGE } from "./phone";

describe("formatPhone", () => {
  it("renders a US E.164 number the way a person reads it aloud", () => {
    expect(formatPhone("+16693413343")).toBe("(669) 341-3343");
  });

  it("returns nothing for nothing — the caller decides what 'not set' reads as", () => {
    expect(formatPhone(null)).toBe("");
    expect(formatPhone("")).toBe("");
    expect(formatPhone("   ")).toBe("");
  });

  it("passes anything it does not recognise through untouched rather than mangling it", () => {
    // Non-US / short / already-formatted values are shown as stored, never silently reshaped.
    expect(formatPhone("+442071838750")).toBe("+442071838750");
    expect(formatPhone("(669) 341-3343")).toBe("(669) 341-3343");
  });
});

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

describe("phoneFieldError", () => {
  it("null for a blank value — the field is optional on every creation form", () => {
    expect(phoneFieldError("")).toBeNull();
    expect(phoneFieldError("   ")).toBeNull();
  });

  it("null for a valid 10-digit US number in any common typed form", () => {
    expect(phoneFieldError("(925) 555-0123")).toBeNull();
    expect(phoneFieldError("925-555-0123")).toBeNull();
    expect(phoneFieldError("9255550123")).toBeNull();
    expect(phoneFieldError("+19255550123")).toBeNull();
    expect(phoneFieldError("19255550123")).toBeNull();
  });

  it("flags the exact defect Owen hit — an 8-digit number", () => {
    expect(phoneFieldError("78138501")).toBe(PHONE_INVALID_MESSAGE);
  });

  it("flags any non-10-digit value with the same named message the server would reject with", () => {
    expect(phoneFieldError("12345")).toBe(PHONE_INVALID_MESSAGE);
    expect(phoneFieldError("not a phone number")).toBe(PHONE_INVALID_MESSAGE);
  });
});
