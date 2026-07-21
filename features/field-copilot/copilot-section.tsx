/**
 * features/field-copilot/copilot-section.tsx
 * The Copilot section rendered inside TechJobModalContent.
 *
 * Layout (.fsec chrome):
 *   - Transcript area: user questions (right-aligned), assistant answers (left),
 *     AiThinkingBlock while pending.
 *   - FOUND WORK card: one-tap "Add to found work" → Added ✓ state.
 *   - Input row: [📷 camera] [text input] [Ask]
 *   - Photo chips (≤ 3) above the input row.
 *   - Inline errors via the error state (no grey helper text).
 *
 * The component is memoized with a custom comparator (copilotPropsEqual) that
 * reads only job.id/title/svc/scope/notes/addons — checklist taps (job.verify)
 * must NOT re-render it.
 */

"use client";

import { memo, useRef, useState, useCallback } from "react";
import type { Job } from "@/lib/store/types";
import { usePushToTalk } from "./use-push-to-talk";
import { useFieldCopilot } from "./use-field-copilot";
import { downscaleImage } from "@/lib/images/downscale";
import { uploadFieldPhoto } from "@/lib/store/upload-field-photo";
import { AiThinkingBlock } from "@/features/counter/artifacts";

// ---------------------------------------------------------------------------
// Input style (mirrors the AO_INPUT from tech-job-modal)
// ---------------------------------------------------------------------------

