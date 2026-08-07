/**
 * features/home/send-block.tsx
 * THE ON-CARD SEND — a drafted text sitting on the face of a card, one amber
 * Send from real, with a 30s undo after it goes.
 *
 * Extracted from features/pipeline/board-cards.tsx unchanged so more than one
 * board can carry it: the pipeline's rail cards and the work board's cards are
 * the same gesture, and a second copy would be a second answer to "what does
 * Send do here". The commit itself stays in send.ts (commitOkSend) — this is
 * only the surface.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { userMessage } from "@/lib/trpc/error-map";
import { clockNow, commitOkSend, dispatchOkSend } from "./send";
import type { OkItem } from "./derive";

const UNDO_MS = 30_000;

export function SendBlock({
  item,
  fallback,
  initial,
}: {
  /** OK-queue item to commit through (fu bump etc.), or null for a plain text. */
  item: OkItem | null;
  /** Plain-text fallback target when there's no queue item. */
  fallback: { leadId: string; first: string; age: number };
  initial: string;
}) {
  const dismissAttention = useAppStore((s) => s.dismissAttention);
  const undismissAttention = useAppStore((s) => s.undismissAttention);
  const [text, setText] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [sent, setSent] = useState<{ when: string; undo: () => void; expiresAt: number } | null>(null);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [, tick] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!sent) return;
    timer.current = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [sent]);

  const secs = sent ? Math.max(0, Math.ceil((sent.expiresAt - Date.now()) / 1000)) : 0;

  function send(e: React.MouseEvent) {
    e.stopPropagation();
    const body = text.trim();
    if (item) {
      const undoSend = commitOkSend(item, body);
      dismissAttention(item.key);
      const revert = () => {
        undoSend();
        undismissAttention(item.key);
      };
      setSent({ when: clockNow(), undo: revert, expiresAt: Date.now() + UNDO_MS });
      // REAL dispatch (v1.messaging.send). On failure: revert the local commit, bring
      // the card back, and name the reason — never leave a "✓ sent" that sent nothing.
      dispatchOkSend(item.lead.id, body).catch((err: unknown) => {
        revert();
        setSent(null);
        setSendErr(userMessage(err, "Couldn't send — check your connection and try again."));
      });
      return;
    }
    const s = useAppStore.getState();
    const note = s.addLeadNote(fallback.leadId, { type: "text", from: "us", when: "Just now", t: body });
    s.updateLead(fallback.leadId, { age: 0 });
    const prevAge = fallback.age;
    const revert = () => {
      const s2 = useAppStore.getState();
      s2.removeLeadNote(fallback.leadId, note.id ?? "");
      s2.updateLead(fallback.leadId, { age: prevAge });
    };
    setSent({ when: clockNow(), undo: revert, expiresAt: Date.now() + UNDO_MS });
    dispatchOkSend(fallback.leadId, body).catch((err: unknown) => {
      revert();
      setSent(null);
      setSendErr(userMessage(err, "Couldn't send — check your connection and try again."));
    });
  }

  if (sent) {
    return (
      <div className="cardsent fig" onClick={(e) => e.stopPropagation()}>
        {sent.when} ✓ sent
        {secs > 0 && (
          <>
            {" · "}
            <button
              type="button"
              className="linklike"
              onClick={() => {
                sent.undo();
                setSent(null);
              }}
            >
              Undo · {secs}s
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      {editing ? (
        <textarea
          className="cardghost-edit"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={`Message to ${fallback.first}`}
        />
      ) : (
        <div className="cardghost">{text}</div>
      )}
      {sendErr && (
        <div className="cstamp" style={{ color: "var(--red-700, #b91c1c)" }}>{sendErr}</div>
      )}
      <div className="cardacts">
        <button className="btn sm approve" onClick={send}>
          Send
        </button>
        {/* "Edit text" — edits the CHASE MESSAGE only. (It read "Change" before, which
            sat ambiguously next to a change-requested quote — revising the quote itself
            is the card's "Edit & resend" action.) */}
        <button className="btn sm ghost" onClick={() => setEditing((v) => !v)}>
          {editing ? "Done" : "Edit text"}
        </button>
      </div>
    </div>
  );
}
