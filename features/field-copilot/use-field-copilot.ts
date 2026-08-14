/**
 * features/field-copilot/use-field-copilot.ts
 * Local state manager for the tech's Ask screen.
 *
 * Responsibilities:
 *   - Maintain the conversation transcript (for multi-turn follow-ups).
 *   - Drive v1.fieldCopilot.run (trpcVanilla — stays out of the React query layer).
 *   - Hold the attached photos (≤ 3) and own their preview object-URL lifecycle.
 *
 * TWO KINDS OF ATTACHMENT, because a photo means two different things:
 *   - `job`    — uploaded to the job's execution record first, sent as an id. It is EVIDENCE:
 *                it outlives the question and the office can see it on the job.
 *   - `inline` — sent as bytes with the question and never stored. It is part of the QUESTION:
 *                a part number at the supply house, a nameplate in a crawlspace. There is no job
 *                to file it against, and inventing one would put junk on a job record.
 * The Ask screen picks by whether a job is open; nothing else in the app changes.
 *
 * NO FOUND-WORK PARSER. Replies used to carry a `FOUND WORK:` marker that this hook stripped into
 * a one-tap "add to change order" card. Change orders are now the way a tech proposes extra work,
 * so the marker was a second, weaker pipeline for the same thing — the prompt no longer emits it.
 */

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { trpcVanilla } from "@/lib/trpc/vanilla";

// ---------------------------------------------------------------------------
// Belt+braces alongside the prompt's plain-text rule: strip markdown bold/italic markers
// that would render as raw asterisks on the phone screen. Pure; exported for tests.
export function stripMdEmphasis(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/(^|\s)\*([^*\n]+)\*(?=\s|[.,;:!?]|$)/g, "$1$2");
}

/**
 * The device's own calendar date as `YYYY-MM-DD`.
 *
 * NOT `toISOString().slice(0,10)`, which is UTC and rolls over mid-evening in the Americas —
 * the exact hours a tech is most likely to be asking what is left of the day.
 */
function localDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The image types the copilot endpoint accepts inline. Mirrors the router's enum. */
export type InlineMediaType = "image/jpeg" | "image/png" | "image/webp";

export interface CopilotMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
}

interface AttachedBase {
  /** Chip identity for detach — not the server id, which inline photos do not have. */
  readonly key: string;
  /** Object URL for the thumbnail. Created AND revoked by this hook, never by the caller. */
  readonly previewUrl: string;
}

export type AttachedPhoto =
  | (AttachedBase & { readonly kind: "job"; readonly id: string })
  | (AttachedBase & { readonly kind: "inline"; readonly dataBase64: string; readonly mediaType: InlineMediaType });

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseFieldCopilotReturn {
  messages: CopilotMessage[];
  pending: boolean;
  /** User-facing error message, or null. */
  error: string | null;
  attachedPhotos: AttachedPhoto[];
  /** True at the 3-photo cap — the caller disables the camera rather than failing the tap. */
  photosFull: boolean;
  /** Call with the text the user typed. Resets the error. */
  ask: (message: string) => Promise<void>;
  /** Attach a photo already persisted to the job's execution record. */
  attachJobPhoto: (id: string, blob: Blob) => void;
  /** Attach photo bytes that ride with this question only and are never stored. */
  attachInlinePhoto: (dataBase64: string, mediaType: InlineMediaType, blob: Blob) => void;
  /** Remove a photo chip by key. */
  detachPhoto: (key: string) => void;
  /** Clear error manually (e.g. on input focus). */
  clearError: () => void;
}

const MAX_PHOTOS = 3;

/**
 * @param jobId  The job this conversation is about, or `undefined` for the Ask tab's general
 *               chat. The server branches on it: with a job it loads the scope, checklist and
 *               callback history; without one it answers from trade knowledge and the shop's own
 *               service context.
 */
