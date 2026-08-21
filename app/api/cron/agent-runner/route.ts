import { randomUUID } from "node:crypto";
import { loadConfig } from "@mallet/shared/config";
import { readCronSecret, secretMatches } from "@mallet/shared/cron";
import { logger, runWithContext } from "@mallet/shared/observability";
import { runAgentTaskTick } from "@mallet/agent-tasks";
import { SYSTEM_PROMPT } from "@mallet/ai";
import { getAppDeps } from "@/trpc/di";

/**
 * app/api/cron/agent-runner/route.ts
 * Wakes the AI employee's due tasks. One bounded tick per invocation.
 *
 * ZERO PARAMETERS, deliberately: CRON_SECRET is a single install-wide credential, so a route that
 * accepted an org or a task id would turn a leaked secret from "drain the queue early" into
 * "act on any tenant I choose."
 *
 * Fail-closed in both directions, exactly like the outbox route: secret unset -> 503 (never run
 * unauthenticated), missing or wrong -> 401. Never log or echo the presented value.
 *
 * A truncated tick is safe and expected: the lease (see claim-due-tasks.ts) expires and the next
 * tick re-claims the task, and the execution ledger means no committed side effect repeats.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One wake is one LLM round trip plus a few short per-task transactions; WAKE_BATCH (5) sequential
// wakes is what actually keeps a tick inside this ceiling, not the ceiling itself. 300s is the
// Vercel Node function max (needs a plan that permits it) and gives a batch of slow wakes room to
// finish rather than being truncated mid-turn.
export const maxDuration = 300;

const handle = async (req: Request): Promise<Response> =>
  runWithContext({ requestId: randomUUID() }, async () => {
    const config = loadConfig();
    if (!config.CRON_SECRET) {
      logger.warn({}, "agent.cron.unconfigured");
      return Response.json({ error: "cron not configured" }, { status: 503 });
    }

    const presented = readCronSecret(req);
    if (!presented || !secretMatches(presented, config.CRON_SECRET)) {
      logger.warn({}, "agent.cron.unauthorized"); // never logs the presented value
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    const deps = getAppDeps();
    if (!deps.llmClient) {
      logger.warn({}, "agent.cron.no-llm");
      return Response.json({ error: "the assistant is not switched on for this server" }, { status: 503 });
    }

    const summary = await runAgentTaskTick({
      llm: deps.llmClient,
      clock: deps.clock,
      ids: deps.ids,
      notificationSender: deps.notificationSender,
      paymentLinkGateway: deps.paymentLinkGateway,
      systemPrompt: SYSTEM_PROMPT,
    });
    return Response.json(summary, { status: 200 });
  });

export const GET = handle;
export const POST = handle;
