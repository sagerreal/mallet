/**
 * features/home/send-block.tsx
 * THE ON-CARD SEND — a drafted text sitting on the face of a card, one amber Send from real, with
 * a 30s undo after it goes.
 *
 * Lives here rather than inside a card file so any surface that needs the gesture gets the SAME
 * answer to "what does Send do here" — a second copy would be a second answer. The work board's
 * cards are its one caller today (the retired /pipeline board was the other); the commit itself
 * stays in send.ts (commitOkSend) and this is only the surface.
 *
 * The optional props exist because a caller may own the confirmation at a different LEVEL than the
 * card: pass `send` and the owner holds the ✓ line and its Undo, omit it and this block holds them
 * itself. Everything that MATTERS — one commit, one dispatch, one undo, one failure path — is
 * shared either way, which is the whole point of the extraction.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store/app-store";
import { reportWriteError } from "@/lib/store/write-error";
import { clockNow, commitOkSend, dispatchOkSend, okSendKey } from "./send";
import type { OkItem } from "./derive";

const UNDO_MS = 30_000;

/**
 * "8:47pm ✓ sent · Undo · 26s" — the witnessed line a sent text leaves behind.
 *
 * Exported, because this state can be owned at two different LEVELS: SendBlock keeps it itself by
 * default, while the work board keeps it ABOVE the card (the card's draft vanishes the moment the
 * item leaves the queue, taking any local state with it). Same line either way.
 */
export function SentRow({
  when,
  secondsLeft,
  onUndo,
}: {
  when: string;
  secondsLeft: number;
  onUndo(): void;
}) {
  return (
    <div className="cardsent fig" onClick={(e) => e.stopPropagation()}>
      {when} ✓ sent
      {secondsLeft > 0 && (
        <>
          {" · "}
          <button type="button" className="linklike" onClick={onUndo}>
            Undo · {secondsLeft}s
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Who owns what happens AFTER the commit.
 *
 * Present ⇒ board mode: the caller owns the confirmation row, the undo window and the dismissal
 * that makes the item leave its queue. SendBlock keeps only the part that must never fork —
 * commit, dispatch, roll back on failure.
 */
export interface SendLedger {
  /** Committed and in flight. Handed the exact inverse, for the caller's Undo. */
  onSent(undo: () => void): void;
  /** It never left. SendBlock has already run the inverse and announced why. */
  onFailed(): void;
}

export function SendBlock({
  item,
  fallback,
  initial,
  label,
  secondary,
  blockedReason,
  ledger,
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
  /** Set ⇒ the caller owns the sent state and the dismissal. See SendLedger. */
  ledger?: SendLedger;
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

  /**
   * BOARD MODE. Nothing is dismissed here: dismissing on click makes the item leave the OK queue
   * in the same paint, which strips the card's draft, unmounts this component with its local
   * "✓ sent" state, and jumps the card into another group under the owner's cursor. The caller
   * holds the ledger above the card and dismisses when the undo window closes.
   */
  function sendThroughLedger(owner: SendLedger, queued: OkItem, body: string) {
    const undoSend = commitOkSend(queued, body);
    owner.onSent(undoSend);
    dispatchOkSend(queued.lead.id, body, okSendKey(queued)).catch((err: unknown) => {
      undoSend();
      owner.onFailed();
      reportWriteError("sendText", err);
    });
  }

  function send(e: React.MouseEvent) {
    e.stopPropagation();
    /**
     * THE GUARD THAT HAS TO COME FIRST.
     *
     * Everything below this line is optimistic: it appends the note, advances the record, stamps
     * "✓ Sent 2:14pm" and dismisses the card, and only THEN calls the server. On a shop without an
     * active 10DLC campaign the server refuses, and the owner watches a text they never sent get
     * ticked off and the card come back. Refusing here means the queue never claims it.
     *
     * `aria-disabled` is a label, not a behaviour — the click still arrives — so this is the only
     * thing actually stopping the send.
     */
    if (blockedReason) {
      e.preventDefault();
      return;
    }
    const body = text.trim();
    if (item) {
      if (ledger) {
        sendThroughLedger(ledger, item, body);
        return;
      }
      const undoSend = commitOkSend(item, body);
      dismissAttention(item.key);
      const revert = () => {
        undoSend();
        undismissAttention(item.key);
      };
      setSent({ when: clockNow(), undo: revert, expiresAt: Date.now() + UNDO_MS });
      // REAL dispatch (v1.messaging.send), keyed on the record and the day (okSendKey) — two
      // clicks are one text, a genuine reminder on a later day is a second one.
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
      <SentRow
        when={sent.when}
        secondsLeft={secs}
        onUndo={() => {
          sent.undo();
          setSent(null);
        }}
      />
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
        {/* BLOCKED, NOT DISABLED, and the reason is never a `title`. A tooltip does not exist on
            the phone half of this audience, and `disabled` drops the control out of the tab order
            so a screen reader gets silence where a sighted owner gets an explanation. The reason
            renders as a line under the row instead — see the .sms-note below. */}
        <Button
          variant="approve"
          size="sm"
          aria-disabled={blockedReason ? true : undefined}
          onClick={send}
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
      {/* One clause, no call to action — the app-wide banner owns the fix. `status` rather than
          `alert`: this is a standing condition of the shop, not something that just went wrong. */}
      {blockedReason && <p role="status" className="sms-note">{blockedReason}</p>}
    </div>
  );
}
