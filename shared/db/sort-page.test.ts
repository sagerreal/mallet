import { describe, it, expect } from "vitest";
import { encodeSortCursor, decodeSortCursor, sortValueOf } from "./sort-page";

/**
 * The SQL builders are exercised against a real database in the repository integration tests —
 * a hand-asserted SQL string proves nothing about what Postgres does with NULLs. What is unit
 * tested here is the cursor codec, because a lossy round-trip silently skips or repeats rows and
 * that is invisible until a customer notices a job missing.
 */
describe("sort cursor codec", () => {
  it("round-trips an ISO timestamp", () => {
    const c = { value: "2026-08-12T15:04:00.000Z", id: "11111111-1111-1111-1111-111111111111" };
    expect(decodeSortCursor(encodeSortCursor(c))).toEqual(c);
  });

  it("round-trips a NULL sort value — the unscheduled-job case", () => {
    // A job with no scheduled date sits in the null block. If null does not survive the
    // round-trip, page 2 restarts at the top of the real values and every unscheduled job is
    // either lost or served twice.
    const c = { value: null, id: "22222222-2222-2222-2222-222222222222" };
    expect(decodeSortCursor(encodeSortCursor(c))).toEqual(c);
  });

  it("round-trips a numeric value (amount sorts)", () => {
    const c = { value: "245000", id: "33333333-3333-3333-3333-333333333333" };
    expect(decodeSortCursor(encodeSortCursor(c))).toEqual(c);
  });

  it("round-trips a value containing the separator", () => {
    // Customer-name sorts put arbitrary text in the cursor. indexOf finds the FIRST separator,
    // so a pipe inside the value must not truncate the id.
    const c = { value: "Chen | Plumbing", id: "44444444-4444-4444-4444-444444444444" };
    expect(decodeSortCursor(encodeSortCursor(c))).toEqual(c);
  });

  it("rejects garbage rather than paginating from a wrong position", () => {
    // A malformed cursor must be refused, not silently treated as "start from the beginning" —
    // that would serve page 1 to someone who asked for page 5 and look like data loss.
    expect(decodeSortCursor("")).toBeNull();
    expect(decodeSortCursor("bm90LWEtY3Vyc29y")).toBeNull(); // "not-a-cursor", no separator
  });

  it("rejects a cursor with no id", () => {
    expect(decodeSortCursor(Buffer.from("2026-01-01|", "utf8").toString("base64url"))).toBeNull();
  });
});

describe("sortValueOf", () => {
  it("serialises a Date to ISO so string comparison matches timestamp ordering", () => {
    expect(sortValueOf(new Date("2026-08-12T15:04:00Z"))).toBe("2026-08-12T15:04:00.000Z");
  });

  it("maps null and undefined to null — both mean 'no sort value'", () => {
    expect(sortValueOf(null)).toBeNull();
    expect(sortValueOf(undefined)).toBeNull();
  });

  it("keeps 0 rather than treating it as absent", () => {
    // A $0 job has a real amount. Coercing falsy to null would drop it into the null block and
    // sort it with the unscheduled work.
    expect(sortValueOf(0)).toBe("0");
  });

  it("keeps an empty string rather than treating it as absent", () => {
    expect(sortValueOf("")).toBe("");
  });
});
