import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { logger } from "@mallet/shared/observability";
import { FixedWindowLimiter } from "@mallet/platform/resilience";
import { getPublicInvoice, createPublicInvoiceCheckout } from "@/modules/invoicing/app/public-invoice";
import type { PublicInvoiceView } from "@/modules/invoicing/app/public-invoice";

// Public, unauthenticated route handlers for the customer-facing invoice page — same security
// model as the public quote route: the unguessable public_token (64 hex chars, 256 bits of
// entropy) is the sole access credential. No session, no bearer token. A token that does not
// match returns 404; server errors never leak to the caller.
//
// GET  /api/public/invoice/[token] — fetch the redacted invoice view
// POST /api/public/invoice/[token] — body: { action: "create_checkout" } → { url }

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Token format: 64 hex characters (32 bytes, base16). Validates before hitting the DB.
const TOKEN_RE = /^[0-9a-f]{64}$/i;

// Per-token throttle (per warm instance — damping, not a hard global cap; see the limiter's own
// note). Generous: a real customer refreshes a handful of times, not sixty. The POST budget is
// tighter because each call reaches Stripe (the stable idempotency key makes retries reuse one
// session, but the round-trips still count toward quota and the shared breaker).
const getLimiter = new FixedWindowLimiter({ limit: 60, windowMs: 60_000 });
const checkoutLimiter = new FixedWindowLimiter({ limit: 10, windowMs: 60_000 });

const throttled = (): NextResponse =>
  NextResponse.json({ error: "too many requests — try again in a minute" }, { status: 429 });

const postBodySchema = z.object({
  action: z.literal("create_checkout"),
});

const viewToJson = (view: PublicInvoiceView) => ({
  orgName: view.orgName,
  num: view.num,
  title: view.title,
  status: view.status,
  lines: view.lines,
  totalCents: view.totalCents,
  taxCents: view.taxCents,
  depositPaidCents: view.depositPaidCents,
  amountPaidCents: view.amountPaidCents,
  balanceDueCents: view.balanceDueCents,
  termsDays: view.termsDays,
  dueAt: view.dueAt?.toISOString() ?? null,
  poNumber: view.poNumber,
  chargesEnabled: view.chargesEnabled,
});

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
    const view = await getPublicInvoice(token);
    if (!view) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json(viewToJson(view));
  } catch (err) {
    // Never leak the raw error to an unauthenticated caller; log it server-side and 503.
    logger.error({ err, route: "public.invoice.GET" }, "public invoice GET failed");
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
  if (!checkoutLimiter.allow(token)) return throttled();

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

  try {
    const outcome = await createPublicInvoiceCheckout(token);
    switch (outcome.kind) {
      case "ok":
        return NextResponse.json({ url: outcome.url });
      case "not_found":
        return NextResponse.json({ error: "not found" }, { status: 404 });
      case "rejected":
        // Deterministic guard failure (already paid, no balance, cards not set up) — the message
        // is customer-appropriate copy composed in the module, not the office wording.
        return NextResponse.json({ error: outcome.message }, { status: 409 });
      case "unavailable":
        return NextResponse.json(
          { error: "The payment provider is temporarily unavailable — try again in a minute." },
          { status: 503 },
        );
    }
  } catch (err) {
    logger.error({ err, route: "public.invoice.POST" }, "public invoice POST failed");
    return NextResponse.json({ error: "temporarily unavailable" }, { status: 503 });
  }
}
