/**
 * Guards against the silent-drop class: a line field that exists in the domain but is missed at
 * one of the three enumeration sites (mapper read-back, repository insert values, repository
 * upsert conflict set). It has bitten this repo before — `materialId` was written but never
 * carried on conflict, so an edit to an existing quote quietly reverted it.
 *
 * The first test is behavioural — a row in, a domain line out. The second is structural, because
 * the conflict set is inline SQL with no seam to call: an upsert that inserts a column it does
 * not also update on conflict is a bug you only see after someone edits a saved estimate.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toEstimateLine, type EstimateLineRow } from "./estimate-mapper";

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  orgId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  estimateId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  description: "Line posts, 4×4×8 cedar",
  quantity: 14,
  rateCents: 2430,
  costCents: 1800,
  isOptional: false,
  needsPhoto: false,
  taxable: true,
  position: 3,
  tier: null,
  materialId: null,
  scope: "Includes: posts set in concrete.",
  subItems: null,
  unit: "ea",
  qtyExpr: "qty/8+1",
  roundUp: true,
  parentLineId: "22222222-2222-4222-8222-222222222222",
  sectionId: "33333333-3333-4333-8333-333333333333",
  customerVisible: false,
  markupBps: 3500,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

describe("estimate line read-back", () => {
  it("carries every stored field into the domain", () => {
    const line = toEstimateLine(row as unknown as EstimateLineRow).props;
    expect(line.unit).toBe("ea");
    expect(line.qtyExpr).toBe("qty/8+1");
    expect(line.roundUp).toBe(true);
    expect(line.parentLineId).toBe("22222222-2222-4222-8222-222222222222");
    expect(line.sectionId).toBe("33333333-3333-4333-8333-333333333333");
    expect(line.customerVisible).toBe(false);
    expect(line.markupBps).toBe(3500);
  });

  it("reads a stored quantity as the truth without re-deriving it from the expression", () => {
    // Read-back has no parent row to supply the driver, so the stored number stands. The write
    // path is where the two are reconciled.
    expect(toEstimateLine({ ...row, quantity: 14 } as unknown as EstimateLineRow).props.quantity).toBe(14);
  });
});

describe("estimate line upsert", () => {
  it("updates on conflict every column it inserts", () => {
    const source = readFileSync(join(__dirname, "drizzle-estimate-repository.ts"), "utf8");
    // Anchor on the LINES upsert specifically — the header has its own onConflictDoUpdate
    // earlier in the file, and slicing to the first one runs backwards and reads as empty.
    const insertStart = source.indexOf("const rows = lines.map((line) => {");
    const conflictStart = source.indexOf(".onConflictDoUpdate", insertStart);
    expect(insertStart).toBeGreaterThan(-1);
    expect(conflictStart).toBeGreaterThan(insertStart);

    const insertBlock = source.slice(insertStart, conflictStart);
    const conflictBlock = source.slice(
      source.indexOf("set: {", conflictStart),
      source.indexOf("});", conflictStart),
    );

    // Keys the upsert must not carry: identity (never changes) and creation stamps.
    const identity = new Set(["id", "orgId", "estimateId", "createdAt"]);
    const inserted = [...insertBlock.matchAll(/^\s{8}(\w+):/gm)].map((m) => m[1]!).filter((k) => !identity.has(k));
    const updated = new Set([...conflictBlock.matchAll(/^\s{10}(\w+):/gm)].map((m) => m[1]!));

    expect(inserted.length).toBeGreaterThan(15);
    expect(inserted.filter((key) => !updated.has(key))).toEqual([]);
  });
});
