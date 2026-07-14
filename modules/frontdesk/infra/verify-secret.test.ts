import { describe, it, expect } from "vitest";
import { verifyVapiSecret } from "./verify-secret";

const SECRET = "a-very-long-shared-secret-value";

describe("verifyVapiSecret", () => {
  it("returns true for an exact match", () => {
    expect(verifyVapiSecret(SECRET, SECRET)).toBe(true);
  });

  it("returns false for a wrong value of the same length", () => {
    const wrong = "x".repeat(SECRET.length);
    expect(wrong.length).toBe(SECRET.length);
    expect(verifyVapiSecret(wrong, SECRET)).toBe(false);
  });

  it("returns false (never throws) on a length mismatch", () => {
    expect(verifyVapiSecret("short", SECRET)).toBe(false);
    expect(verifyVapiSecret(`${SECRET}extra`, SECRET)).toBe(false);
  });

  it("returns false for a null or undefined header", () => {
    expect(verifyVapiSecret(null, SECRET)).toBe(false);
    expect(verifyVapiSecret(undefined, SECRET)).toBe(false);
  });

  it("returns false for an empty header against a non-empty secret", () => {
    expect(verifyVapiSecret("", SECRET)).toBe(false);
  });

  it("distinguishes a one-character difference at the end (full constant-time compare)", () => {
    const almost = SECRET.slice(0, -1) + "X";
    expect(almost.length).toBe(SECRET.length);
    expect(verifyVapiSecret(almost, SECRET)).toBe(false);
  });
});
