import { describe, it, expect } from "vitest";
import { normalizeTags, tagsWithinLength, MAX_TAG_LENGTH } from "./customer-tags";

/**
 * The normaliser is what stops a shop's tag list filling with near-duplicates that each match a
 * different half of the book — the failure the free-text `source` column it replaced actually had
 * ("Nextdoor" and "Nextdoor / FB" both live on the live book).
 */
describe("normalizeTags", () => {
  it("trims", () => {
    expect(normalizeTags(["  Google  "])).toEqual(["Google"]);
  });

  it("drops blanks rather than storing an empty tag", () => {
    expect(normalizeTags(["Google", "", "   ", "\t"])).toEqual(["Google"]);
  });

  it("collapses case-insensitive duplicates", () => {
    expect(normalizeTags(["Google", "google", "GOOGLE"])).toEqual(["Google"]);
  });

  /** The FIRST spelling wins, so a shop that types "VIP" is not renamed by a later "vip". */
  it("keeps the first spelling, not the last", () => {
    expect(normalizeTags(["VIP", "vip"])).toEqual(["VIP"]);
    expect(normalizeTags(["vip", "VIP"])).toEqual(["vip"]);
  });

  it("collapses duplicates that differ only by surrounding space", () => {
    expect(normalizeTags(["Google", " Google "])).toEqual(["Google"]);
  });

  /** Order is the order somebody chose them in — NOT sorted. */
  it("preserves order", () => {
    expect(normalizeTags(["Yelp", "Angi", "Google"])).toEqual(["Yelp", "Angi", "Google"]);
  });

  it("leaves an empty list empty", () => {
    expect(normalizeTags([])).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = ["Google", "google"];
    normalizeTags(input);
    expect(input).toEqual(["Google", "google"]);
  });

  /**
   * Total by design: it is on the READ path too (hydrating a row already in the database), so a
   * throw here would make every read a try/catch. Length is `Lead.create`'s to reject.
   */
  it("never rejects an over-long tag — that is the domain's job", () => {
    const long = "x".repeat(MAX_TAG_LENGTH + 10);
    expect(normalizeTags([long])).toEqual([long]);
  });
});

describe("tagsWithinLength", () => {
  it("accepts a tag at exactly the limit", () => {
    expect(tagsWithinLength(["x".repeat(MAX_TAG_LENGTH)])).toBe(true);
  });

  it("rejects one character over", () => {
    expect(tagsWithinLength(["x".repeat(MAX_TAG_LENGTH + 1)])).toBe(false);
  });

  it("rejects when ANY tag is too long, not just the first", () => {
    expect(tagsWithinLength(["Google", "x".repeat(MAX_TAG_LENGTH + 1)])).toBe(false);
  });

  it("an empty list is within length", () => {
    expect(tagsWithinLength([])).toBe(true);
  });
});
