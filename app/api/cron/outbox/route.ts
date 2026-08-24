import { randomUUID } from "node:crypto";
import { loadConfig } from "@mallet/shared/config";
import { secretMatches, readCronSecret } from "@mallet/shared/cron";
import { runWithContext, logger } from "@mallet/shared/observability";
import { runOutboxRelay } from "@mallet/shared/outbox";
import { buildOutboxHandlers } from "@/trpc/outbox-registry";

// Outbox relay trigger. Vercel Cron invokes the scheduled path with a GET carrying
// `Authorization: Bearer <CRON_SECRET>`; we also accept POST + an x-cron-secret header for manual
// draining. A plain Next route (not tRPC): no tenant context, no user — the relay re-scopes per row.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Give a tick room to finish so it isn't truncated mid-batch (honored on Vercel Pro; Hobby caps
// lower). Not a correctness dependency — attempts are burned only on real failures, so a truncated
// tick re-claims its rows next time without poisoning them — but it improves throughput.
export const maxDuration = 60;

const handle = async (req: Request): Promise<Response> => {
  const config = loadConfig();
  if (!config.CRON_SECRET) return new Response("cron not configured", { status: 503 });

  const presented = readCronSecret(req) ?? "";
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
