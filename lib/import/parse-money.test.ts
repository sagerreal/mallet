import { describe, it, expect } from "vitest";
import { parseMoneyCents } from "./parse-money";

describe("parseMoneyCents", () => {
  it("parses a dollar sign + thousands comma", () => {
    expect(parseMoneyCents("$2,400")).toBe(240000);
  });

  it("parses a bare integer string", () => {
    expect(parseMoneyCents("2400")).toBe(240000);
  });

  it("parses commas with cents", () => {
    expect(parseMoneyCents("1,234.56")).toBe(123456);
  });

  it("parses zero", () => {
    expect(parseMoneyCents("$0")).toBe(0);
  });

  it("rounds a single decimal place to the nearest cent", () => {
    expect(parseMoneyCents("2400.5")).toBe(240050);
  });

  it("returns null for an empty string", () => {
    expect(parseMoneyCents("")).toBeNull();
  });

  it("returns null for a whitespace-only string", () => {
    expect(parseMoneyCents("  ")).toBeNull();
  });

  it("returns null for non-numeric input", () => {
    expect(parseMoneyCents("abc")).toBeNull();
  });

  it("returns null for a negative value", () => {
    expect(parseMoneyCents("-5")).toBeNull();
  });

  it("returns null for a negative value with a dollar sign", () => {
    expect(parseMoneyCents("$-5")).toBeNull();
  });

  it("parses multiple thousands separators", () => {
    expect(parseMoneyCents("1,000,000")).toBe(100000000);
  });
});