const INPUT_STYLE: React.CSSProperties = {
  border: "1.5px solid var(--line)",
  borderRadius: 8,
  padding: "7px 9px",
  fontFamily: "inherit",
  fontSize: "var(--type-base)",
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CopilotSectionProps {
  job: Job;
  addAddonField: (jobId: string, draft: { d: string; r: number }) => unknown;
}

// Custom memo comparator: ONLY compare fields that affect the section's output.
// job.verify changes (checklist taps) must NOT cause a re-render.
export function copilotPropsEqual(
  a: CopilotSectionProps,
  b: CopilotSectionProps,
): boolean {
  return (
    a.addAddonField === b.addAddonField &&
    a.job.id === b.job.id &&
    a.job.title === b.job.title &&
    a.job.svc === b.job.svc &&
    a.job.notes === b.job.notes &&
    a.job.addons === b.job.addons
  );
}

// ---------------------------------------------------------------------------
// FOUND WORK card
// ---------------------------------------------------------------------------

interface FoundWorkCardProps {
  description: string;
  jobId: string;
  addAddonField: (jobId: string, draft: { d: string; r: number }) => unknown;
}

function FoundWorkCard({ description, jobId, addAddonField }: FoundWorkCardProps) {
  const [added, setAdded] = useState(false);

  const handleAdd = useCallback(() => {
    if (added) return;
    addAddonField(jobId, { d: description, r: 0 });
    setAdded(true);
  }, [added, addAddonField, jobId, description]);

  return (
    <div className="cp-found-card">
      <span className="cp-found-label">Found work</span>
      <span className="cp-found-desc">{description}</span>
      <button
        className={added ? "tjpaid-btn2 cp-found-added" : "tjpaid-btn2"}
        onClick={handleAdd}
        disabled={added}
        aria-label={added ? "Added to found work" : "Add to found work"}
      >
        {added ? "Added ✓" : "Add to found work"}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main section
// ---------------------------------------------------------------------------

function CopilotSectionFn({ job, addAddonField }: CopilotSectionProps) {
  const { messages, pending, error, attachedPhotos, ask, attachPhoto, detachPhoto, clearError } =
    useFieldCopilot(job.id);

  const [inputText, setInputText] = useState("");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Push-to-talk fills the text box; the tech reviews/edits, then taps Ask.
  const ptt = usePushToTalk(setInputText);

  // ---- camera handler ----
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!fileInputRef.current) return;
      // Reset input so the same file can be re-selected if needed.
      fileInputRef.current.value = "";
      if (!file) return;

      if (attachedPhotos.length >= 3) {
        setCameraError("Maximum 3 photos per ask.");
        return;
      }

      setCameraError(null);
      setUploading(true);
      try {
        const blob = await downscaleImage(file);
        const id = await uploadFieldPhoto(job.id, blob);
        attachPhoto(id);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Photo upload failed — try again.";
        setCameraError(msg);
      } finally {
        setUploading(false);
      }
    },
    [attachedPhotos.length, job.id, attachPhoto],
  );

  // ---- ask handler ----
  const handleAsk = useCallback(async () => {
    const text = inputText.trim();
    if (!text || pending || uploading) return;
    if (ptt.listening) ptt.stop(); // don't keep dictating into the cleared box
    setInputText("");
    clearError();
    await ask(text);
    // Scroll to bottom after response.
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [inputText, pending, uploading, ask, clearError, ptt]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleAsk();
      }
    },
    [handleAsk],
  );

  const displayError = error ?? cameraError ?? ptt.error;

  return (
    <div className="fsec">
      <div className="fsec-h">
        <span>Copilot</span>
      </div>

      {/* Transcript */}
      {messages.length > 0 && (
        <div className="cp-transcript">
          {messages.map((msg, i) => {
            if (msg.role === "user") {
              return (
                <div key={i} className="cp-msg cp-msg-user">
                  {msg.text}
                </div>
              );
            }
            // assistant
            return (
              <div key={i} className="cp-msg-assistant-wrap">
                {msg.text && (
                  <div className="cp-msg cp-msg-assistant" style={{ whiteSpace: "pre-wrap" }}>
                    {msg.text}
                  </div>
                )}
                {msg.foundWork && (
                  <FoundWorkCard
                    description={msg.foundWork}
                    jobId={job.id}
                    addAddonField={addAddonField}
                  />
                )}
              </div>
            );
          })}
          {pending && (
            <div className="cp-msg-assistant-wrap">
              <AiThinkingBlock />
            </div>
          )}
          <div ref={transcriptEndRef} />
        </div>
      )}

      {/* Inline error */}
      {displayError && (
        <div className="cp-error" role="alert">
          {displayError}
        </div>
      )}

      {/* Photo chips */}
      {attachedPhotos.length > 0 && (
        <div className="cp-chips">
          {attachedPhotos.map((photo) => (
            <span key={photo.id} className="cp-chip">
              {photo.label}
              <button
                className="cp-chip-remove"
                onClick={() => detachPhoto(photo.id)}
                aria-label={`Remove ${photo.label}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="cp-input-row">
        {/* Camera button */}
        <button
          className="tjpaid-btn2 cp-cam-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || attachedPhotos.length >= 3}
          aria-label="Attach photo"
          title={attachedPhotos.length >= 3 ? "Maximum 3 photos" : "Attach photo"}
        >
          {uploading ? (
            <span className="sk" style={{ display: "inline-block", width: 18, height: 18, borderRadius: "var(--radius-2xs)" }} />
          ) : (
            "📷"
          )}
        </button>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={handleFileChange}
          aria-hidden="true"
        />

        {/* Push-to-talk mic — only when the browser supports it (typing is always primary). */}
        {ptt.supported && (
          <button
            type="button"
            className={ptt.listening ? "tjpaid-btn2 cp-mic-btn cp-mic-on" : "tjpaid-btn2 cp-mic-btn"}
            onClick={() => (ptt.listening ? ptt.stop() : ptt.start())}
            disabled={pending}
            aria-label={ptt.listening ? "Stop voice input" : "Speak your question"}
            aria-pressed={ptt.listening}
            title={ptt.listening ? "Listening — tap to stop" : "Speak"}
          >
            {ptt.listening ? "◉" : "🎤"}
          </button>
        )}

        {/* Text input */}
        <input
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={clearError}
          placeholder={ptt.listening ? "Listening…" : "Ask the copilot…"}
          disabled={pending}
          style={{ flex: 1, minWidth: 0, ...INPUT_STYLE }}
          aria-label="Ask the copilot"
        />

        {/* Ask button */}
        <button
          className="btn cp-ask-btn"
          onClick={() => void handleAsk()}
          disabled={!inputText.trim() || pending || uploading}
          aria-busy={pending}
        >
          {pending ? "…" : "Ask"}
        </button>
      </div>
    </div>
  );
}

export const CopilotSection = memo(CopilotSectionFn, copilotPropsEqual);
