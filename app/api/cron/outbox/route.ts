import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
import { loadConfig } from "@mallet/shared/config";
import { runWithContext, logger } from "@mallet/shared/observability";
import { runOutboxRelay } from "@mallet/shared/outbox";
import { buildOutboxHandlers } from "@/trpc/outbox-registry";

// Outbox relay trigger. Vercel Cron invokes the scheduled path with a GET carrying
// `Authorization: Bearer <CRON_SECRET>`; we also accept POST + an x-cron-secret header for manual
// draining. A plain Next route (not tRPC): no tenant context, no user — the relay re-scopes per row.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Constant-time comparison over fixed-length SHA-256 digests (so unequal lengths don't leak and
// there's no early-exit timing oracle on the secret).
const secretMatches = (presented: string, expected: string): boolean =>
  timingSafeEqual(createHash("sha256").update(presented).digest(), createHash("sha256").update(expected).digest());

const handle = async (req: Request): Promise<Response> => {
  const config = loadConfig();
  if (!config.CRON_SECRET) return new Response("cron not configured", { status: 503 });

  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const presented = bearer ?? req.headers.get("x-cron-secret") ?? "";
  if (!presented || !secretMatches(presented, config.CRON_SECRET)) {
    logger.warn("unauthorized outbox cron request"); // never logs the presented value
    return new Response("unauthorized", { status: 401 });
  }

  return runWithContext({ requestId: randomUUID() }, async () => {
    try {
      const summary = await runOutboxRelay(buildOutboxHandlers());
      return Response.json(summary);
    } catch (error) {
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        "outbox relay tick failed",
      );
      return new Response("relay error", { status: 500 });
    }
  });
};

export const GET = handle;
export const POST = handle;
