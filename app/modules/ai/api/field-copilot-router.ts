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
import { buildFieldTools, buildOrgOnlyFieldTools } from "../infra/tools/field-read-tools";
import { buildFieldPrompt } from "../app/field-copilot-prompt";
import { DrizzleJobRepository } from "../../jobs/infra/drizzle-job-repository";
import { DrizzleSettingsRepository } from "../../settings/infra/drizzle-settings-repository";
import { asJobId, type OrgId, type JobId } from "@mallet/shared/types";
import type { PhotoMediaType } from "../../jobs/domain/photo-storage-gateway";
import { logger } from "@mallet/shared/observability";
import { resolvePhotoPaths, sanitiseTranscript, transcriptSchema } from "./field-copilot-helpers";

// ---------------------------------------------------------------------------
// Output shape
// ---------------------------------------------------------------------------

const copilotRunOutput = z.object({
  status: z.enum(["completed", "refused"]),
  text: z.string(),
  transcript: z.array(z.unknown()),
});

// ---------------------------------------------------------------------------
// Inline photos — bytes that ride with ONE question and are never stored
// ---------------------------------------------------------------------------

// The same decoded ceiling the storage gateway enforces (MAX_PHOTO_BYTES), applied here to the
// encoded string because nothing downloads these — they arrive already in the payload. base64 is
// 4 characters per 3 bytes, so the encoded cap is the decoded cap × 4/3, plus padding.
const MAX_INLINE_BYTES = 5 * 1024 * 1024;
const MAX_INLINE_BASE64_CHARS = Math.ceil(MAX_INLINE_BYTES / 3) * 4;

// Reject anything that is not strictly base64 before it reaches the model client. Untrusted
// client input at a boundary: validate the shape, do not assume the browser sent what we asked for.
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

