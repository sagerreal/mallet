/**
 * lib/import/import-error-message.test.ts
 *
 * The import modal used to render `err.message` verbatim. For a tRPC input rejection that message
 * IS the serialized Zod issue array, so one blank price cell put a wall of JSON — "expected":
 * "number", "code": "invalid_type", paths and all — in front of whoever was importing a supplier
 * sheet. A validation failure has to read as a sentence naming the columns to look at.
 */
import { describe, it, expect } from "vitest";
import { importErrorMessage, IMPORT_VALIDATION_COPY, IMPORT_STOPPED_COPY } from "./import-error-message";

describe("importErrorMessage", () => {
  it("replaces a serialized Zod issue array with a sentence", () => {
    const zodish = new Error(
      '[\n  {\n    "expected": "number",\n    "code": "invalid_type",\n    "path": ["rows", 3, "unitPriceCents"],\n    "message": "Invalid input: expected number, received null"\n  }\n]',
    );

    const msg = importErrorMessage(zodish);

    expect(msg).toBe(IMPORT_VALIDATION_COPY);
    expect(msg).not.toMatch(/invalid_type|\[|\{/);
  });

  it("names the offending columns so there is somewhere to look", () => {
    expect(IMPORT_VALIDATION_COPY).toMatch(/column/i);
  });

  it("keeps a real, human server message — those say something useful", () => {
    const real = new Error("Import stopped partway. 120 rows were saved.");

    expect(importErrorMessage(real)).toBe("Import stopped partway. 120 rows were saved.");
  });

  it("falls back to the resume copy for a non-Error throw", () => {
    expect(importErrorMessage("boom")).toBe(IMPORT_STOPPED_COPY);
  });

  it("treats an object-shaped Zod message as validation too", () => {
    // tRPC sometimes surfaces a single issue object rather than an array.
    const one = new Error('{"code":"invalid_type","expected":"number","path":["rows",0,"cost"]}');

    expect(importErrorMessage(one)).toBe(IMPORT_VALIDATION_COPY);
  });
});
