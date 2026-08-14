"use client";

/**
 * app/(field)/ask/page.tsx
 * The technician's Ask screen — a general chat, on its own tab.
 *
 * WHY A TAB AND NOT A BAR. This conversation used to exist only inside the tech job sheet, which
 * made the one feature the field app is FOR reachable from a single screen, and only once a job was
 * open. A chat has follow-ups, photos and long answers; a strip above the tab bar gives it a cramped
 * panel fighting live content underneath — the same shape it already had in the sheet. A tab gives
 * it the whole screen, which is what every other chat app on that phone does.
 *
 * WHAT IT KNOWS. Nothing job-specific, and it says so rather than pretending. `v1.fieldCopilot.run`
 * takes an OPTIONAL jobId: sent, the model gets the job's scope, checklist and callback history;
 * omitted, it answers from trade knowledge plus the shop's own service context, and is instructed
 * to tell the tech to open the job when the answer genuinely depends on one.
 *
 * THE CAMERA, AND WHY IT WORKS TWO WAYS. A photo means two different things here:
 *   - With a job open it is EVIDENCE. It uploads to that job's execution record first, so it
 *     outlives the question and the office can see it on the job.
 *   - Without one it is part of the QUESTION — a part number at the supply house, a nameplate in a
 *     crawlspace. It rides inline with the ask and is never stored, because there is nothing to
 *     file it against and inventing a home would put junk on a job record.
 * Same button, same chips; the difference is invisible to the tech and never a dead control.
 *
 * LAYOUT. Scope banner, thread, composer: three rows of a flex column that owns the viewport
 * between the topbar and the tab bar. The thread scrolls; the composer sits on the bottom edge.
 */

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAppStore } from "@/lib/store/app-store";
import { useFieldCopilot } from "@/features/field-copilot/use-field-copilot";
import { usePushToTalk } from "@/features/field-copilot/use-push-to-talk";
import { downscaleImage } from "@/lib/images/downscale";
import { blobToBase64 } from "@/lib/images/blob-to-base64";
import { uploadFieldPhoto } from "@/lib/store/upload-field-photo";
import { AiThinkingBlock } from "@/features/counter/artifacts";

/** The opener. Not chat filler — it names what this can answer, which is the thing a tech cannot guess. */
const EMPTY_LINES = [
  "Codes and clearances. Diagnostics. What this shop charges for.",
  "Photograph a part or a nameplate and ask what it is.",
];

