import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseTool } from "./parse-tool";

describe("parseTool", () => {
  const schema = z.object({ name: z.string(), age: z.number().int().nonnegative() });

  it("returns success with parsed data for valid input", () => {
    const result = parseTool(schema, { name: "Alice", age: 30 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: "Alice", age: 30 });
    }
  });

  it("returns failure with issues for invalid input", () => {
    const result = parseTool(schema, { name: 42, age: -1 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("returns failure for missing required fields", () => {
    const result = parseTool(schema, { name: "Bob" });
    expect(result.success).toBe(false);
  });

  it("returns failure for completely wrong type", () => {
    const result = parseTool(schema, "not an object");
    expect(result.success).toBe(false);
  });

  it("returns failure for null input", () => {
    const result = parseTool(schema, null);
    expect(result.success).toBe(false);
  });

  it("works with a simple string schema", () => {
    const strSchema = z.string().min(3);
    expect(parseTool(strSchema, "hello").success).toBe(true);
    expect(parseTool(strSchema, "hi").success).toBe(false);
  });
});
