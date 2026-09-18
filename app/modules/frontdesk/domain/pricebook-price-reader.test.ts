import { describe, it, expect } from "vitest";
import { resolveBookingPrices } from "./pricebook-price-reader";
import type { BookingService } from "@mallet/settings";

const svc = (over: Partial<BookingService>): BookingService => ({
  name: "Drain cleaning",
  lane: "flat",
  price: 99,
  triggers: "clogged",
  ...over,
});

const reader = (prices: Record<string, number>) => ({
  unitPricesByIds: async (ids: readonly string[]) =>
    new Map(ids.filter((id) => id in prices).map((id) => [id, prices[id]!])),
});

describe("resolveBookingPrices", () => {
  it("linked service speaks the pricebook's CURRENT price, not its stored copy", async () => {
    const out = await resolveBookingPrices(
      [svc({ pricebookServiceId: "pb-1", price: 99 })],
      reader({ "pb-1": 129 }),
    );
    expect(out[0]?.price).toBe(129);
  });

  it("unlinked services keep their stored price untouched", async () => {
    const out = await resolveBookingPrices([svc({})], reader({ "pb-1": 129 }));
    expect(out[0]?.price).toBe(99);
  });

  it("a dangling link (archived pricebook entry) falls back to the stored price — never a silent zero", async () => {
    const out = await resolveBookingPrices([svc({ pricebookServiceId: "pb-gone", price: 99 })], reader({}));
    expect(out[0]?.price).toBe(99);
  });

  it("no reader wired → services pass through byte-identical", async () => {
    const services = [svc({ pricebookServiceId: "pb-1" })];
    const out = await resolveBookingPrices(services, undefined);
    expect(out).toBe(services);
  });
});