export default function AskPage() {
  /**
   * ONE SCREEN, TWO SCOPES. Tapping the tab opens the general chat. The job sheet links here with
   * `?jobId=`, which is what lets the in-sheet section be deleted rather than duplicated.
   */
  const jobId = useSearchParams().get("jobId") ?? undefined;
  const job = useAppStore((s) => s.jobs.find((j) => j.id === jobId));

  const {
    messages,
    pending,
    error,
    attachedPhotos,
    photosFull,
    ask,
    attachJobPhoto,
    attachInlinePhoto,
    detachPhoto,
    clearError,
  } = useFieldCopilot(jobId);

  const [draft, setDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  /**
   * VOICE. A tech asks with his hands full, in a crawlspace, or wearing gloves — dictation is the
   * primary input on this screen far more often than anywhere else in the app. Speech recognition
   * is a browser capability, so the transcript lands in the draft and stays editable before it sends.
   */
  const ptt = usePushToTalk(setDraft);

  // Pin to the newest turn, the way every message surface does — a tech should never have to
  // scroll down to find the answer he just asked for.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  function send() {
    const text = draft.trim();
    if (!text || pending) return;
    if (ptt.listening) ptt.stop(); // never keep dictating into a box that just cleared
    setDraft("");
    void ask(text);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset immediately so re-taking the SAME photo still fires a change event.
    e.target.value = "";
    if (!file) return;

    setPhotoError(null);
    setUploading(true);
    try {
      // Normalises HEIC and caps the longest edge — the camera's raw output is far larger than
      // anything the model needs, and on a job it is also bytes going into storage.
      const blob = await downscaleImage(file);
      if (jobId) {
        const id = await uploadFieldPhoto(jobId, blob);
        attachJobPhoto(id, blob);
      } else {
        attachInlinePhoto(await blobToBase64(blob), "image/jpeg", blob);
      }
    } catch {
      // The detail is a storage or codec error the tech cannot act on; the action they CAN take
      // is retake it. Never leave a silent failure — an ask would go out without the photo.
      setPhotoError("That photo didn't attach — take it again.");
    } finally {
      setUploading(false);
    }
  }

  const canSend = Boolean(draft.trim()) && !pending;
  const cameraBusy = pending || uploading || photosFull;

  return (
    <div className="askpage">
      {/* Names the scope, so a tech is never guessing what this answer can see. Absent on the
          general chat: a header that says "no job" on the tab's own screen is noise. */}
      {job ? (
        <div className="askpage-scope">
          Asking about <b>{job.title}</b>
        </div>
      ) : null}

      <div className="askpage-thread" ref={threadRef} role="log" aria-live="polite" aria-label="Conversation">
        {messages.length === 0 && !pending ? (
          <div className="askpage-empty">
            <h1>Ask Mallet</h1>
            {(job ? [`Scope, checklist and history for ${job.title}.`, "Anything else about the trade."] : EMPTY_LINES).map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
        ) : null}

        {messages.map((m, i) => (
          <div key={i} className={`askpage-msg ${m.role === "user" ? "me" : "ai"}`}>
            {m.text}
          </div>
        ))}

        {pending ? <AiThinkingBlock /> : null}

        {/* Errors sit in the thread, where the answer would have been — not as a toast that
            outlives the question it belongs to. */}
        {error ? (
          <div className="askpage-err" role="alert">
            {error}
          </div>
        ) : null}
      </div>

      <div className="askpage-composer">
        {/* Attached photos, above the controls so they never squeeze the input. Thumbnails rather
            than "📷 1" chips: the tech is checking they shot the right thing. */}
        {attachedPhotos.length > 0 || photoError ? (
          <div className="askpage-shots">
            {attachedPhotos.map((p, i) => (
              <span key={p.key} className="askpage-shot">
                {/* A local object URL, not a remote asset — next/image would only add a loader
                    round trip for bytes the browser already holds. */}
                <img src={p.previewUrl} alt={`Attachment ${i + 1}`} />
                <button type="button" onClick={() => detachPhoto(p.key)} aria-label={`Remove attachment ${i + 1}`}>
                  ✕
                </button>
              </span>
            ))}
            {photoError ? (
              <span className="askpage-shoterr" role="alert">
                {photoError}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="askpage-controls">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="askpage-file"
            onChange={handleFile}
            tabIndex={-1}
            aria-hidden="true"
          />
          <button
            type="button"
            className="askpage-cam"
            aria-label={photosFull ? "3 photos attached — remove one to add another" : "Take a photo"}
            aria-disabled={cameraBusy ? true : undefined}
            onClick={(e) => {
              if (cameraBusy) {
                e.preventDefault();
                return;
              }
              fileRef.current?.click();
            }}
          >
            {uploading ? (
              <span className="askpage-camwait" aria-hidden="true" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            )}
          </button>

          {/* Only when the browser has speech recognition — typing stays the primary path, so a
              missing mic costs nothing rather than leaving a control that does nothing. */}
          {ptt.supported ? (
            <button
              type="button"
              className={ptt.listening ? "askpage-mic on" : "askpage-mic"}
              aria-label={ptt.listening ? "Stop voice input" : "Speak your question"}
              aria-pressed={ptt.listening}
              aria-disabled={pending ? true : undefined}
              onClick={(e) => {
                if (pending) {
                  e.preventDefault();
                  return;
                }
                if (ptt.listening) ptt.stop();
                else ptt.start();
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="2" width="6" height="11" rx="3" />
                <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
                <line x1="12" y1="18" x2="12" y2="22" />
              </svg>
            </button>
          ) : null}

          <input
            className="askpage-input"
            value={draft}
            placeholder={ptt.listening ? "Listening…" : "Ask anything…"}
            aria-label="Ask Mallet"
            enterKeyHint="send"
            onChange={(e) => setDraft(e.target.value)}
            onFocus={clearError}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                send();
              }
            }}
          />

          {/* aria-disabled, not disabled: the control keeps its place and its focus, and a screen
              reader is told it is unavailable rather than meeting nothing. */}
          <button
            type="button"
            className="askpage-send"
            aria-label="Send"
            aria-disabled={canSend ? undefined : true}
            onClick={(e) => {
              if (!canSend) {
                e.preventDefault();
                return;
              }
              send();
            }}
          >
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}
