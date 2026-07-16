// Unit tests for the pure callback-autopsy aggregation. Covers every rule from the brief:
// miss detection, pass vs override vs absent, null checklists, multi-service sorting,
// tiebreaks, alreadyRequired, and the "Other" service label.
//
// No I/O, no DB — all data is constructed in-memory with plain object literals and real Maps.
import { describe, it, expect } from "vitest";
import {
  computeAutopsy,
  type AutopsyPair,
  type AnswersByOriginal,
} from "./compute-autopsy";

// ── test helpers ──────────────────────────────────────────────────────────────

/** Build a minimal AutopsyPair with optional overrides. */
function pair(opts: {
  cbId: string;
  cbNum: string;
  cbSvc: string | null;
  origId: string;
  origNum: string;
  origSvc: string | null;
  checklist: AutopsyPair["original"]["checklist"];
}): AutopsyPair {
  return {
    callback: { id: opts.cbId, num: opts.cbNum, svc: opts.cbSvc },
    original: {
      id: opts.origId,
      num: opts.origNum,
      svc: opts.origSvc,
      checklist: opts.checklist,
    },
  };
}

/** Checklist with one item. */
function cl(
  name: string,
  itemId: string,
  text: string,
  required: boolean,
): AutopsyPair["original"]["checklist"] {
  return { name, items: [{ id: itemId, text, type: "check", required }] };
}

