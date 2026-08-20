import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@mallet/shared/observability";
import { FixedWindowLimiter } from "@mallet/platform/resilience";
import { getPublicQuote, acceptPublicQuote, declinePublicQuote, requestChangePublicQuote } from "@/modules/quoting/app/public-quote";
import type { AcceptPublicQuoteResult, RequestChangeResult } from "@/modules/quoting/app/public-quote";
import { createPublicDepositCheckout } from "@/modules/quoting/app/public-quote-deposit";
import type { TierChoiceRejection } from "@/modules/quoting/app/public-accept-policy";
import { QUOTE_TIERS } from "@/modules/quoting/domain/estimate";
import type { Estimate, QuoteTier } from "@/modules/quoting/domain/estimate";
import type { SignatureDraft } from "@/modules/quoting/domain/signature";

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

// Per-token throttle (per warm instance — damping, see FixedWindowLimiter's note). Same
// mechanism as the public invoice route. POST is tighter: accept/decline write, and a signature
// retry loop is a handful of attempts, never twenty a minute.
const getLimiter = new FixedWindowLimiter({ limit: 60, windowMs: 60_000 });
const actionLimiter = new FixedWindowLimiter({ limit: 20, windowMs: 60_000 });

const throttled = (): NextResponse =>
  NextResponse.json({ error: "too many requests — try again in a minute" }, { status: 429 });

const postBodySchema = z.object({
  action: z.enum(["accept", "decline", "request_change", "create_deposit_checkout"]),
  reason: z.string().max(500).optional(),
  message: z.string().trim().min(1).max(2000).optional(),
  // Accept-time selection of OPTIONAL add-on line IDs. SECURITY: an ID subset only —
  // line content (descriptions, quantities, prices) always comes from the stored
  // estimate, so a token holder can never author or reprice lines.
  selectedLineIds: z.array(z.string().uuid()).max(50).optional(),
  // Good/Better/Best choice. Required when the quote is tiered, rejected when it isn't
  // (validated against the STORED estimate — the enum here only bounds the value set).
  chosenTier: z.enum(["good", "better", "best"]).optional(),
  // Signature evidence. Only these two fields are accepted from the client: the IP, the user
  // agent, the timestamp and the document snapshot are all taken server-side, because a
  // client-declared value is worthless as evidence and worse than absent — it looks like proof.
  // Bounds mirror the domain's so a payload is rejected at the edge, before it reaches a tx.
  signerName: z.string().trim().min(1).max(120).optional(),
  signatureSvg: z.string().trim().min(1).max(100_000).optional(),
});

/**
 * The client's IP, best effort.
 *
 * Vercel sets `x-forwarded-for` and it is not spoofable by the browser — the platform overwrites
 * whatever the caller sent. Behind any other proxy it could be forged, which is why this is
 * corroborating evidence next to the name and the drawn mark rather than an identity claim.
 * The leftmost entry is the original client; the rest are proxies.
 */
const clientIp = (req: NextRequest): string | null =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  req.headers.get("x-real-ip")?.trim() ||
  null;

// --- Serialisation helpers -------------------------------------------------

const moneyJson = (cents: number) => ({ cents, currency: "USD" });

// Redacted line shape for the unauthenticated page: NO cost, NO needsPhoto, NO subItems —
// sub-items are the shop's internal estimating math, exactly as private as cost.
const lineToJson = (l: Estimate["props"]["lines"][number]) => {
  const lp = l.props;
  return {
    id: lp.id,
    description: lp.description,
    quantity: lp.quantity,
    rate: moneyJson(lp.rate),
    isOptional: lp.isOptional,
    taxable: lp.taxable,
    position: lp.position,
    tier: lp.tier,
    scope: lp.scope ?? null,
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
    priceDisplay: estimate.priceDisplay(),
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
  if (!getLimiter.allow(token)) return throttled();

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
  signature: SignatureDraft | undefined,
): Promise<NextResponse> {
  const acceptResult: AcceptPublicQuoteResult = await acceptPublicQuote(
    token,
    selectedLineIds,
    chosenTier,
    signature,
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
  if (acceptResult.kind === "invalid_signature") {
    // The domain's own wording ("please type your name to sign") — it already names the problem
    // and the next step, so rewriting it here would only let the two drift apart.
    return NextResponse.json(
      { error: acceptResult.message, field: acceptResult.field },
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

/**
 * Start a Stripe-hosted checkout for the deposit still owed on this quote.
 *
 * No body beyond the action: the amount, the estimate and the org all come from stored data. The
 * customer holding the link may not name a price. Rejections carry the use-case's own copy, which
 * is already written for this reader (see CreateDepositCheckoutUseCase).
 */
async function handleDepositCheckout(token: string): Promise<NextResponse> {
  const outcome = await createPublicDepositCheckout(token);
  if (outcome.kind === "ok") return NextResponse.json({ url: outcome.url });
  if (outcome.kind === "not_found") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (outcome.kind === "unavailable") {
    return NextResponse.json(
      { error: "Card payment is temporarily unavailable — try again in a few minutes." },
      { status: 503 },
    );
  }
  return NextResponse.json({ error: outcome.message }, { status: 409 });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;

  if (!TOKEN_RE.test(token)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (!actionLimiter.allow(token)) return throttled();

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

  const { action, reason, message, selectedLineIds, chosenTier, signerName, signatureSvg } =
    parsed.data;

  try {
    if (action === "accept") {
      // Half a signature is not a signature. If either field is present, BOTH must be — sending
      // only one through would let the domain reject it with a field error the page can act on,
      // but sending neither is the office-style unsigned accept, which stays legal.
      const signature: SignatureDraft | undefined =
        signerName !== undefined || signatureSvg !== undefined
          ? {
              signerName: signerName ?? "",
              signatureSvg: signatureSvg ?? "",
              signerIp: clientIp(req),
              signerUserAgent: req.headers.get("user-agent"),
            }
          : undefined;
      return await handleAccept(token, selectedLineIds, chosenTier, signature);
    }

    if (action === "create_deposit_checkout") {
      return await handleDepositCheckout(token);
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
