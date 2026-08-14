/**
 * features/field-copilot/use-field-copilot.ts
 * Local state manager for the Copilot section in the tech job modal.
 *
 * Responsibilities:
 *   - Maintain the conversation transcript (for multi-turn follow-ups).
 *   - Drive v1.fieldCopilot.run (trpcVanilla — stays out of the React query layer).
 *   - Maintain attached photo IDs (≤ 3 cap) from the camera flow.
 *   - Parse the FOUND WORK marker out of each reply per the documented contract.
 *
 * The FOUND WORK parser is a PURE exported function so it can be unit-tested
 * in isolation without mounting the hook.
 */

"use client";

import { useState, useCallback } from "react";
import { trpcVanilla } from "@/lib/trpc/vanilla";

// ---------------------------------------------------------------------------
// Belt+braces alongside the prompt's plain-text rule: strip markdown bold/italic markers
// that would render as raw asterisks on the phone screen. Pure; exported for tests.
export function stripMdEmphasis(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/(^|\s)\*([^*\n]+)\*(?=\s|[.,;:!?]|$)/g, "$1$2");
}

// FOUND WORK marker parser — pure, unit-tested
// ---------------------------------------------------------------------------

/** The marker prefix the copilot prompt instructs the model to emit. */
const FOUND_WORK_PREFIX = "FOUND WORK:";

/**
 * Parse the FOUND WORK marker from a copilot reply.
 *
 * Contract (mirrors field-copilot-prompt.ts top-of-file comment):
 *   - One marker per reply max.
 *   - The marker is a STANDALONE line at the END of the response.
 *   - The description is the text after "FOUND WORK: " (trimmed).
 *   - Descriptions > 80 characters are IGNORED (malformed / prompt leak).
 *   - If the marker is not the last non-empty line it is IGNORED (not at end).
 *
 * Returns:
 *   { displayText, foundWork } where:
 *     - displayText — the reply with the marker line stripped.
 *     - foundWork   — the parsed description, or null if no valid marker.
 */
export function parseFoundWork(text: string): {
  displayText: string;
  foundWork: string | null;
} {
  const lines = text.split("\n");

  // Find the last non-empty line.
  let lastNonEmptyIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if ((lines[i] ?? "").trim() !== "") {
      lastNonEmptyIdx = i;
      break;
    }
  }

  if (lastNonEmptyIdx === -1) {
    return { displayText: text, foundWork: null };
  }

  const lastLine = (lines[lastNonEmptyIdx] ?? "").trim();

  if (!lastLine.startsWith(FOUND_WORK_PREFIX)) {
    return { displayText: text, foundWork: null };
  }

  const description = lastLine.slice(FOUND_WORK_PREFIX.length).trim();

  // Ignore malformed markers: description > 80 chars.
  if (description.length > 80) {
    return { displayText: text, foundWork: null };
  }

  // Strip the marker line and any trailing empty lines after it.
  const displayLines = lines.slice(0, lastNonEmptyIdx);
  // Trim trailing blank lines from the display text.
  while (displayLines.length > 0 && (displayLines[displayLines.length - 1] ?? "").trim() === "") {
    displayLines.pop();
  }

  return {
    displayText: displayLines.join("\n"),
    foundWork: description || null,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CopilotMessage {
  readonly role: "user" | "assistant";
  /** The display text (marker stripped for assistant messages). */
  readonly text: string;
  /** Parsed found-work description when the assistant reply carried the marker. */
  readonly foundWork: string | null;
}

export interface AttachedPhoto {
  /** The server-side photo ID (from addPhoto response). */
  readonly id: string;
  /** Short display label shown in the chip ("📷 1", "📷 2", …). */
  readonly label: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseFieldCopilotReturn {
  messages: CopilotMessage[];
  pending: boolean;
  /** User-facing error message, or null. */
  error: string | null;
  attachedPhotos: AttachedPhoto[];
  /** Call with the text the user typed. Resets the error. */
  ask: (message: string) => Promise<void>;
  /** Add a photo ID chip (max 3). */
  attachPhoto: (id: string) => void;
  /** Remove a photo chip by ID. */
  detachPhoto: (id: string) => void;
  /** Clear error manually (e.g. on input focus). */
  clearError: () => void;
}

/**
 * @param jobId  The job this conversation is about, or `undefined` for the Ask tab's general
 *               chat. The server branches on it: with a job it loads the scope, checklist and
 *               callback history; without one it answers from trade knowledge and the shop's own
 *               service context. Photos require a job — the endpoint refuses them otherwise,
 *               because a photo is a row on a job's execution record.
 */
export function useFieldCopilot(jobId?: string): UseFieldCopilotReturn {
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attachedPhotos, setAttachedPhotos] = useState<AttachedPhoto[]>([]);
  // Server-serializable transcript for multi-turn context.
  const [transcript, setTranscript] = useState<unknown[]>([]);

  const ask = useCallback(
    async (message: string) => {
      const trimmed = message.trim();
      if (!trimmed || pending) return;

      setError(null);
      setPending(true);

      const userMsg: CopilotMessage = { role: "user", text: trimmed, foundWork: null };
      setMessages((prev) => [...prev, userMsg]);

      const photoIds = attachedPhotos.map((p) => p.id);

      try {
        const result = await trpcVanilla.v1.fieldCopilot.run.mutate({
          // Omitted entirely rather than sent as undefined — the input schema makes it optional
          // and a general chat has no job to name.
          ...(jobId ? { jobId } : {}),
          message: trimmed,
          transcript: transcript as Parameters<typeof trpcVanilla.v1.fieldCopilot.run.mutate>[0]["transcript"],
          photoIds: photoIds.length > 0 ? photoIds : undefined,
        });

        const { displayText, foundWork } = parseFoundWork(stripMdEmphasis(result.text));

        const assistantMsg: CopilotMessage = {
          role: "assistant",
          text: displayText,
          foundWork,
        };

        setMessages((prev) => [...prev, assistantMsg]);
        setTranscript(result.transcript);
        // Clear photos after a successful ask (they are included in the turn).
        setAttachedPhotos([]);
      } catch (err: unknown) {
        // Surface actionable message to the user; do not swallow.
        const message =
          err instanceof Error
            ? err.message
            : "Something went wrong — please try again.";
        setError(message);
        // Roll back the optimistic user message so the input stays editable.
        setMessages((prev) => prev.slice(0, -1));
      } finally {
        setPending(false);
      }
    },
    [jobId, pending, attachedPhotos, transcript],
  );

  const attachPhoto = useCallback((id: string) => {
    setAttachedPhotos((prev) => {
      if (prev.length >= 3 || prev.some((p) => p.id === id)) return prev;
      const label = `📷 ${prev.length + 1}`;
      return [...prev, { id, label }];
    });
  }, []);

  const detachPhoto = useCallback((id: string) => {
    setAttachedPhotos((prev) => {
      const next = prev.filter((p) => p.id !== id);
      // Re-number labels.
      return next.map((p, i) => ({ ...p, label: `📷 ${i + 1}` }));
    });
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { messages, pending, error, attachedPhotos, ask, attachPhoto, detachPhoto, clearError };
}
