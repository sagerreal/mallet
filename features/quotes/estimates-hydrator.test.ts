/**
 * features/quotes/estimates-hydrator.test.ts
 *
 * Guards the LIST → store mapping, which is the path the store takes after a page refresh.
 *
 * There are two dto→store estimate mappings in this app: the full one in lib/store/dto-mapper.ts
 * (modal open, mutation reconcile) and this summary one. A field added to only the first works
 * perfectly until someone reloads the page — which is exactly how the customer quote link broke:
 * publicUrl rode the full DTO, the hydrator dropped it, and Send then refused after any refresh.
 */
import { describe, it, expect } from "vitest";
import { toStoreEstimate } from "./estimates-hydrator";

type SummaryDTO = Parameters<typeof toStoreEstimate>[0];

const summary = (over: Partial<SummaryDTO> = {}): SummaryDTO =>
  ({
    id: "11111111-1111-1111-1111-111111111111",
    num: "Q-1042",
    leadId: "22222222-2222-2222-2222-222222222222",
    title: "Water heater swap",
    status: "sent",
    total: { cents: 125_000, currency: "USD" },
    createdAt: new Date().toISOString(),
    publicToken: "c".repeat(64),
    publicUrl: `https://app.example.com/q/${"c".repeat(64)}`,
    changeRequestedAt: null,
    recommendedTier: null,
    acceptedTier: null,
    tierNames: null,
    termsSnapshot: null,
    ...over,
  }) as SummaryDTO;

describe("toStoreEstimate — the share link survives a refresh", () => {
  it("carries the server-composed publicUrl through", () => {
    const est = toStoreEstimate(summary());
    expect(est.publicUrl).toBe(`https://app.example.com/q/${"c".repeat(64)}`);
    expect(est.publicToken).toBe("c".repeat(64));
  });

  it("maps a null publicUrl to undefined so the send path can refuse on it", () => {
    // Null means the server could resolve no canonical origin. It must arrive as absent, not as
    // the string "null" or an empty string that would sail through a truthiness check downstream.
    const est = toStoreEstimate(summary({ publicUrl: null, publicToken: null }));
    expect(est.publicUrl).toBeUndefined();
    expect(est.publicToken).toBeUndefined();
  });

  it("converts the total from cents to dollars", () => {
    expect(toStoreEstimate(summary()).cachedTotal).toBe(1250);
  });
});
