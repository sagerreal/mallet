import type { SeedServiceInput } from "@mallet/pricebook";

/**
 * A starter pricebook for one trade.
 *
 * These are STARTING POINTS a shop edits, never truth. The plumbing pack's own header has always
 * said so ("flat-rate estimates"), and the trade playbooks go further — they refuse to seed a
 * price at all, on the grounds that prices are the owner's. The compromise here: seed real
 * market-rate figures so the catalogue is useful on day one, and make the UI say plainly that
 * they are the shop's to correct. A seeded price nobody looked at is how a shop underbids a job
 * and blames the software.
 *
 * `measuredBy` is what makes the measured trades honest. Roofing sells by the square, fencing by
 * the linear foot, painting by wall area. Seeding those as a flat per-job number would read as a
 * whole-job price and be wrong by an order of magnitude — so a measured line carries the unit it
 * is priced per, and the figure is per THAT unit.
 */
export interface TradePricebook {
  /** Matches a TRADE_PLAYBOOKS key exactly — one vocabulary for the trade across the app. */
  readonly key: string;
  readonly categories: readonly string[];
  readonly services: readonly SeedServiceInput[];
  /** Where the figures came from, so a future editor can re-check them rather than guess. */
  readonly sources: readonly string[];
}
