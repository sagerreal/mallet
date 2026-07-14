import { describe, it, expect } from "vitest";
import { isPriceFlagged, readPriceAudit, toCallSummary } from "./call-mapper";
import type { CallSummaryRow } from "./call-mapper";

describe("isPriceFlagged", () => {
  it("is true when flagged has at least one entry", () => {
    expect(isPriceFlagged({ flagged: ["$99"] })).toBe(true);
    expect(isPriceFlagged({ flagged: ["$99", "$1,250.00"] })).toBe(true);
  });

  it("is false for an empty flagged array", () => {
    expect(isPriceFlagged({ flagged: [] })).toBe(false);
  });

  it("is false for null / undefined / non-object", () => {
    expect(isPriceFlagged(null)).toBe(false);
    expect(isPriceFlagged(undefined)).toBe(false);
    expect(isPriceFlagged("nope")).toBe(false);
    expect(isPriceFlagged(42)).toBe(false);
  });

  it("is false when flagged is missing or not an array", () => {
    expect(isPriceFlagged({})).toBe(false);
    expect(isPriceFlagged({ flagged: "x" })).toBe(false);
    expect(isPriceFlagged({ flagged: 3 })).toBe(false);
  });
});

describe("readPriceAudit", () => {
  it("reads a typed PriceAudit from a valid jsonb value", () => {
    expect(readPriceAudit({ flagged: ["$5", "$10"] })).toEqual({ flagged: ["$5", "$10"] });
  });

  it("preserves an empty flagged array", () => {
    expect(readPriceAudit({ flagged: [] })).toEqual({ flagged: [] });
  });

  it("returns null for null / non-object / missing flagged", () => {
    expect(readPriceAudit(null)).toBeNull();
    expect(readPriceAudit("x")).toBeNull();
    expect(readPriceAudit({})).toBeNull();
    expect(readPriceAudit({ flagged: "x" })).toBeNull();
  });

  it("drops non-string entries defensively", () => {
    expect(readPriceAudit({ flagged: ["$5", 7, null, "$10"] })).toEqual({
      flagged: ["$5", "$10"],
    });
  });
});

describe("toCallSummary", () => {
  const base: CallSummaryRow = {
    id: "call-1",
    createdAt: new Date("2026-07-14T10:00:00Z"),
    startedAt: new Date("2026-07-14T09:58:00Z"),
    fromNumber: "+16505551234",
    disposition: "booked_job",
    summary: "Booked a drain clear",
    transcript: "assistant: hi\nuser: hi",
    recordingUrl: "https://rec.example/1.mp3",
    priceAudit: { flagged: [] },
  };

  it("maps a full row to a CallSummary DTO", () => {
    expect(toCallSummary(base)).toEqual({
      id: "call-1",
      when: new Date("2026-07-14T09:58:00Z"),
      fromNumber: "+16505551234",
      disposition: "booked_job",
      summary: "Booked a drain clear",
      transcript: "assistant: hi\nuser: hi",
      recordingUrl: "https://rec.example/1.mp3",
      priceFlagged: false,
    });
  });

  it("falls back to createdAt when startedAt is null", () => {
    expect(toCallSummary({ ...base, startedAt: null }).when).toEqual(
      new Date("2026-07-14T10:00:00Z"),
    );
  });

  it("sets priceFlagged true when the audit has flagged amounts", () => {
    expect(toCallSummary({ ...base, priceAudit: { flagged: ["$99"] } }).priceFlagged).toBe(true);
  });

  it("carries nullable fields through unchanged", () => {
    const row: CallSummaryRow = {
      ...base,
      summary: null,
      transcript: null,
      recordingUrl: null,
      priceAudit: null,
    };
    const dto = toCallSummary(row);
    expect(dto.summary).toBeNull();
    expect(dto.transcript).toBeNull();
    expect(dto.recordingUrl).toBeNull();
    expect(dto.priceFlagged).toBe(false);
  });
});
