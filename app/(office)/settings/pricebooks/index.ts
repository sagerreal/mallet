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
export type { TradePricebook };
