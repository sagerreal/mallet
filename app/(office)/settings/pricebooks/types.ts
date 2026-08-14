import type { SeedServiceInput, SeedMaterialInput } from "@mallet/pricebook";
import type { TradeKey } from "../trade-playbooks";

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
  /** Matches a TRADE_PLAYBOOKS key exactly — one vocabulary for the trade across the app,
   *  enforced by the shared `TradeKey` type rather than by a comment and a test. */
  readonly key: TradeKey;
  readonly categories: readonly string[];
  readonly services: readonly SeedServiceInput[];
  /**
   * The stock the trade buys and consumes, in the units a supplier sells it in.
   *
   * Optional, and most packs will never have one. A service trade carries its parts on the JOB
   * (a water heater is bought for one address), so a stock list adds nothing. It earns its place
   * where the same few items are consumed across every job and the quantity follows from a
   * measurement — a painter's gallons come straight off wall area, which is exactly what a room
   * scan produces.
   */
  readonly materials?: readonly SeedMaterialInput[];
  /** Where the figures came from, so a future editor can re-check them rather than guess. */
  readonly sources: readonly string[];
}
