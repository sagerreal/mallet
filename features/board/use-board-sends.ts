"use client";

/**
 * features/board/use-board-sends.ts
 * THE BOARD'S SENT LEDGER — held above the cards, because the card cannot hold it.
 *
 * A card's Send commits the text and the item then leaves the OK queue. On this board that
 * removal is what strips `BoardItem.ok`, which unmounts the send block along with any "✓ sent"
 * state inside it — and flips the card's tone from `attention` to `waiting`, so it jumps to
 * another group in the same paint the owner clicked in. The promised 30-second Undo simply never
 * rendered.
 *
 * So the ledger lives here, at the board, exactly as `ok-queue.tsx` keeps `SentEntry[]` at the
 * queue rather than in a card: the send commits and dispatches immediately, the card holds its
 * place showing the confirmation, and the DISMISSAL — the thing that actually moves the card — is
 * deferred to the end of the undo window. One witnessed change, after the owner's last chance to
 * take it back.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { clockNow } from "@/features/home/send";

/** How long a sent text can be taken back. The OK queue's window, to the millisecond. */
export const UNDO_WINDOW_MS = 30_000;

interface SentEntry {
  /** The OkItem key the queue dismisses by — NOT the card key. The two are different ids. */
  okKey: string;
  when: string;
  undo: () => void;
  expiresAt: number;
}

/** What a card needs to draw the confirmation line. */
export interface BoardSent {
  when: string;
  secondsLeft: number;
}

export interface BoardSends {
  sentOf(itemKey: string): BoardSent | null;
  record(itemKey: string, okKey: string, undo: () => void): void;
  /** The send failed and was already rolled back — forget it without undoing twice. */
  drop(itemKey: string): void;
  undo(itemKey: string): void;
}

/** One card's slice of the ledger, so the board's JSX carries no bookkeeping. */
export interface CardSend {
  /** Non-null while the undo window is open — the card shows the ✓ line instead of Send. */
  sent: BoardSent | null;
  onSent(undo: () => void): void;
  onFailed(): void;
  onUndo(): void;
}

export function cardSendOf(sends: BoardSends, itemKey: string, okKey: string): CardSend {
  return {
    sent: sends.sentOf(itemKey),
    onSent: (undo) => sends.record(itemKey, okKey, undo),
    onFailed: () => sends.drop(itemKey),
    onUndo: () => sends.undo(itemKey),
  };
}

const without = (entries: Record<string, SentEntry>, key: string): Record<string, SentEntry> =>
  Object.fromEntries(Object.entries(entries).filter(([k]) => k !== key));

export function useBoardSends(): BoardSends {
  const dismissAttention = useAppStore((s) => s.dismissAttention);
  const [entries, setEntries] = useState<Record<string, SentEntry>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [, tick] = useState(0);

  // One second tick while any window is open — the countdown has to actually count.
  const anyOpen = Object.keys(entries).length > 0;
  useEffect(() => {
    if (!anyOpen) return;
    const iv = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, [anyOpen]);

  // A pending dismissal must not outlive the board: it would remove an item from a queue nobody
  // is looking at, on a screen the owner has already left.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of Object.values(pending)) clearTimeout(t);
    };
  }, []);

  const clearTimer = useCallback((itemKey: string) => {
    const t = timers.current[itemKey];
    if (!t) return;
    clearTimeout(t);
    delete timers.current[itemKey];
  }, []);

  const drop = useCallback(
    (itemKey: string) => {
      clearTimer(itemKey);
      setEntries((prev) => without(prev, itemKey));
    },
    [clearTimer],
  );

  const record = useCallback(
    (itemKey: string, okKey: string, undo: () => void) => {
      setEntries((prev) => ({
        ...prev,
        [itemKey]: { okKey, when: clockNow(), undo, expiresAt: Date.now() + UNDO_WINDOW_MS },
      }));
      timers.current[itemKey] = setTimeout(() => {
        // The window closed and the send stands. NOW the item leaves the queue — which is what
        // moves the card, once, where the owner can see it happen.
        dismissAttention(okKey);
        drop(itemKey);
      }, UNDO_WINDOW_MS);
    },
    [dismissAttention, drop],
  );

  const undo = useCallback(
    (itemKey: string) => {
      const entry = entries[itemKey];
      if (!entry) return;
      // Nothing to un-dismiss: board mode never dismissed. The commit's own inverse is the whole
      // rollback, and the card was never going anywhere.
      entry.undo();
      drop(itemKey);
    },
    [entries, drop],
  );

  const sentOf = useCallback(
    (itemKey: string): BoardSent | null => {
      const entry = entries[itemKey];
      if (!entry) return null;
      return {
        when: entry.when,
        secondsLeft: Math.max(0, Math.ceil((entry.expiresAt - Date.now()) / 1000)),
      };
    },
    [entries],
  );

  return { sentOf, record, drop, undo };
}
