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
import { LlmError, type AgentMessage, type UserContentBlock } from "../domain/llm-client";
import { buildFieldTools } from "../infra/tools/field-read-tools";
import { buildFieldPrompt } from "../app/field-copilot-prompt";
import { DrizzleJobRepository } from "../../jobs/infra/drizzle-job-repository";
import { DrizzleSettingsRepository } from "../../settings/infra/drizzle-settings-repository";
import { asJobId, type OrgId, type JobId } from "@mallet/shared/types";
import { logger } from "@mallet/shared/observability";
import { resolvePhotoPaths, sanitiseTranscript } from "./field-copilot-helpers";

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
          photoIds: z.array(z.string().uuid()).max(3).optional(),
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

        // Short auth-check tx: assertOnJobIfTech + job existence + getTechSeesPrice
        // + resolve photo storagePaths. Closed before the slow model round-trips
        // and any external download calls (NoTx discipline).
        const { seesPrice, storagePaths } = await withTenant(principal.orgId, async (tx) => {
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

          // Resolve photoIds → storagePaths, verifying they belong to this exact job.
          let resolvedPaths: readonly string[] = [];
          if (input.photoIds && input.photoIds.length > 0) {
            const execution = await repo.listExecution(jobId);
            resolvedPaths = resolvePhotoPaths(input.photoIds, execution.photos.map((p) => p.props), jobId);
          }

          return { seesPrice: resolved, storagePaths: resolvedPaths };
        });

        return runFieldTurn(principal, deps, {
          jobId: input.jobId,
          message: input.message,
          priorMessages: input.transcript,
          seesPrice,
          storagePaths,
        });
      }),
  });

// ---------------------------------------------------------------------------
// Image download helper (outside any tx — NoTx discipline)
// ---------------------------------------------------------------------------

/** Downloads photos from storage and returns UserContentBlock image entries.
 *  A failed download throws PRECONDITION_FAILED so the caller never silently
 *  produces advice that ignored a broken photo. */
const downloadPhotoBlocks = async (
  storagePaths: readonly string[],
  orgId: OrgId,
  jobId: JobId,
  gateway: NonNullable<AppDeps["photoStorageGateway"]>,
): Promise<readonly UserContentBlock[]> => {
  const blocks: UserContentBlock[] = [];
  for (const storagePath of storagePaths) {
    const result = await gateway.download(storagePath, { orgId, jobId });
    if (!result.ok) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `photo could not be loaded (${result.error.message}) — re-upload and try again`,
      });
    }
    const { dataBase64, mediaType } = result.value;
    // Narrow mediaType to the allowed union. The gateway guarantees this set,
    // but we guard here so the type system is satisfied without `any`.
    const typedMedia = mediaType as "image/jpeg" | "image/png" | "image/webp";
    blocks.push({ type: "image", mediaType: typedMedia, dataBase64 });
  }
  return blocks;
};

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
    readonly storagePaths?: readonly string[];
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

  // Download photos AFTER the auth tx closes (NoTx discipline — external I/O).
  // A missing or broken photo is a hard failure: we must not produce advice
  // that silently ignored an attachment the tech intended to send.
  let userBlocks: readonly UserContentBlock[] | undefined;
  if (params.storagePaths && params.storagePaths.length > 0) {
    if (!deps.photoStorageGateway) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "photo storage is not configured — photo upload is disabled",
      });
    }
    userBlocks = await downloadPhotoBlocks(params.storagePaths, orgId, jobId, deps.photoStorageGateway);
  }

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
      userBlocks,
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
      photoCount: userBlocks?.length ?? 0,
    },
    "copilot.turn.completed",
  );

  // Sanitise the transcript before returning: replace user_blocks entries
  // (which carry base64 image data) with plain text markers. Image bytes
  // are server-side only and must never round-trip to the client.
  const sanitisedTranscript = sanitiseTranscript(result.transcript, params.message);

  // needs_approval cannot happen (all tools are mutating:false), but handle defensively.
  if (result.status === "needs_approval") {
    return { status: "completed", text: result.assistantText, transcript: sanitisedTranscript };
  }

  return { status: result.status, text: result.text, transcript: sanitisedTranscript };
};
