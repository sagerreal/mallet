// Field copilot tRPC router — the `run` endpoint for the tech-facing AI advisor.
//
// Design (mirrors ai-router.ts NoTx pattern):
//   - anyRoleNoTx: no single DB tx spans the multi-round-trip model loop.
//   - Auth check (assertOnJobIfTech + job existence) runs in ONE short withTenant tx.
//   - Each tool call opens its own short withTenant tx (closure via buildFieldTools deps).
//   - The model NEVER supplies jobId — tools are closed over the VERIFIED jobId.
//
// Advise-only: all tools are mutating:false; no resume/approval path here.

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, anyRoleNoTx } from "@/trpc/init";
import { withTenant } from "@mallet/shared/db/tx";
import type { Principal } from "@mallet/identity";
import type { AppDeps } from "@/trpc/deps";
import { runAgentTurn, type AgentResult, type ExecuteTool, type ToolMeta } from "../app/run-agent-turn";
import { LlmError, type AgentMessage } from "../domain/llm-client";
import { buildFieldTools } from "../infra/tools/field-read-tools";
import { buildFieldPrompt } from "../app/field-copilot-prompt";
import { DrizzleJobRepository } from "../../jobs/infra/drizzle-job-repository";
import { DrizzleSettingsRepository } from "../../settings/infra/drizzle-settings-repository";
import { asJobId } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";

// ---------------------------------------------------------------------------
// Transcript schema (cloned from ai-router — no cross-module private import)
// Validates untrusted client-round-tripped conversation state. Tenancy is always
// re-derived server-side; this guards against structurally malformed payloads.
// ---------------------------------------------------------------------------

const assistantBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("thinking"), thinking: z.string(), signature: z.string() }),
  z.object({ type: z.literal("redacted_thinking"), data: z.string() }),
  z.object({ type: z.literal("tool_use"), id: z.string(), name: z.string(), input: z.unknown() }),
]);

const transcriptSchema = z.array(
  z.union([
    z.object({ role: z.literal("user"), kind: z.literal("text"), text: z.string() }),
    z.object({
      role: z.literal("user"),
      kind: z.literal("tool_results"),
      results: z.array(
        z.object({ toolUseId: z.string(), content: z.string(), isError: z.boolean().optional() }),
      ),
    }),
    z.object({
      role: z.literal("assistant"),
      kind: z.literal("assistant"),
      blocks: z.array(assistantBlockSchema),
    }),
  ]),
);

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

const copilotRunOutput = z.object({
  status: z.enum(["completed", "refused"]),
  text: z.string(),
  transcript: z.array(z.unknown()),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const createFieldCopilotRouter = () =>
  router({
    run: anyRoleNoTx
      .input(
        z.object({
          jobId: z.string().uuid(),
          message: z.string().min(1).max(2000),
          transcript: transcriptSchema.optional(),
        }),
      )
      .output(copilotRunOutput)
      .mutation(async ({ ctx, input }) => {
        const { principal, deps } = ctx;
        if (!deps.llmClient) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "the AI assistant is not enabled (ANTHROPIC_API_KEY unset)",
          });
        }

        const jobId = asJobId(input.jobId);

        // Short auth-check tx: assertOnJobIfTech + job existence + getTechSeesPrice.
        // Closed before the slow model round-trips.
        const { seesPrice } = await withTenant(principal.orgId, async (tx) => {
          const repo = new DrizzleJobRepository(tx, principal.orgId);

          if (principal.role === "tech") {
            // assertOnJobIfTech: throws NOT_FOUND or FORBIDDEN for tech callers.
            const job = await repo.findById(jobId);
            if (!job) {
              throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
            }
            if (!job.isAssignedTo(principal.userId)) {
              throw new TRPCError({ code: "FORBIDDEN", message: "this job isn't assigned to you" });
            }
          } else {
            // Owner/office: verify the job exists and is not deleted.
            const job = await repo.findById(jobId);
            if (!job) {
              throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
            }
          }

          const settingsRepo = new DrizzleSettingsRepository(tx, principal.orgId);
          const techSeesPrice = await settingsRepo.getTechSeesPrice();
          // Owner/office always see prices; only techs are subject to the org setting.
          const resolved = principal.role === "tech" ? techSeesPrice : true;
          return { seesPrice: resolved };
        });

        return runFieldTurn(principal, deps, {
          jobId: input.jobId,
          message: input.message,
          priorMessages: input.transcript,
          seesPrice,
        });
      }),
  });

// ---------------------------------------------------------------------------
// Field turn driver (read-only, advise-only — no mutating tools, no resume)
// ---------------------------------------------------------------------------

const runFieldTurn = async (
  principal: Principal,
  deps: AppDeps,
  params: {
    readonly jobId: string;
    readonly message: string;
    readonly priorMessages?: AgentMessage[];
    readonly seesPrice: boolean;
  },
): Promise<{ status: "completed" | "refused"; text: string; transcript: unknown[] }> => {
  if (!deps.llmClient) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "the AI assistant is not enabled (ANTHROPIC_API_KEY unset)",
    });
  }

  const jobId = asJobId(params.jobId);
  const orgId = principal.orgId;

  // Build tools closed over the VERIFIED jobId and seesPrice.
  // Each tool execute() call opens its own short withTenant tx — mirrors the
  // NoTx composition in ai-router.ts:394-415.
  const fieldTools = buildFieldTools({ withTx: withTenant })({ orgId, jobId, seesPrice: params.seesPrice });
  const metas: ToolMeta[] = fieldTools.map((t) => t.meta);

  const execute: ExecuteTool = (name, input) => {
    const tool = fieldTools.find((t) => t.meta.name === name);
    if (!tool) return Promise.resolve({ ok: false as const, error: `unknown tool: ${name}` });
    return tool.execute(input);
  };

  let result: AgentResult;
  try {
    result = await runAgentTurn({
      llm: deps.llmClient,
      system: buildFieldPrompt({ seesPrice: params.seesPrice }),
      tools: metas,
      execute,
      userMessage: params.message,
      priorMessages: params.priorMessages,
      effort: "medium",
      maxIters: 6,
    });
  } catch (error) {
    if (error instanceof LlmError) {
      throw new TRPCError({
        code: error.retryable ? "TOO_MANY_REQUESTS" : "BAD_GATEWAY",
        message: "the AI assistant is temporarily unavailable — please try again",
      });
    }
    throw error;
  }

  logger.info(
    {
      orgId,
      userId: principal.userId,
      role: principal.role,
      jobId: params.jobId,
      status: result.status,
      transcriptMessages: result.transcript.length,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      cacheReadTokens: result.usage.cacheReadTokens,
    },
    "copilot.turn.completed",
  );

  // needs_approval cannot happen (all tools are mutating:false), but handle defensively.
  if (result.status === "needs_approval") {
    return { status: "completed", text: result.assistantText, transcript: result.transcript };
  }

  return { status: result.status, text: result.text, transcript: result.transcript };
};
