import { describe, it, expect } from "vitest";
import { isRole, ROLES } from "./principal";

describe("isRole", () => {
  it("accepts known roles", () => {
    for (const role of ROLES) {
      expect(isRole(role)).toBe(true);
    }
  });

  it("rejects unknown values", () => {
    expect(isRole("admin")).toBe(false);
    expect(isRole("")).toBe(false);
  });
});
