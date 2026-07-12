import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@mallet/shared/db/tx";
import { ownerDb } from "@mallet/shared/db/owner-client";
import { inboundEndpoints, orgs } from "@mallet/shared/db/schema";
import { OutboxEventBus } from "@mallet/shared/outbox";
import { runWithContext, enrichRequestContext, logger } from "@mallet/shared/observability";
import { getAppDeps } from "@/trpc/di";
import {
  DrizzleInboundEndpointResolver,
  DrizzleInboundEndpointRepository,
  DrizzleLeadReceiptRepository,
  IngestExternalLeadUseCase,
  parserFor,
  isChannel,
} from "@mallet/inbound";
import { EnsureCustomerUseCase, DrizzleLeadRepository } from "@mallet/customers";

// Public, unauthenticated inbound-lead route (a plain Next route, NOT tRPC). A per-org unguessable
// token in the URL is the sole credential — the org is resolved from it via a privileged ownerDb
// lookup (same model as the public quote page + Twilio webhook); org id is NEVER taken from the
// body. All writes run inside withTenant so RLS still scopes them. PR A wires the `form` channel;
// angi/thumbtack parsers arrive in PR B (parserFor returns null → 404 until then).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TOKEN_RE = /^[0-9a-f]{64}$/;
// Channel → the lead-source label stamped on the created lead (feeds the pipeline + Source list).
const SOURCE: Record<string, string> = { form: "Website", angi: "Angi", thumbtack: "Thumbtack" };

type Params = { params: Promise<{ channel: string; token: string }> };

export async function POST(req: Request, { params }: Params): Promise<Response> {
  const { channel, token } = await params;
  // Validate at the boundary before any DB access.
  if (!isChannel(channel) || !TOKEN_RE.test(token)) {
    return new NextResponse("not found", { status: 404 });
  }
  const parser = parserFor(channel);
  if (!parser) return new NextResponse("channel not enabled", { status: 404 }); // angi/thumbtack → PR B

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return new NextResponse("invalid body", { status: 400 });
  }
  const parsed = parser.parse(payload);
  if (!parsed.ok) return new NextResponse("invalid submission", { status: 400 });

  const deps = getAppDeps();
  return runWithContext({ requestId: deps.ids.newId() }, async () => {
    // Privileged, pre-tenant token→org resolution (returns only { orgId, channel }).
    const resolved = await new DrizzleInboundEndpointResolver().resolve(token);
    if (!resolved || resolved.channel !== channel) {
      logger.warn({ channel }, "inbound.rejected_unknown_token");
      return new NextResponse("not found", { status: 404 });
    }
    enrichRequestContext({ orgId: resolved.orgId });

    const result = await withTenant(resolved.orgId, async (tx) => {
      // Tx-bound outbox bus so EnsureCustomer's customer.created event lands durably (matches the
      // public-quote accept path). The InMemoryEventBus from getAppDeps is NOT used here.
      const bus = new OutboxEventBus(tx, resolved.orgId);
      const ensure = new EnsureCustomerUseCase(new DrizzleLeadRepository(tx, resolved.orgId), bus, deps.clock);
      const uc = new IngestExternalLeadUseCase(
        ensure,
        new DrizzleLeadReceiptRepository(tx, resolved.orgId),
        new DrizzleInboundEndpointRepository(tx, resolved.orgId),
        deps.clock,
      );
      return uc.exec({ channel, source: SOURCE[channel]!, lead: parsed.value });
    });

    if (!result.ok) {
      logger.error({ channel }, "inbound.ingest_failed");
      return new NextResponse("could not accept lead", { status: 422 });
    }
    return NextResponse.json({ ok: true });
  });
}

// GET: the public form page fetches the shop's brand name to render a branded form. Form channel
// only; privileged ownerDb lookup joining orgs by token; returns minimal { brand: { name } }.
export async function GET(_req: Request, { params }: Params): Promise<Response> {
  const { channel, token } = await params;
  if (channel !== "form" || !TOKEN_RE.test(token)) {
    return new NextResponse("not found", { status: 404 });
  }
  const rows = await ownerDb
    .select({ orgName: orgs.name })
    .from(inboundEndpoints)
    .innerJoin(orgs, eq(orgs.id, inboundEndpoints.orgId))
    .where(
      and(
        eq(inboundEndpoints.token, token),
        eq(inboundEndpoints.channel, "form"),
        isNull(inboundEndpoints.deletedAt),
      ),
    )
    .limit(1);
  if (!rows[0]) return new NextResponse("not found", { status: 404 });
  return NextResponse.json({ brand: { name: rows[0].orgName } });
}
