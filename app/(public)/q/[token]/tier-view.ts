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
  taxable: line.props.taxable,
});

/**
 * The tier picker structure — only while the quote is tiered and unresolved.
 * Tiers with NO fixed lines are filtered out: the server refuses them at accept
 * (validateTierChoice → empty_tier), so showing them would present a selectable
 * $0.00 non-option. When only one real tier remains, the island hides the
 * picker and renders that tier as a single quote (accept still carries its
 * tier key — the domain requires a tier choice to resolve a tiered estimate).
 */
export function tierViewsFor(estimate: Estimate): PublicTierViews | null {
  const { recommendedTier, acceptedTier, tierNames } = estimate.props;
  if (recommendedTier === null || acceptedTier !== null) return null;
  const tiers = QUOTE_TIERS.map((tier) => {
    const lines = estimate.linesForTier(tier);
    return {
      tier,
      name: tierNames?.[tier] ?? DEFAULT_TIER_LABELS[tier],
      fixedLines: lines.filter((l) => !l.props.isOptional).map(toLineView),
      optionalLines: lines.filter((l) => l.props.isOptional).map(toLineView),
      totalCents: estimate.totalsForTier(tier).total,
    };
  }).filter((t) => t.fixedLines.length > 0);
  if (tiers.length === 0) return null;
  // A sent quote's recommended tier always has fixed lines (the send gate requires
  // a positive subtotal); a previewed draft may not — fall back to the first real
  // tier so the page never defaults to an option the server would refuse.
  const recommended = tiers.some((t) => t.tier === recommendedTier)
    ? recommendedTier
    : tiers[0]!.tier;
  return { recommendedTier: recommended, tiers };
}
