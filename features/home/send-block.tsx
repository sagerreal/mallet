/**
 * features/home/send-block.tsx
 * THE ON-CARD SEND — a drafted text sitting on the face of a card, one amber Send from real, with
 * a 30s undo after it goes.
 *
 * Extracted from features/pipeline/board-cards.tsx so more than one board can carry it: the rail's
 * cards and the work board's cards are the same gesture, and a second copy would be a second
 * answer to "what does Send do here". The commit itself stays in send.ts (commitOkSend) — this is
 * only the surface.
 *
 * The three optional props exist because the two boards disagree about exactly one thing each:
 * the work board captions the draft, sends "Change" to the record instead of an inline editor, and
 * has a carrier registration to answer to. Everything that MATTERS — one commit, one dispatch, one
 * undo, one failure path — is shared, which is the whole point of the extraction.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store/app-store";
import { reportWriteError } from "@/lib/store/write-error";
import { clockNow, commitOkSend, dispatchOkSend, okSendKey } from "./send";
import type { OkItem } from "./derive";

const UNDO_MS = 30_000;

export function SendBlock({
  item,
  fallback,
  initial,
  label,
  secondary,
  blockedReason,
}: {
  /** OK-queue item to commit through (fu bump etc.), or null for a plain text. */
  item: OkItem | null;
  /** Plain-text fallback target when there's no queue item. */
  fallback: { leadId: string; first: string; age: number };
  initial: string;
  /** Quiet caption above the draft ("Text · ready to send"). Omitted, the draft speaks for itself. */
  label?: string;
  /** Replaces the inline "Edit text" toggle — the work board sends the owner to the record. */
  secondary?: { label: string; onClick: () => void };
  /**
   * Set ⇒ Send is disabled and states this as its reason. The DRAFT STILL RENDERS: the words are
   * the shop's answer either way, and hiding them because the button is blocked would take away a
   * fact to make a limitation less visible.
   */
  blockedReason?: string;
}) {
  const dismissAttention = useAppStore((s) => s.dismissAttention);
  const undismissAttention = useAppStore((s) => s.undismissAttention);
  const [text, setText] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [sent, setSent] = useState<{ when: string; undo: () => void; expiresAt: number } | null>(null);
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

  /** Put the card back exactly as it was and say why — never a "✓ sent" over a text that failed. */
  function rollBack(revert: () => void, err: unknown) {
    revert();
    setSent(null);
    reportWriteError("sendText", err);
  }

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
      // REAL dispatch (v1.messaging.send), keyed on the record and the follow-up this send IS —
      // two clicks are one text, a genuine second nudge is a second one (okSendKey).
      dispatchOkSend(item.lead.id, body, okSendKey(item)).catch((err: unknown) => rollBack(revert, err));
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
    dispatchOkSend(fallback.leadId, body).catch((err: unknown) => rollBack(revert, err));
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
      {label && <div className="kgrp">{label}</div>}
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
      <div className="cardacts">
        <Button
          variant="approve"
          size="sm"
          onClick={send}
          disabled={Boolean(blockedReason)}
          title={blockedReason}
        >
          Send
        </Button>
        {/* Default: "Edit text" — edits the CHASE MESSAGE only. (It read "Change" before, which
            sat ambiguously next to a change-requested quote — revising the quote itself is the
            card's "Edit & resend" action.) The work board passes its own second action instead. */}
        {secondary ? (
          <Button
            variant="quiet"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              secondary.onClick();
            }}
          >
            {secondary.label}
          </Button>
        ) : (
          <Button variant="quiet" size="sm" onClick={() => setEditing((v) => !v)}>
            {editing ? "Done" : "Edit text"}
          </Button>
        )}
      </div>
    </div>
  );
}
