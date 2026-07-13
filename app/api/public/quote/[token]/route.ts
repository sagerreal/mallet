import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@mallet/shared/observability";
import { getPublicQuote, acceptPublicQuote, declinePublicQuote, requestChangePublicQuote } from "@/modules/quoting/app/public-quote";
import type { AcceptPublicQuoteResult, RequestChangeResult } from "@/modules/quoting/app/public-quote";
import type { TierChoiceRejection } from "@/modules/quoting/app/public-accept-policy";
import { QUOTE_TIERS } from "@/modules/quoting/domain/estimate";
import type { Estimate, QuoteTier } from "@/modules/quoting/domain/estimate";

// Public, unauthenticated route handlers for the customer-facing quote page.
// Security model: the unguessable public_token (64 hex chars, 256 bits of entropy) is the
// sole access credential — no session, no bearer token. A token that does not match returns 404.
//
// GET  /api/public/quote/[token] — fetch quote + stamp viewed
// POST /api/public/quote/[token] — body: { action: "accept" | "decline", reason?: string }

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Token format: 64 hex characters (32 bytes, base16). Validates before hitting the DB.
const TOKEN_RE = /^[0-9a-f]{64}$/i;

const postBodySchema = z.object({
  action: z.enum(["accept", "decline", "request_change"]),
  reason: z.string().max(500).optional(),
  message: z.string().trim().min(1).max(2000).optional(),
  // Accept-time selection of OPTIONAL add-on line IDs. SECURITY: an ID subset only —
  // line content (descriptions, quantities, prices) always comes from the stored
  // estimate, so a token holder can never author or reprice lines.
  selectedLineIds: z.array(z.string().uuid()).max(50).optional(),
  // Good/Better/Best choice. Required when the quote is tiered, rejected when it isn't
  // (validated against the STORED estimate — the enum here only bounds the value set).
  chosenTier: z.enum(["good", "better", "best"]).optional(),
});

// --- Serialisation helpers -------------------------------------------------

const moneyJson = (cents: number) => ({ cents, currency: "USD" });

// Redacted line shape for the unauthenticated page: NO cost, NO needsPhoto.
const lineToJson = (l: Estimate["props"]["lines"][number]) => {
  const lp = l.props;
  return {
    id: lp.id,
    description: lp.description,
    quantity: lp.quantity,
    rate: moneyJson(lp.rate),
    isOptional: lp.isOptional,
    position: lp.position,
    tier: lp.tier,
  };
};

const DEFAULT_TIER_LABELS: Record<QuoteTier, string> = {
  good: "Good",
  better: "Better",
  best: "Best",
};

// The tier picker structure — only while the quote is tiered AND unresolved.
// Post-accept the lines array already carries the resolved single quote. Per-tier totals
// come from the domain's shared rounding chain (totalsForTier), never recomputed here.
// Tiers with NO fixed lines are omitted (the page's tier-view.ts twin does the same):
// accept refuses them (empty_tier), so they are not real options. All-empty → null.
const tiersToJson = (estimate: Estimate) => {
  const p = estimate.props;
  if (p.recommendedTier === null || p.acceptedTier !== null) return null;
  const tiers = QUOTE_TIERS.map((tier) => {
    const lines = estimate.linesForTier(tier);
    return {
      tier,
      name: p.tierNames?.[tier] ?? DEFAULT_TIER_LABELS[tier],
      fixedLines: lines.filter((l) => !l.props.isOptional).map(lineToJson),
      optionalLines: lines.filter((l) => l.props.isOptional).map(lineToJson),
      total: moneyJson(estimate.totalsForTier(tier).total),
    };
  }).filter((t) => t.fixedLines.length > 0);
  return tiers.length > 0 ? tiers : null;
};

