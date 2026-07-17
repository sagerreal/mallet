// Pure helper functions for the field copilot router.
// Extracted into a separate file so unit tests can import these without pulling
// in @/trpc/init (which triggers the config validator at module load time).

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

/** Replace every user_blocks entry with a plain text marker so base64 image
 *  bytes never appear in the transcript returned to the client.
 *  v1 note: follow-up turns do not re-see the photo pixels — the model already
 *  consumed them this turn; subsequent turns reference the conversation text. */
export const sanitiseTranscript = (transcript: readonly AgentMessage[], message: string): AgentMessage[] => {
  return transcript.map((msg) => {
    if (msg.role === "user" && msg.kind === "user_blocks") {
      return { role: "user", kind: "text", text: `[photo attached] ${message}` } satisfies AgentMessage;
    }
    return msg;
  });
};