export function useFieldCopilot(jobId?: string): UseFieldCopilotReturn {
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachedPhotos, setAttachedPhotos] = useState<AttachedPhoto[]>([]);
  // Server-serializable transcript for multi-turn context.
  const [transcript, setTranscript] = useState<unknown[]>([]);

  // Every object URL this hook has minted and not yet revoked. A ref, not state: unmount must be
  // able to free them without the effect re-running on every attach.
  const liveUrls = useRef<Set<string>>(new Set());
  const revoke = useCallback((url: string) => {
    if (liveUrls.current.delete(url)) URL.revokeObjectURL(url);
  }, []);
  useEffect(() => {
    const urls = liveUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const ask = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed || pending) return;

      setError(null);
      setPending(true);

      setMessages((prev) => [...prev, { role: "user", text: trimmed }]);

      const photoIds = attachedPhotos.filter((p) => p.kind === "job").map((p) => p.id);
      const inline = attachedPhotos
        .filter((p) => p.kind === "inline")
        .map((p) => ({ dataBase64: p.dataBase64, mediaType: p.mediaType }));

      try {
        const result = await trpcVanilla.v1.fieldCopilot.run.mutate({
          // Omitted entirely rather than sent as undefined — the input schema makes it optional
          // and a general chat has no job to name.
          ...(jobId ? { jobId } : {}),
          message: trimmed,
          transcript: transcript as Parameters<typeof trpcVanilla.v1.fieldCopilot.run.mutate>[0]["transcript"],
          photoIds: photoIds.length > 0 ? photoIds : undefined,
          photos: inline.length > 0 ? inline : undefined,
          // The DEVICE's calendar date, not the server's. "What have I got today" is a question
          // about where the van is; a tech in PDT at 6pm is already on tomorrow's date in UTC.
          today: localDate(),
        });

        setMessages((prev) => [...prev, { role: "assistant", text: stripMdEmphasis(result.text) }]);
        setTranscript(result.transcript);
        // Photos rode with this turn — clear them, freeing their previews.
        setAttachedPhotos((prev) => {
          for (const p of prev) revoke(p.previewUrl);
          return [];
        });
      } catch (err: unknown) {
        // Surface actionable message to the user; do not swallow.
        const message =
          err instanceof Error
            ? err.message
            : "Something went wrong — please try again.";
        setError(message);
        // Roll back the optimistic user message so the input stays editable. The photos stay
        // attached: the question did not go through, so re-taking them would be busywork.
        setMessages((prev) => prev.slice(0, -1));
      } finally {
        setPending(false);
      }
    },
    [jobId, pending, attachedPhotos, transcript, revoke],
  );

  /** Mints the preview URL and appends, honouring the cap. Returns the unchanged list when full. */
  const append = useCallback(
    (blob: Blob, make: (base: AttachedBase) => AttachedPhoto) => {
      const previewUrl = URL.createObjectURL(blob);
      let accepted = false;
      setAttachedPhotos((prev) => {
        if (prev.length >= MAX_PHOTOS) return prev;
        accepted = true;
        return [...prev, make({ key: crypto.randomUUID(), previewUrl })];
      });
      // At the cap the URL was never handed to a chip, so nothing would ever revoke it.
      if (!accepted) URL.revokeObjectURL(previewUrl);
      else liveUrls.current.add(previewUrl);
    },
    [],
  );

  const attachJobPhoto = useCallback(
    (id: string, blob: Blob) => append(blob, (base) => ({ ...base, kind: "job", id })),
    [append],
  );

  const attachInlinePhoto = useCallback(
    (dataBase64: string, mediaType: InlineMediaType, blob: Blob) =>
      append(blob, (base) => ({ ...base, kind: "inline", dataBase64, mediaType })),
    [append],
  );

  const detachPhoto = useCallback(
    (key: string) => {
      setAttachedPhotos((prev) => {
        const gone = prev.find((p) => p.key === key);
        if (gone) revoke(gone.previewUrl);
        return prev.filter((p) => p.key !== key);
      });
    },
    [revoke],
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    messages,
    pending,
    error,
    attachedPhotos,
    photosFull: attachedPhotos.length >= MAX_PHOTOS,
    ask,
    attachJobPhoto,
    attachInlinePhoto,
    detachPhoto,
    clearError,
  };
}