const inlinePhotoSchema = z.object({
  dataBase64: z
    .string()
    .min(1)
    .max(MAX_INLINE_BASE64_CHARS, "photo is too large — retake it")
    .refine((s) => s.length % 4 === 0 && BASE64.test(s), "photo data is not valid base64"),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const createFieldCopilotRouter = () =>
  router({
    run: anyRoleNoTx
      .input(
        z.object({
          /**
           * OPTIONAL — the Ask tab is a general chat with no job open.
           *
           * Present: the older in-job conversation, unchanged — the job is verified, its tools are
           * closed over it, and photos resolve against its execution rows.
           * Absent: trade knowledge plus the org-scoped tool only. See buildOrgOnlyFieldTools.
           */
          jobId: z.string().uuid().optional(),
          message: z.string().min(1).max(2000),
          transcript: transcriptSchema.optional(),
          /** Photos already on the job's execution record. Requires a job — see below. */
          photoIds: z.array(z.string().uuid()).max(3).optional(),
          /**
           * Photo bytes attached to THIS question and never stored. Works with or without a job:
           * they are part of the question, not a record, so they need nothing to belong to.
           */
          photos: z.array(inlinePhotoSchema).max(3).optional(),
          /**
           * The CALLER'S own calendar date, `YYYY-MM-DD` — what get_my_day reads as "today".
           *
           * The client owns it because "today" is a statement about where the van is and there is
           * no org timezone column for the server to reproduce it (the same reasoning as
           * v1.field.myDay's client-supplied instants). A tech in PDT at 6pm is already on
           * tomorrow's date in UTC, so a server-derived day would be wrong every evening.
           */
          today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected a YYYY-MM-DD date").optional(),
        }),
      )
      .output(copilotRunOutput)
      .mutation(async ({ ctx, input }) => {
        const { principal, deps } = ctx;
        if (!deps.llmClient) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "the AI assistant is not switched on for this server",
          });
        }

        // photoIds name rows on a JOB's execution record — without a job there is nothing to
        // resolve them against. Inline `photos` are the jobless path and carry their own bytes.
        // Refuse rather than drop: advice about a photo the model never saw is worse than an error.
        if (!input.jobId && input.photoIds && input.photoIds.length > 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "open the job to ask about a photo already on it",
          });
        }

        // Both kinds count against one cap — the ceiling is what the model is asked to look at in
        // a single turn, not how each image happened to arrive.
        if ((input.photoIds?.length ?? 0) + (input.photos?.length ?? 0) > 3) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "3 photos per question" });
        }

        const jobId = input.jobId ? asJobId(input.jobId) : null;

        // Short auth-check tx: assertOnJobIfTech + job existence + getTechSeesPrice
        // + resolve photo storagePaths. Closed before the slow model round-trips
        // and any external download calls (NoTx discipline).
        const { seesPrice, storagePaths } = await withTenant(principal.orgId, async (tx) => {
          const repo = new DrizzleJobRepository(tx, principal.orgId);

          if (jobId && principal.role === "tech") {
            // assertOnJobIfTech: throws NOT_FOUND or FORBIDDEN for tech callers.
            const job = await repo.findById(jobId);
            if (!job) {
              throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
            }
            if (!job.isAssignedTo(principal.userId)) {
              throw new TRPCError({ code: "FORBIDDEN", message: "this job isn't assigned to you" });
            }
          } else if (jobId) {
            // Owner/office: verify the job exists and is not deleted.
            const job = await repo.findById(jobId);
            if (!job) {
              throw new TRPCError({ code: "NOT_FOUND", message: "job not found" });
            }
          }
          // No jobId: nothing to authorise against. The org tx itself is the tenant boundary, and
          // the only tool this conversation gets reads org-scoped rows through it.

          const settingsRepo = new DrizzleSettingsRepository(tx, principal.orgId);
          const techSeesPrice = await settingsRepo.getTechSeesPrice();
          // Owner/office always see prices; only techs are subject to the org setting.
          const resolved = principal.role === "tech" ? techSeesPrice : true;

          // Resolve photoIds → storagePaths, verifying they belong to this exact job.
          let resolvedPaths: readonly string[] = [];
          if (jobId && input.photoIds && input.photoIds.length > 0) {
            const execution = await repo.listExecution(jobId);
            resolvedPaths = resolvePhotoPaths(input.photoIds, execution.photos.map((p) => p.props), jobId);
          }

          return { seesPrice: resolved, storagePaths: resolvedPaths };
        });

        return runFieldTurn(principal, deps, {
          jobId: input.jobId ?? null,
          message: input.message,
          priorMessages: input.transcript,
          seesPrice,
          storagePaths,
          inlinePhotos: input.photos,
          // Fall back to the server's date when the client did not say. Off by a day for part of
          // the evening in western timezones, which still beats having no agenda tool at all.
          today: input.today ?? deps.clock.now().toISOString().slice(0, 10),
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
      // Detail stays server-side; the client gets one actionable message.
      logger.warn({ storagePath, err: result.error.message }, "copilot.photo.download_failed");
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "a photo could not be loaded — re-take it and try again",
      });
    }
    const { dataBase64, mediaType } = result.value;
    // Narrow mediaType to the allowed union. The gateway guarantees this set,
    // but we guard here so the type system is satisfied without `any`.
    const typedMedia = mediaType; // PhotoMediaType — narrowed at the gateway port
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
    /** Null when no job is open — the Ask tab's general chat. See the `run` input. */
    readonly jobId: string | null;
    readonly message: string;
    readonly priorMessages?: AgentMessage[];
    readonly seesPrice: boolean;
    readonly storagePaths?: readonly string[];
    /** Bytes attached to this question only — no storage round trip, no job required. */
    readonly inlinePhotos?: readonly { readonly dataBase64: string; readonly mediaType: PhotoMediaType }[];
    /** The caller's own `YYYY-MM-DD` — what get_my_day treats as today. */
    readonly today: string;
  },
): Promise<{ status: "completed" | "refused"; text: string; transcript: unknown[] }> => {
  if (!deps.llmClient) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "the AI assistant is not switched on for this server",
    });
  }

  const jobId = params.jobId ? asJobId(params.jobId) : null;
  const orgId = principal.orgId;

  // Download photos AFTER the auth tx closes (NoTx discipline — external I/O).
  // A missing or broken photo is a hard failure: we must not produce advice
  // that silently ignored an attachment the tech intended to send.
  const blocks: UserContentBlock[] = [];
  if (params.storagePaths && params.storagePaths.length > 0) {
    if (!deps.photoStorageGateway) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "photo storage is not configured — photo upload is disabled",
      });
    }
    // Unreachable without a job: the router refuses photoIds when jobId is absent, and
    // storagePaths only ever come from that job's own execution rows.
    if (!jobId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "open the job to ask about a photo already on it" });
    }
    blocks.push(...(await downloadPhotoBlocks(params.storagePaths, orgId, jobId, deps.photoStorageGateway)));
  }
  // Inline photos need no gateway and no job: the bytes are already here, validated at the input
  // boundary. This is the Ask tab's camera — the photo is part of the question, not a job record.
  for (const photo of params.inlinePhotos ?? []) {
    blocks.push({ type: "image", mediaType: photo.mediaType, dataBase64: photo.dataBase64 });
  }
  const userBlocks: readonly UserContentBlock[] | undefined = blocks.length > 0 ? blocks : undefined;

  // Build tools closed over the VERIFIED jobId and seesPrice.
  // Each tool execute() call opens its own short withTenant tx — mirrors the
  // NoTx composition in ai-router.ts:394-415.
  //
  // With no job open the two job-scoped tools are withheld rather than handed a placeholder —
  // offering the model a tool that cannot work is worse than not offering it, and the prompt is
  // branched to match so it never reaches for one that is absent.
  const agenda = { userId: principal.userId, today: params.today };
  const fieldTools = jobId
    ? buildFieldTools({ withTx: withTenant })({ orgId, jobId, seesPrice: params.seesPrice, ...agenda })
    : buildOrgOnlyFieldTools({ withTx: withTenant })({ orgId, seesPrice: params.seesPrice, ...agenda });
  const metas: ToolMeta[] = fieldTools.map((t) => t.meta);

  // toolUseId unused: field tools are all read-only here (no execution ledger needed to
  // guard against a replayed write).
  const execute: ExecuteTool = (name, input, _toolUseId) => {
    const tool = fieldTools.find((t) => t.meta.name === name);
    if (!tool) return Promise.resolve({ ok: false as const, error: `unknown tool: ${name}` });
    return tool.execute(input);
  };

  let result: AgentResult;
  try {
    result = await runAgentTurn({
      llm: deps.llmClient,
      system: buildFieldPrompt({ seesPrice: params.seesPrice, hasJob: jobId !== null, today: params.today }),
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