/** Checklist with two items. */
function cl2(
  name: string,
  items: Array<{ id: string; text: string; required: boolean }>,
): AutopsyPair["original"]["checklist"] {
  return {
    name,
    items: items.map((i) => ({ id: i.id, text: i.text, type: "check", required: i.required })),
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("computeAutopsy", () => {
  // ── Case 1: Two water-heater callbacks, same step skipped (unanswered) ──────
  it("two water-heater callbacks, same step unanswered → one cluster, topMiss correct", () => {
    const p1 = pair({
      cbId: "cb-1", cbNum: "JOB-101", cbSvc: "Water Heater",
      origId: "orig-1", origNum: "JOB-001", origSvc: "Water Heater",
      checklist: cl("Heater CL", "item-A", "Flush sediment", true),
    });
    const p2 = pair({
      cbId: "cb-2", cbNum: "JOB-102", cbSvc: "Water Heater",
      origId: "orig-2", origNum: "JOB-002", origSvc: "Water Heater",
      checklist: cl("Heater CL", "item-B", "Flush sediment", true),
    });
    // Neither original has an answer for their respective item → both are missed
    const answers: AnswersByOriginal = new Map([
      ["orig-1", new Map()],
      ["orig-2", new Map()],
    ]);

    const result = computeAutopsy([p1, p2], answers);

    expect(result).toHaveLength(1);
    const cluster = result[0]!;
    expect(cluster.service).toBe("Water Heater");
    expect(cluster.callbackCount).toBe(2);
    expect(cluster.answeredOriginals).toBe(2);
    expect(cluster.topMiss).toEqual({
      itemText: "Flush sediment",
      checklistName: "Heater CL",
      missCount: 2,
      ofAnswered: 2,
      alreadyRequired: true,
    });
  });

  // ── Case 2: A "pass" answer does NOT count as a miss ─────────────────────
  it("original answered 'pass' → not counted as a miss", () => {
    const p1 = pair({
      cbId: "cb-1", cbNum: "JOB-101", cbSvc: "plumbing",
      origId: "orig-1", origNum: "JOB-001", origSvc: "plumbing",
      checklist: cl("Plumbing CL", "item-A", "Check shutoff", false),
    });
    const p2 = pair({
      cbId: "cb-2", cbNum: "JOB-102", cbSvc: "plumbing",
      origId: "orig-2", origNum: "JOB-002", origSvc: "plumbing",
      checklist: cl("Plumbing CL", "item-B", "Check shutoff", false),
    });
    // orig-1 passed the step; orig-2 left it unanswered (absent)
    const answers: AnswersByOriginal = new Map([
      ["orig-1", new Map([["item-A", "pass"]])],
      ["orig-2", new Map()],
    ]);

    const result = computeAutopsy([p1, p2], answers);

    expect(result).toHaveLength(1);
    const cluster = result[0]!;
    expect(cluster.answeredOriginals).toBe(2);
    expect(cluster.topMiss).not.toBeNull();
    expect(cluster.topMiss!.missCount).toBe(1);   // only orig-2 missed it
    expect(cluster.topMiss!.ofAnswered).toBe(2);
  });

  // ── Case 3: "override" counts as a miss ──────────────────────────────────
  it("original answered 'override' → counted as a miss", () => {
    const p1 = pair({
      cbId: "cb-1", cbNum: "JOB-101", cbSvc: "electrical",
      origId: "orig-1", origNum: "JOB-001", origSvc: "electrical",
      checklist: cl("Elec CL", "item-A", "Test GFCI", true),
    });
    const answers: AnswersByOriginal = new Map([
      // "override" is NOT "pass" → must be a miss
      ["orig-1", new Map<string, import("../domain/job-execution").VerifyState>([["item-A", "override"]])],
    ]);

    const result = computeAutopsy([p1], answers);

    expect(result).toHaveLength(1);
    const cluster = result[0]!;
    expect(cluster.answeredOriginals).toBe(1);
    expect(cluster.topMiss).not.toBeNull();
    expect(cluster.topMiss!.missCount).toBe(1);
    expect(cluster.topMiss!.itemText).toBe("Test GFCI");
  });

  // ── Case 4: null checklist → answeredOriginals:0, topMiss:null, callbackCount still counts ──
  it("originals with null checklist → answeredOriginals:0, topMiss:null, callbackCount counts them", () => {
    const p1 = pair({
      cbId: "cb-1", cbNum: "JOB-101", cbSvc: "hvac",
      origId: "orig-1", origNum: "JOB-001", origSvc: "hvac",
      checklist: null,
    });
    const p2 = pair({
      cbId: "cb-2", cbNum: "JOB-102", cbSvc: "hvac",
      origId: "orig-2", origNum: "JOB-002", origSvc: "hvac",
      checklist: null,
    });
    const answers: AnswersByOriginal = new Map();

    const result = computeAutopsy([p1, p2], answers);

    expect(result).toHaveLength(1);
    const cluster = result[0]!;
    expect(cluster.callbackCount).toBe(2);
    expect(cluster.answeredOriginals).toBe(0);
    expect(cluster.topMiss).toBeNull();
  });

  // ── Case 5: Two different services → two clusters, sorted by callbackCount desc ──
  it("two services → two clusters sorted by callbackCount desc then service asc", () => {
    // Service A: "water heater" has 2 callbacks
    const wh1 = pair({
      cbId: "cb-1", cbNum: "JOB-101", cbSvc: "water heater",
      origId: "orig-1", origNum: "JOB-001", origSvc: "water heater",
      checklist: null,
    });
    const wh2 = pair({
      cbId: "cb-2", cbNum: "JOB-102", cbSvc: "water heater",
      origId: "orig-2", origNum: "JOB-002", origSvc: "water heater",
      checklist: null,
    });
    // Service B: "drain cleaning" has 1 callback
    const dc1 = pair({
      cbId: "cb-3", cbNum: "JOB-103", cbSvc: "drain cleaning",
      origId: "orig-3", origNum: "JOB-003", origSvc: "drain cleaning",
      checklist: null,
    });

    const answers: AnswersByOriginal = new Map();
    const result = computeAutopsy([wh1, wh2, dc1], answers);

    expect(result).toHaveLength(2);
    // water heater first (2 callbacks > 1)
    expect(result[0]!.service).toBe("water heater");
    expect(result[0]!.callbackCount).toBe(2);
    expect(result[1]!.service).toBe("drain cleaning");
    expect(result[1]!.callbackCount).toBe(1);
  });

  // ── Case 5b: Sort tiebreak on service ascending ───────────────────────────
  it("tiebreak on callbackCount → service asc determines order", () => {
    const aaa = pair({
      cbId: "cb-1", cbNum: "JOB-101", cbSvc: "zzz service",
      origId: "orig-1", origNum: "JOB-001", origSvc: "zzz service",
      checklist: null,
    });
    const bbb = pair({
      cbId: "cb-2", cbNum: "JOB-102", cbSvc: "aaa service",
      origId: "orig-2", origNum: "JOB-002", origSvc: "aaa service",
      checklist: null,
    });
    const answers: AnswersByOriginal = new Map();
    const result = computeAutopsy([aaa, bbb], answers);

    expect(result).toHaveLength(2);
    // Both have 1 callback → service asc: "aaa service" before "zzz service"
    expect(result[0]!.service).toBe("aaa service");
    expect(result[1]!.service).toBe("zzz service");
  });

  // ── Case 6: Miss-count tiebreak → itemText ascending ─────────────────────
  it("miss-count tie between two item texts → lower itemText (asc) wins", () => {
    // Both items are missed by both originals → tie on missCount=2;
    // tiebreak: "Alpha step" < "Zeta step" → Alpha wins
    const p1 = pair({
      cbId: "cb-1", cbNum: "JOB-101", cbSvc: "plumbing",
      origId: "orig-1", origNum: "JOB-001", origSvc: "plumbing",
      checklist: cl2("PL CL", [
        { id: "i1", text: "Zeta step", required: true },
        { id: "i2", text: "Alpha step", required: true },
      ]),
    });
    const p2 = pair({
      cbId: "cb-2", cbNum: "JOB-102", cbSvc: "plumbing",
      origId: "orig-2", origNum: "JOB-002", origSvc: "plumbing",
      checklist: cl2("PL CL", [
        { id: "i3", text: "Zeta step", required: true },
        { id: "i4", text: "Alpha step", required: true },
      ]),
    });
    // No answers → every item is missed
    const answers: AnswersByOriginal = new Map([
      ["orig-1", new Map()],
      ["orig-2", new Map()],
    ]);

    const result = computeAutopsy([p1, p2], answers);

    expect(result).toHaveLength(1);
    expect(result[0]!.topMiss).not.toBeNull();
    // Both have missCount=2; "Alpha step" < "Zeta step" → Alpha wins
    expect(result[0]!.topMiss!.itemText).toBe("Alpha step");
  });

  // ── Case 7: alreadyRequired true when every occurrence had required:true ──
  it("alreadyRequired:true when every snapshot occurrence of the item was required:true", () => {
    const p1 = pair({
      cbId: "cb-1", cbNum: "JOB-101", cbSvc: "gas",
      origId: "orig-1", origNum: "JOB-001", origSvc: "gas",
      checklist: cl("Gas CL", "item-A", "Leak test", true),
    });
    const p2 = pair({
      cbId: "cb-2", cbNum: "JOB-102", cbSvc: "gas",
      origId: "orig-2", origNum: "JOB-002", origSvc: "gas",
      checklist: cl("Gas CL", "item-B", "Leak test", true),
    });
    const answers: AnswersByOriginal = new Map([
      ["orig-1", new Map()],
      ["orig-2", new Map()],
    ]);

    const result = computeAutopsy([p1, p2], answers);

    expect(result[0]!.topMiss!.alreadyRequired).toBe(true);
  });

  // ── Case 8: alreadyRequired false when at least one occurrence was required:false ──
  it("alreadyRequired:false when at least one snapshot occurrence had required:false", () => {
    const p1 = pair({
      cbId: "cb-1", cbNum: "JOB-101", cbSvc: "gas",
      origId: "orig-1", origNum: "JOB-001", origSvc: "gas",
      // required:true on orig-1
      checklist: cl("Gas CL", "item-A", "Leak test", true),
    });
    const p2 = pair({
      cbId: "cb-2", cbNum: "JOB-102", cbSvc: "gas",
      origId: "orig-2", origNum: "JOB-002", origSvc: "gas",
      // required:false on orig-2 → must flip alreadyRequired to false
      checklist: cl("Gas CL", "item-B", "Leak test", false),
    });
    const answers: AnswersByOriginal = new Map([
      ["orig-1", new Map()],
      ["orig-2", new Map()],
    ]);

    const result = computeAutopsy([p1, p2], answers);

    expect(result[0]!.topMiss!.alreadyRequired).toBe(false);
  });

  // ── Case 9: service:"Other" when svc is null on both sides ──────────────
  it("null svc on both sides → service:\"Other\"", () => {
    const p1 = pair({
      cbId: "cb-1", cbNum: "JOB-101", cbSvc: null,
      origId: "orig-1", origNum: "JOB-001", origSvc: null,
      checklist: null,
    });
    const answers: AnswersByOriginal = new Map();
    const result = computeAutopsy([p1], answers);

    expect(result).toHaveLength(1);
    expect(result[0]!.service).toBe("Other");
  });

  // ── Case 10: originalNums deduplicated (same num repeated) ───────────────
  it("originalNums deduplicates repeated nums", () => {
    // Two callbacks that point to the same original job number
    const p1 = pair({
      cbId: "cb-1", cbNum: "JOB-101", cbSvc: "plumbing",
      origId: "orig-1", origNum: "JOB-001", origSvc: "plumbing",
      checklist: null,
    });
    const p2 = pair({
      cbId: "cb-2", cbNum: "JOB-102", cbSvc: "plumbing",
      origId: "orig-1", origNum: "JOB-001", origSvc: "plumbing",
      checklist: null,
    });
    const answers: AnswersByOriginal = new Map();
    const result = computeAutopsy([p1, p2], answers);

    expect(result[0]!.callbackCount).toBe(2);    // both pairs count
    expect(result[0]!.originalNums).toHaveLength(1); // deduped
    expect(result[0]!.originalNums[0]).toBe("JOB-001");
  });

  // ── Case 11: topMiss null when every item was answered "pass" (missCount:0) ──
  it("topMiss null when no step was missed (all passed)", () => {
    const p1 = pair({
      cbId: "cb-1", cbNum: "JOB-101", cbSvc: "plumbing",
      origId: "orig-1", origNum: "JOB-001", origSvc: "plumbing",
      checklist: cl("PL CL", "item-A", "Shutoff check", true),
    });
    const answers: AnswersByOriginal = new Map([
      ["orig-1", new Map<string, import("../domain/job-execution").VerifyState>([["item-A", "pass"]])],
    ]);

    const result = computeAutopsy([p1], answers);

    expect(result[0]!.answeredOriginals).toBe(1);
    // topMiss must be null: the only item was passed (missCount would be 0)
    expect(result[0]!.topMiss).toBeNull();
  });

  // ── Case 12: empty input → empty output ──────────────────────────────────
  it("empty pairs → empty result", () => {
    const answers: AnswersByOriginal = new Map();
    expect(computeAutopsy([], answers)).toEqual([]);
  });

  // ── Case 13: service key is normalised (case-insensitive + trim) ─────────
  it("service grouping is case-insensitive and trims whitespace", () => {
    const p1 = pair({
      cbId: "cb-1", cbNum: "JOB-101", cbSvc: " Water Heater ",
      origId: "orig-1", origNum: "JOB-001", origSvc: " Water Heater ",
      checklist: null,
    });
    const p2 = pair({
      cbId: "cb-2", cbNum: "JOB-102", cbSvc: "water heater",
      origId: "orig-2", origNum: "JOB-002", origSvc: "water heater",
      checklist: null,
    });
    const answers: AnswersByOriginal = new Map();
    const result = computeAutopsy([p1, p2], answers);

    // Should land in one cluster (same normalised key)
    expect(result).toHaveLength(1);
    expect(result[0]!.callbackCount).toBe(2);
    // Display label is first non-empty svc seen
    expect(result[0]!.service).toBe(" Water Heater ");
  });
});
