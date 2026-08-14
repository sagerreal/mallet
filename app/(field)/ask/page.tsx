"use client";

/**
 * app/(field)/ask/page.tsx
 * The technician's Ask screen — a general chat, on its own tab.
 *
 * WHY A TAB AND NOT A BAR. This conversation used to exist only inside the tech job sheet
 * (`CopilotSection`), which made the one feature the field app is FOR reachable from a single
 * screen, and only once a job was open. A chat has follow-ups, photos and long answers; a strip
 * above the tab bar gives it a cramped panel fighting live content underneath — the same shape it
 * already had in the sheet. A tab gives it the whole screen, which is what every other chat app
 * on that phone does, so there is nothing to explain.
 *
 * WHAT IT KNOWS. Nothing job-specific, and it says so rather than pretending. `v1.fieldCopilot.run`
 * takes an OPTIONAL jobId: sent, the model gets the job's scope, checklist and callback history;
 * omitted, it answers from trade knowledge plus the shop's own service context, and is instructed
 * to tell the tech to open the job when the answer genuinely depends on one. Photos need a job —
 * a photo is a row on a job's execution record — so the composer's camera lives in the job sheet,
 * not here.
 *
 * LAYOUT. Header, thread, composer: three rows of a flex column that owns the viewport between the
 * topbar and the tab bar. The thread scrolls; the composer is pinned to the bottom of the column
 * rather than to the window, so the tab bar and the home indicator are never covered and no
 * `position: fixed` competes with the shell.
 */

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAppStore } from "@/lib/store/app-store";
import { useFieldCopilot } from "@/features/field-copilot/use-field-copilot";
import { AiThinkingBlock } from "@/features/counter/artifacts";

/** The opener. Not chat filler — it names what this can answer, which is the thing a tech cannot guess. */
const EMPTY_LINES = [
  "Codes and clearances. Diagnostics. What this shop charges for.",
  "Open a job first if the question is about that job's scope or price.",
];

export default function AskPage() {
  /**
   * ONE SCREEN, TWO SCOPES. Tapping the tab opens the general chat. The job sheet links here with
   * `?jobId=`, which is what lets the in-sheet section be deleted rather than duplicated: asking
   * about a job keeps the job's scope, checklist and callback history AND the Extra Work card —
   * on a full screen instead of a panel wedged into the sheet.
   */
  const jobId = useSearchParams().get("jobId") ?? undefined;
  const job = useAppStore((s) => s.jobs.find((j) => j.id === jobId));
  const addAddonField = useAppStore((s) => s.addAddonField);

  const { messages, pending, error, ask } = useFieldCopilot(jobId);
  const [draft, setDraft] = useState("");
  const [added, setAdded] = useState<Record<number, boolean>>({});
  const threadRef = useRef<HTMLDivElement>(null);

  // Pin to the newest turn, the way every message surface does — a tech should never have to
  // scroll down to find the answer he just asked for.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  function send() {
    const text = draft.trim();
    if (!text || pending) return;
    setDraft("");
    void ask(text);
  }

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
          <div key={i} className="askpage-turn">
            <div className={`askpage-msg ${m.role === "user" ? "me" : "ai"}`}>{m.text}</div>
            {/* EXTRA WORK — only ever present with a job, because the model is told to withhold
                the marker without one: a proposed add-on needs a job to attach to. */}
            {m.foundWork && jobId ? (
              <div className="askpage-found">
                <b>Extra work</b>
                {m.foundWork}
                <button
                  type="button"
                  className="askpage-add"
                  aria-disabled={added[i] ? true : undefined}
                  onClick={() => {
                    if (added[i]) return;
                    // Rate 0 — a PROPOSED add-on. The office prices it when the change order is raised.
                    addAddonField(jobId, { d: m.foundWork as string, r: 0 });
                    setAdded((prev) => ({ ...prev, [i]: true }));
                  }}
                >
                  {added[i] ? "Added ✓" : "Add to change order"}
                </button>
              </div>
            ) : null}
          </div>
        ))}

        {pending ? <AiThinkingBlock /> : null}

        {/* The error sits in the thread, where the answer would have been — not as a toast that
            outlives the question it belongs to. */}
        {error ? (
          <div className="askpage-err" role="alert">
            {error}
          </div>
        ) : null}
      </div>

      <div className="askpage-composer">
        <input
          className="askpage-input"
          value={draft}
          placeholder="Ask anything…"
          aria-label="Ask Mallet"
          enterKeyHint="send"
          onChange={(e) => setDraft(e.target.value)}
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
          aria-disabled={!draft.trim() || pending ? true : undefined}
          onClick={(e) => {
            if (!draft.trim() || pending) {
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
  );
}
