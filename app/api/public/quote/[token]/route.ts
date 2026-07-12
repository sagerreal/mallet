import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@mallet/shared/observability";
import { getPublicQuote, acceptPublicQuote, declinePublicQuote, requestChangePublicQuote } from "@/modules/quoting/app/public-quote";
import type { Estimate } from "@/modules/quoting/domain/estimate";

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
  reason: z.string().optional(),
  message: z.string().optional(),
});

// --- Serialisation helpers -------------------------------------------------

const moneyJson = (cents: number) => ({ cents, currency: "USD" });

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
    lines: p.lines.map((l) => {
      const lp = l.props;
      return {
        id: lp.id,
        description: lp.description,
        quantity: lp.quantity,
        rate: moneyJson(lp.rate),
        isOptional: lp.isOptional,
        position: lp.position,
      };
    }),
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
    return NextResponse.json(
      { error: "invalid request", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { action, reason, message } = parsed.data;

  try {
    let estimate;

    if (action === "accept") {
      estimate = await acceptPublicQuote(token);
    } else if (action === "decline") {
      estimate = await declinePublicQuote(token, reason);
    } else {
      // action === "request_change"
      const msg = (message ?? "").trim();
      if (!msg) {
        return NextResponse.json({ error: "message is required" }, { status: 400 });
      }
      estimate = await requestChangePublicQuote(token, msg);
    }

    if (!estimate) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ estimate: estimateToJson(estimate) });
  } catch (err) {
    logger.error({ err, route: "public.quote.POST", action }, "public quote POST failed");
    return NextResponse.json({ error: "temporarily unavailable" }, { status: 503 });
  }
}
