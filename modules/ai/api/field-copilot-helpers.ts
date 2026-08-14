// Pure helper functions for the field copilot router.
// Extracted into a separate file so unit tests can import these without pulling
// in @/trpc/init (which triggers the config validator at module load time).

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { JobId } from "@mallet/shared/types";
import type { AgentMessage } from "../domain/llm-client";

// ---------------------------------------------------------------------------
// Photo path resolution (called inside the auth tx)
// ---------------------------------------------------------------------------

/** Resolves photoIds to storagePaths, verifying each photo belongs to the given jobId.
 *  Throws NOT_FOUND for any id that is absent or belongs to a different job. */
export const resolvePhotoPaths = (
  photoIds: readonly string[],
  photos: readonly { id: string; jobId: JobId; storagePath: string }[],
  jobId: JobId,
): readonly string[] => {
  return photoIds.map((photoId) => {
    const photo = photos.find((p) => p.id === photoId && p.jobId === jobId);
    if (!photo) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `photo ${photoId} not found on this job`,
      });
    }
    return photo.storagePath;
  });
};

// ---------------------------------------------------------------------------
// Transcript sanitisation — strip image bytes before round-tripping to client
// ---------------------------------------------------------------------------

/**
 * Reduce a finished turn to the plain-text conversation the client round-trips.
 *
 * TWO THINGS COME OUT, and both must.
 *
 * 1. IMAGE BYTES. A `user_blocks` entry carries base64 pixels; it becomes a text marker so photo
 *    bytes never travel back to the browser. Follow-up turns do not re-see the pixels — the model
 *    consumed them on the turn they were sent, and later turns reference the conversation text.
 *
 * 2. TOOL PLUMBING. A tool call appends an assistant `tool_use` block AND a `tool_results` entry.
 *    The input schema has no member for `tool_results`, deliberately: accepting one would let a
 *    client forge tool output and have the model treat it as trusted server data. So the fix is
 *    not to widen the schema — it is to stop sending plumbing the client has no use for.
 *
 *    THIS IS WHY A SECOND MESSAGE FAILED. The first ask called a tool, the transcript came back
 *    holding `tool_results`, and the follow-up round-tripped it into a validation error. The bug
 *    predates the Ask tab and would fire on any in-job conversation that called a tool; get_my_day
 *    made tool calls routine, so it surfaced.
 *
 *    Dropping only `tool_results` would leave a dangling `tool_use` with no answer, which the model
 *    API rejects outright — so assistant turns are reduced to their TEXT blocks, and a turn left
 *    with nothing (a pure tool call, or thinking alone) is dropped. If the next turn needs the data
 *    again the model simply calls the tool again, which is cheap and always current.
 */
export const sanitiseTranscript = (transcript: readonly AgentMessage[], message: string): AgentMessage[] => {
  const out: AgentMessage[] = [];
  for (const msg of transcript) {
    if (msg.role === "user") {
      // Tool output is server-authored and stays server-side.
      if (msg.kind === "tool_results") continue;
      if (msg.kind === "user_blocks") {
        out.push({ role: "user", kind: "text", text: `[photo attached] ${message}` });
        continue;
      }
      out.push(msg);
      continue;
    }
    const textBlocks = msg.blocks.filter((b) => b.type === "text");
    if (textBlocks.length > 0) out.push({ role: "assistant", kind: "assistant", blocks: textBlocks });
  }
  return out;
};

// ---------------------------------------------------------------------------
// Transcript schema — validates untrusted client-round-tripped conversation state
//
// Lives here, not in the router, for the reason at the top of this file: the router pulls
// @/trpc/init and its config validator, so a unit test cannot import it. The round-trip
// sanitiseTranscript performs is only meaningfully asserted against THIS schema.
//
// Tenancy is always re-derived server-side; this guards against structurally malformed payloads.
// ---------------------------------------------------------------------------

const assistantBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("thinking"), thinking: z.string(), signature: z.string() }),
  z.object({ type: z.literal("redacted_thinking"), data: z.string() }),
  z.object({ type: z.literal("tool_use"), id: z.string(), name: z.string(), input: z.unknown() }),
]);

// NOTE: no tool_results member. A client-supplied tool result would be forged server data the
// model then treats as trusted, so this schema refuses them — and sanitiseTranscript strips the
// whole tool round-trip on the way OUT so a legitimate follow-up never carries one back in.
//
// The earlier rationale here ("advise-only, so a turn never pauses mid-tool") conflated pausing
// for APPROVAL with a completed tool round-trip. A read-only tool still appends tool_results, so
// any second message after a tool call was rejected. Exported so the round-trip is asserted
// against THIS schema rather than a restatement of it.
export const transcriptSchema = z.array(
  z.union([
    z.object({ role: z.literal("user"), kind: z.literal("text"), text: z.string() }),
    z.object({
      role: z.literal("assistant"),
      kind: z.literal("assistant"),
      blocks: z.array(assistantBlockSchema),
    }),
  ]),
);
