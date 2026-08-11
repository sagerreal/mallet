import { describe, it, expect } from "vitest";
import { isEstimateJob, isUnpricedEstimateJob, hasPricedLines, jobPriceCommitted } from "./job-status-meta";

/**
 * ONE predicate for "is this an estimate visit".
 *
 * Two fields used to say it and disagreed: `svc` (free-text trade label) carried the magic value
 * every surface read, while `kind` — the closed enum built for exactly this — was written only by
 * the AI front desk and read by nothing. A voice-booked estimate (kind='estimate',
 * svc='Water heater repair') therefore rendered as regular work on the board, in the office
 * modal, on the tech's phone, and in Money. Backfilled in 0133; kind is the truth now.
 */

describe("isEstimateJob", () => {
  // THE BUG THIS FIXES: this exact shape is what the AI front desk writes.
  it("recognises a voice-booked estimate — kind set, svc holding the spoken service name", () => {
    expect(isEstimateJob({ kind: "estimate", svc: "Water heater repair" })).toBe(true);
  });

  it("recognises an office-booked estimate", () => {
    expect(isEstimateJob({ kind: "estimate", svc: "" })).toBe(true);
  });

  // Belt-and-braces for a store record hydrated before the writers switched. The column itself
  // carries no 'estimate' values since the backfill.
  it("still honours the legacy svc flag", () => {
    expect(isEstimateJob({ kind: "work", svc: "estimate" })).toBe(true);
  });

  it("does not mistake ordinary work for an estimate", () => {
    expect(isEstimateJob({ kind: "work", svc: "service" })).toBe(false);
    expect(isEstimateJob({ svc: null })).toBe(false);
    expect(isEstimateJob({})).toBe(false);
  });
});

describe("isUnpricedEstimateJob", () => {
  const estimate = { kind: "estimate", svc: "" };

  it("is true for a pure scoping visit — nothing to bill, nothing to show", () => {
    expect(isUnpricedEstimateJob({ ...estimate, lines: [] })).toBe(true);
  });

  /**
   * THE SECOND BUG. A quote signed at the door writes priced lines onto the job. The old
   * svc-based gate kept hiding the Price section on it — the one record that most certainly
   * has a price was the one refusing to show money.
   */
  it("is FALSE once the tech has signed a price at the door", () => {
    expect(isUnpricedEstimateJob({ ...estimate, lines: [{ q: 1, r: 2650 }] })).toBe(false);
  });

  it("ignores zero-value placeholder lines", () => {
    expect(isUnpricedEstimateJob({ ...estimate, lines: [{ q: 1, r: 0 }] })).toBe(true);
  });

  it("is never true for a flat-rate job, priced or not", () => {
    expect(isUnpricedEstimateJob({ kind: "work", lines: [] })).toBe(false);
  });
});

describe("hasPricedLines", () => {
  it("needs quantity × rate to be real money", () => {
    expect(hasPricedLines({ lines: [{ q: 2, r: 150 }] })).toBe(true);
    expect(hasPricedLines({ lines: [{ q: 0, r: 150 }] })).toBe(false);
    expect(hasPricedLines({ lines: [{ q: null, r: 150 }] })).toBe(true); // null qty defaults to 1
    expect(hasPricedLines({})).toBe(false);
  });
});

describe("jobPriceCommitted — a price someone stands behind, never a draft", () => {
  it("a signed job is committed regardless of anything else", () => {
    expect(jobPriceCommitted({ kind: "estimate", sourceEstimateId: "est-1", lines: [] })).toBe(true);
  });

  it("lines on a WORK job are the office's booked price — committed", () => {
    expect(jobPriceCommitted({ kind: "work", lines: [{ d: "Water heater swap" }] })).toBe(true);
  });

  it("lines on an ESTIMATE job are the tech's own draft — NOT committed, still editable", () => {
    expect(jobPriceCommitted({ kind: "estimate", lines: [{ d: "Repaint hall" }] })).toBe(false);
    expect(jobPriceCommitted({ svc: "estimate", lines: [{ d: "Repaint hall" }] })).toBe(false);
  });

  it("an unpriced job is committed to nothing", () => {
    expect(jobPriceCommitted({ kind: "work", lines: [] })).toBe(false);
    expect(jobPriceCommitted({ kind: "work" })).toBe(false);
  });

  it("reads line TEXT, not rates — a price-redacted device (r: null) still sees booked as booked", () => {
    // hasPricedLines would say false here (null rates sum to 0); the committed predicate must not.
    expect(jobPriceCommitted({ kind: "work", lines: [{ d: "Water heater swap" }] })).toBe(true);
    // …but blank-description debris is not a price.
    expect(jobPriceCommitted({ kind: "work", lines: [{ d: "  " }] })).toBe(false);
  });
});
