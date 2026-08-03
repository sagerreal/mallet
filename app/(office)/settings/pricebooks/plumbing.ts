import type { TradePricebook } from "./types";
import { PLUMBING_SEED_CATEGORIES, PLUMBING_SEED_SERVICES } from "../pricebook-seed";

/**
 * The original pack, re-expressed as a TradePricebook.
 *
 * The content is untouched — it was written for and sanity-checked against a residential plumbing
 * shop, which is the beachhead. It carries no `sources` because its figures predate the rule that
 * seeded prices must be traceable; every trade added after this one cites where its numbers came
 * from, and this one should be re-checked the next time somebody has a real plumbing price list
 * in front of them.
 */
export const PLUMBING_PRICEBOOK: TradePricebook = {
  key: "plumbing",
  categories: PLUMBING_SEED_CATEGORIES,
  services: PLUMBING_SEED_SERVICES,
  sources: [],
};
