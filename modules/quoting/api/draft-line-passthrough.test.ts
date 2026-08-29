/**
 * The draft procedure re-lists every line field by hand on its way from the zod input to the
 * use-case command. That is a silent-drop site: a field added to `lineInput` and to
 * `EstimateLineInput` still goes nowhere unless someone remembers this third list, and the
 * request succeeds — the field simply never lands. It has already happened once on this branch
 * (unit, qtyExpr, roundUp, parentIndex, customerVisible and markupBps were all accepted by the
 * schema and dropped here).
 *
 * Structural rather than behavioural because the mapping is an object literal inside a tRPC
 * resolver with no seam to call.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "estimate-router.ts"), "utf8");

/** The keys of an object literal at one indent level, e.g. `  foo: bar,`. */
const keysAt = (block: string, indent: number): string[] =>
  [...block.matchAll(new RegExp(`^ {${indent}}(\\w+):`, "gm"))].map((m) => m[1]!);

describe("draft: the zod line input reaches the use case", () => {
  it("maps every field lineInput accepts", () => {
    const inputStart = source.indexOf("const lineInput = z.object({");
    const inputEnd = source.indexOf("\n});", inputStart);
    expect(inputStart).toBeGreaterThan(-1);
    const accepted = keysAt(source.slice(inputStart, inputEnd), 2);

    const mapStart = source.indexOf("lines: input.lines.map((line) => ({");
    const mapEnd = source.indexOf("})),", mapStart);
    expect(mapStart).toBeGreaterThan(inputStart);
    const passed = new Set(keysAt(source.slice(mapStart, mapEnd), 12));

    // `rateCents` and friends keep their names; the two INDEX fields are resolved to ids inside
    // the use case, so they travel under their own names too. Nothing here is renamed.
    expect(accepted.filter((key) => !passed.has(key))).toEqual([]);
    expect(accepted.length).toBeGreaterThan(15);
  });

  it("maps every line field the domain stores into the DTO", () => {
    // The read side of the same class: a stored field the DTO never emits is invisible to every
    // client, and nothing fails.
    const dtoStart = source.indexOf("const estimateLineDTO = z.object({");
    const dtoEnd = source.indexOf("\n});", dtoStart);
    const emitted = new Set(keysAt(source.slice(dtoStart, dtoEnd), 2));

    const mapStart = source.indexOf("lines: p.lines.map((line) => {");
    const mapEnd = source.indexOf("\n    }),", mapStart);
    const built = keysAt(source.slice(mapStart, mapEnd), 8);

    expect([...emitted].filter((key) => !built.includes(key))).toEqual([]);
    expect(built.length).toBeGreaterThan(15);
  });
});
