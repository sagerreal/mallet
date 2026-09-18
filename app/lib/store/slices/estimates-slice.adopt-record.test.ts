import { describe, it, expect } from "vitest";
import { useAppStore } from "@/lib/store/app-store";
import { dtoEstimateSummaryToStore, type EstimateSummaryDTO } from "@/lib/store/dto-mapper";

/**
 * Adopting a quote HEADER from a list read.
 *
 * Why this exists separately from adoptEstimate: that one takes the full DTO and runs the full
 * mapper, which reads lines and pricing. A list row carries neither. Handing a summary to the full
 * mapper is what put "Something went wrong" on Money and Pipeline — so the two shapes are named
 * apart, and this action takes an already-mapped record.
 *
 * What it buys: the customer sheet already fetched these quotes. Keeping them local meant opening
 * one sent the estimate modal looking in the store, finding nothing, and blocking on a SECOND
 * round-trip for a record the app was already holding — the pause between tap and sheet.
 */

const summary = (over: Partial<EstimateSummaryDTO> = {}): EstimateSummaryDTO =>
  ({
    id: "est-1", num: "EST-1034", leadId: "lead-1", title: "Quote",
    status: "sent", total: { cents: 73000, currency: "USD" },
    createdAt: "2026-07-31T10:00:00.000Z",
    publicToken: null, publicUrl: null, changeRequestedAt: null,
    recommendedTier: null, acceptedTier: null, tierNames: null,
    termsSnapshot: null, signed: false,
    ...over,
  }) as EstimateSummaryDTO;

const reset = () => useAppStore.setState({ estimates: [] });

describe("adoptEstimateRecord", () => {
  it("puts a header into the store so a sheet can open on it immediately", () => {
    reset();
    useAppStore.getState().adoptEstimateRecord(dtoEstimateSummaryToStore(summary(), { on: false, stage: 0 }));
    const stored = useAppStore.getState().estimates.find((e) => e.id === "est-1");
    expect(stored).toBeTruthy();
    expect(stored!.num).toBe("EST-1034");
  });

  it("carries the total, so the row does not open reading $0", () => {
    reset();
    useAppStore.getState().adoptEstimateRecord(dtoEstimateSummaryToStore(summary(), { on: false, stage: 0 }));
    expect(useAppStore.getState().estimates[0]!.cachedTotal).toBe(730);
  });

  // Lines are absent by design — the modal fetches them. What matters is that the header lands
  // first so there is something to render while that happens.
  it("leaves lines empty, which is what triggers the full fetch on open", () => {
    reset();
    useAppStore.getState().adoptEstimateRecord(dtoEstimateSummaryToStore(summary(), { on: false, stage: 0 }));
    expect(useAppStore.getState().estimates[0]!.lines).toEqual([]);
  });

  it("does not duplicate a quote already in the store", () => {
    reset();
    const rec = dtoEstimateSummaryToStore(summary(), { on: false, stage: 0 });
    useAppStore.getState().adoptEstimateRecord(rec);
    useAppStore.getState().adoptEstimateRecord(rec);
    expect(useAppStore.getState().estimates.filter((e) => e.id === "est-1")).toHaveLength(1);
  });
});