const estimateToJson = (estimate: Estimate) => {
  const p = estimate.props;
  return {
    id: p.id,
    num: p.num,
    title: p.title,
    status: p.status,
    discBps: p.discBps,
    taxBps: p.taxBps,
    depBps: p.depBps,
    lines: p.lines.map(lineToJson),
    recommendedTier: p.recommendedTier,
    acceptedTier: p.acceptedTier,
    tiers: tiersToJson(estimate),
    termsSnapshot: p.termsSnapshot,
    subtotal: moneyJson(estimate.subtotal()),
    discount: moneyJson(estimate.discountAmount()),
    tax: moneyJson(estimate.taxAmount()),
    total: moneyJson(estimate.total()),
    depositDue: moneyJson(estimate.depositDue()),
    validDays: p.validDays,
    sentAt: p.sentAt?.toISOString() ?? null,
    acceptedAt: p.acceptedAt?.toISOString() ?? null,
    declinedAt: p.declinedAt?.toISOString() ?? null,
    declineReason: p.declineReason,
    changeRequestedAt: p.changeRequestedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
};

// --- GET ------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;

  if (!TOKEN_RE.test(token)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const view = await getPublicQuote(token);
    if (!view) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    return NextResponse.json({
      orgName: view.orgName,
      customerFirstName: view.customerFirstName,
      estimate: estimateToJson(view.estimate),
    });
  } catch (err) {
    // Never leak the raw error to an unauthenticated caller; log it server-side and 503.
    logger.error({ err, route: "public.quote.GET" }, "public quote GET failed");
    return NextResponse.json({ error: "temporarily unavailable" }, { status: 503 });
  }
}

// --- POST -----------------------------------------------------------------

// Functional copy for a rejected tier choice — names the actual problem per reason.
const TIER_REJECTION_COPY: Record<TierChoiceRejection, string> = {
  required: "Choose an option to approve this quote.",
  not_applicable: "This quote has a single option — reload the page and try again.",
  empty_tier: "That option isn't available on this quote — reload the page and try again.",
};

/** Map an accept outcome to its HTTP response (extracted to keep POST small). */
async function handleAccept(
  token: string,
  selectedLineIds: string[] | undefined,
  chosenTier: QuoteTier | undefined,
): Promise<NextResponse> {
  const acceptResult: AcceptPublicQuoteResult = await acceptPublicQuote(
    token,
    selectedLineIds,
    chosenTier,
  );
  if (acceptResult.kind === "not_found") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (acceptResult.kind === "invalid_selection") {
    // A selected add-on id no longer matches a stored optional line — the quote
    // changed since the page loaded (or the id was fabricated).
    return NextResponse.json(
      { error: "This quote was updated — reload the page and try again." },
      { status: 400 },
    );
  }
  if (acceptResult.kind === "invalid_tier") {
    return NextResponse.json(
      { error: TIER_REJECTION_COPY[acceptResult.reason] },
      { status: 400 },
    );
  }
  if (acceptResult.kind === "not_ready") {
    // The estimate exists but is not in an acceptable, non-terminal state
    // (e.g. a draft link shared early). Nothing was accepted — say so.
    return NextResponse.json(
      { error: "This quote isn't ready to approve yet." },
      { status: 409 },
    );
  }
  return NextResponse.json({ estimate: estimateToJson(acceptResult.estimate) });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;

  if (!TOKEN_RE.test(token)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { action, reason, message, selectedLineIds, chosenTier } = parsed.data;

  try {
    if (action === "accept") {
      return await handleAccept(token, selectedLineIds, chosenTier);
    }

    if (action === "decline") {
      const estimate = await declinePublicQuote(token, reason);
      if (!estimate) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }
      return NextResponse.json({ estimate: estimateToJson(estimate) });
    }

    // action === "request_change"
    // Note: the schema already enforces message is non-empty (min(1)) and trimmed.
    const msg = message ?? "";
    const changeResult: RequestChangeResult = await requestChangePublicQuote(token, msg);

    if (changeResult.kind === "not_found") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (changeResult.kind === "cooldown") {
      return NextResponse.json(
        { error: "You just sent a request — give it a few minutes before sending another." },
        { status: 429 },
      );
    }
    if (changeResult.kind === "not_sent") {
      if (!changeResult.estimate) {
        return NextResponse.json({ error: "not found" }, { status: 404 });
      }
      return NextResponse.json({ estimate: estimateToJson(changeResult.estimate) });
    }
    // kind === "ok"
    return NextResponse.json({ estimate: estimateToJson(changeResult.estimate) });
  } catch (err) {
    logger.error({ err, route: "public.quote.POST", action }, "public quote POST failed");
    return NextResponse.json({ error: "temporarily unavailable" }, { status: 503 });
  }
}
