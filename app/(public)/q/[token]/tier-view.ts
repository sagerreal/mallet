/**
 * app/(public)/q/[token]/tier-view.ts
 *
 * Server-side derivation of the Good/Better/Best picker structure from the
 * domain estimate — the page's twin of the public GET route's tiersToJson.
 *
 * Returns null unless the quote is tiered AND unresolved (recommendedTier set,
 * acceptedTier not yet) — post-accept the estimate's lines already carry the
 * resolved single quote, so the page falls through to the single-format render.
 *
 * Redaction: same as the route — descriptions/quantities/rates only, no costs.
 * Per-tier totals come from the domain's shared rounding chain (totalsForTier).
 */

import { QUOTE_TIERS } from "@/modules/quoting/domain/estimate";
import type { Estimate, EstimateLine, QuoteTier } from "@/modules/quoting/domain/estimate";
import type { QuoteLineView, TierLinesView } from "./QuoteLines";

const DEFAULT_TIER_LABELS: Record<QuoteTier, string> = {
  good: "Good",
  better: "Better",
  best: "Best",
};

export interface PublicTierViews {
  readonly tiers: readonly TierLinesView[];
  readonly recommendedTier: QuoteTier;
}

const toLineView = (line: EstimateLine): QuoteLineView => ({
  id: line.props.id,
  description: line.props.description,
  quantity: line.props.quantity,
  rateCents: line.props.rate,
});

/** The three-option picker structure — only while the quote is tiered and unresolved. */
export function tierViewsFor(estimate: Estimate): PublicTierViews | null {
  const { recommendedTier, acceptedTier, tierNames } = estimate.props;
  if (recommendedTier === null || acceptedTier !== null) return null;
  return {
    recommendedTier,
    tiers: QUOTE_TIERS.map((tier) => {
      const lines = estimate.linesForTier(tier);
      return {
        tier,
        name: tierNames?.[tier] ?? DEFAULT_TIER_LABELS[tier],
        fixedLines: lines.filter((l) => !l.props.isOptional).map(toLineView),
        optionalLines: lines.filter((l) => l.props.isOptional).map(toLineView),
        totalCents: estimate.totalsForTier(tier).total,
      };
    }),
  };
}
