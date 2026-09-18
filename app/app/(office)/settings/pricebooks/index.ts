import type { TradePricebook } from "./types";
import { PLUMBING_PRICEBOOK } from "./plumbing";
import { HVAC_PRICEBOOK } from "./hvac";
import { MECHANICAL_PRICEBOOK } from "./mechanical";
import { ELECTRICAL_PRICEBOOK } from "./electrical";
import { ROOFING_PRICEBOOK } from "./roofing";
import { PAINTING_PRICEBOOK } from "./painting";
import { FENCING_PRICEBOOK } from "./fencing";
import { CONCRETE_PRICEBOOK } from "./concrete";
import { SIDING_PRICEBOOK } from "./siding";
import { GUTTERS_PRICEBOOK } from "./gutters";

/**
 * Starter pricebooks, keyed the same way as TRADE_PLAYBOOKS.
 *
 * A shop that picks its trade at signup gets the catalogue for THAT trade. Before this, every org
 * — roofing, electrical, anyone — got the plumbing pack, because it was hard-coded into the seed
 * route. A roofer opening their pricebook to "Replace 40gal gas water heater · $2,400" is being
 * told the product was not built for them.
 *
 * A trade with no entry here seeds NOTHING rather than falling back to another trade's prices.
 * "Other" is deliberately absent for that reason.
 */
const REGISTRY: readonly TradePricebook[] = [
  // Same order as TRADE_PLAYBOOKS: service trades, then the measurement-priced ones.
  HVAC_PRICEBOOK, MECHANICAL_PRICEBOOK, ELECTRICAL_PRICEBOOK, PLUMBING_PRICEBOOK,
  ROOFING_PRICEBOOK, PAINTING_PRICEBOOK, FENCING_PRICEBOOK, CONCRETE_PRICEBOOK,
  SIDING_PRICEBOOK, GUTTERS_PRICEBOOK,
];

export function pricebookFor(trade: string): TradePricebook | undefined {
  return REGISTRY.find((p) => p.key === trade);
}

export const SEEDED_TRADES: readonly string[] = REGISTRY.map((p) => p.key);

/**
 * Does this trade price off measurements?
 *
 * Derived from the trade's own pricebook rather than kept as a second list: a pack with lines
 * priced per sq ft or per linear foot IS a measured trade, by definition. Add a measured line to
 * a pack and the answer updates itself, which is the point — a hand-maintained list of "measured
 * trades" beside a list of measured prices is two things to keep in sync and one to forget.
 *
 * `hour` is excluded. It is a measuredBy value, but hourly work is LABOR — a painting shop billing
 * touch-ups by the hour is not thereby measuring rooms.
 *
 * This replaces the Settings toggle a shop used to flip by hand. Owen's rule: the industry decides
 * this, and it should not be exposed to the customer. The card's own comment already agreed —
 * "a plumbing shop must never see it" — it just had no way to know what the shop was.
 */
export function tradeMeasures(trade: string): boolean {
  const pack = pricebookFor(trade);
  if (!pack) return false;
  return pack.services.some((s) => s.measuredBy != null && s.measuredBy !== "hour");
}

/**
 * Does this trade have any estimating assemblies?
 *
 * NOT derived from the pack, unlike tradeMeasures, and the reason is the whole point. The shipped
 * catalog (modules/assemblies/domain/assembly-defaults.ts) is seven recipes — driveway
 * replacement, asphalt overlay, sealcoat, crack filling, pavers, shingle reroof, roof tune-up.
 * Paving and roofing, and not one of them declares a trade, so there is nothing to derive from.
 *
 * Its `measurementBasis` admits only 'area' and 'perimeter' — aerial site-trace vocabulary. It
 * cannot express a wall, a ceiling, a baseboard run or a door count, so it is not "painting
 * assemblies are missing": it is a different feature that happened to share the measurement
 * switch. A painting shop was being shown a paving shop's recipes.
 *
 * The moment a catalog entry declares its own trade this becomes derivable, and that is the fix —
 * not a longer list here.
 */
export function tradeUsesAssemblies(trade: string): boolean {
  return trade === "roofing" || trade === "concrete";
}
export type { TradePricebook };
