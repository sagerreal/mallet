/**
 * features/home/ok-queue.tsx
 * The drafts. Each draft is the ACTUAL artifact — an outbound SMS bubble in
 * ghost ink, one amber Send from real. Sending is a witnessed state change:
 * the bubble inks in and slides (the text "goes"), the card folds shut, a
 * transient "✓ sent · Undo" line appears for 30s, and the hero figure drains
 * (it derives from the store, so Undo refills it). No chips, no captions, no
 * headers — the artifacts carry the meaning.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { PhoneGate } from "@/lib/phone";
import { firstName, type OkItem } from "./derive";
import { draftFor, softDraftFor, type DraftContext } from "./drafts";
import { clockNow, commitOkSend, dispatchOkSend, okSendKey } from "./send";

const UNDO_MS = 30_000;
/** Bubble inks in (180ms) → card folds (260ms, delayed 180ms) → dismiss. */
const EXIT_MS = 460;

interface SentEntry {
  key: string;
  leadFirst: string;
  when: string;
  restore: () => void;
  expiresAt: number;
}

// ---- one draft card ----------------------------------------------------------

function OkCard({
  item,
  leaving,
  ctx,
  onSend,
  onSkip,
  onCall,
  onSavePhone,
}: {
  item: OkItem;
  leaving: boolean;
  ctx: DraftContext;
  onSend: (item: OkItem, text: string) => void;
  onSkip: (item: OkItem) => void;
  onCall: (item: OkItem) => void;
  onSavePhone: (item: OkItem, phone: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(() => draftFor(item, ctx));

  function soften() {
    setText(softDraftFor(item, ctx));
    setEditing(true);
  }

  return (
    <div className={`okwrap${leaving ? " leaving" : ""}`}>
      <div className="okinner">
        <div className="card okcard" style={{ padding: "var(--space-4) var(--space-4)", marginBottom: "var(--space-3)" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)" }}>
            <b style={{ fontSize: "var(--type-md)", whiteSpace: "nowrap" }}>{item.lead.name}</b>
            {/* invoice-overdue situations carry a server-derived "N days" age that
                drifts past the browser Date-freeze (see handoff-note) — mask it so
                the visual net doesn't flake by one day. */}
            <span
              className="muted"
              data-dynamic={item.kind === "invoice-overdue" ? "" : undefined}
              style={{ fontSize: "var(--type-base)", flex: 1, minWidth: 0 }}
            >
              {item.situation}
            </span>
            <button
              type="button"
              className="linklike okskip"
              aria-label={`Skip ${item.lead.name}`}
              onClick={() => onSkip(item)}
            >
              ✕
            </button>
          </div>

          {editing ? (
            <textarea
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              aria-label={`Message to ${item.lead.name}`}
              style={{
                width: "100%",
                boxSizing: "border-box",
                margin: "var(--space-3) 0 0",
                border: "1.5px solid var(--accent)",
                borderRadius: "18px 18px 18px 4px",
                padding: "var(--space-3) var(--space-4)",
                fontFamily: "inherit",
                fontSize: "var(--type-base)",
                lineHeight: 1.55,
                background: "var(--card)",
                color: "var(--ink)",
              }}
            />
          ) : (
            <div className="okghost" style={{ margin: "var(--space-3) 0 0" }}>
              {text}
            </div>
          )}

          {/* Send/Call stay TAPPABLE: without a phone on file, PhoneGate expands
              an in-flow add-number row and auto-proceeds once saved (Send is a
              local draft-send; Call opens the call sheet). */}
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)", flexWrap: "wrap" }}>
            <PhoneGate
              bearer={item.lead}
              addLabel="No phone number yet"
              addSub={`Add ${firstName(item.lead.name)}'s mobile and this text goes out.`}
              addCta="Save & send"
              onSavePhone={(p) => onSavePhone(item, p)}
              onAction={() => onSend(item, text)}
            >
              {({ onClick }) => (
                <button
                  className="btn sm approve"
                  aria-label={`Send to ${firstName(item.lead.name)}`}
                  onClick={onClick}
                >
                  Send
                </button>
              )}
            </PhoneGate>
            {item.kind === "invoice-overdue" ? (
              <button className="btn sm ghost" onClick={soften}>
                Soften it
              </button>
            ) : (
              <button className="btn sm ghost" onClick={() => setEditing((v) => !v)}>
                {editing ? "Done" : "Change"}
              </button>
            )}
            {item.kind !== "invoice-overdue" && (
              <PhoneGate
                bearer={item.lead}
                addLabel="No phone number yet"
                addSub={`Add ${firstName(item.lead.name)}'s mobile to call them.`}
                addCta="Save & call"
                onSavePhone={(p) => onSavePhone(item, p)}
                onAction={() => onCall(item)}
              >
                {({ onClick }) => (
                  <button className="btn sm ghost" onClick={onClick}>
                    Call {firstName(item.lead.name)}
                  </button>
                )}
              </PhoneGate>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- the queue -------------------------------------------------------------------

export function OkQueue({ items, ctx = {} }: { items: OkItem[]; ctx?: DraftContext }) {
  // Sending one at a time is fine for five cards and absurd for the collections queue — a shop
  // with 239 open invoices is not clicking Send 239 times. The bulk action is deliberately
  // ARMED rather than instant: it names the count and the money before it fires, because it
  // sends real messages to real customers and there is no unsending them in bulk.
  const [armedBulk, setArmedBulk] = useState(false);
  const openModal = useOpenModal();
  const updateLead = useAppStore((s) => s.updateLead);
  const dismissAttention = useAppStore((s) => s.dismissAttention);
  const undismissAttention = useAppStore((s) => s.undismissAttention);

  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [sent, setSent] = useState<SentEntry[]>([]);
  const [, forceTick] = useState(0);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // 1s tick while any Undo window is open (countdown + expiry).
  useEffect(() => {
    if (sent.length === 0) return;
    const iv = setInterval(() => {
      const now = Date.now();
      setSent((prev) => prev.filter((e) => e.expiresAt > now));
      forceTick((n) => n + 1);
    }, 1000);
    return () => clearInterval(iv);
  }, [sent.length]);

  // Clear exit timers on unmount.
  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  function handleSend(item: OkItem, text: string) {
    // COMMIT — synchronous, before any animation. The message is real now.
    // (Shared primitive: the Counter's sends run this exact code path.)
    const undoSend = commitOkSend(item, text);

    // REAL dispatch (v1.messaging.send) — the local commit above is the queue's
    // bookkeeping; this is the actual message. On failure the commit reverts and
    // the card returns to the queue (same rollback contract as store writes).
    dispatchOkSend(item.lead.id, text, okSendKey(item)).catch(() => {
      undoSend();
      undismissAttention(item.key);
      setSent((prev) => prev.filter((e) => e.key !== item.key));
      setLeaving((prev) => {
        const next = new Set(prev);
        next.delete(item.key);
        return next;
      });
    });

    // EXIT — bubble inks in + card folds, then the item leaves the queue
    // (which is what drains the hero figure) and the ledger line lands.
    setLeaving((prev) => new Set(prev).add(item.key));
    timersRef.current.push(
      setTimeout(() => {
        dismissAttention(item.key);
        setLeaving((prev) => {
          const next = new Set(prev);
          next.delete(item.key);
          return next;
        });
        setSent((prev) => [
          ...prev,
          {
            key: item.key,
            leadFirst: firstName(item.lead.name),
            when: clockNow(),
            expiresAt: Date.now() + UNDO_MS,
            restore: () => {
              undoSend();
              undismissAttention(item.key);
            },
          },
        ]);
      }, EXIT_MS)
    );
  }

  function handleUndo(entry: SentEntry) {
    entry.restore();
    setSent((prev) => prev.filter((e) => e !== entry));
  }

  const overdue = items.filter((i) => i.kind === "invoice-overdue");
  // Only the ones a text can actually reach. The rest need a number first, and saying so is the
  // difference between "23 reminders sent" and 23 messages that went nowhere.
  const sendableOverdue = overdue.filter((i) => (i.lead.phone ?? "").trim().length > 0);
  const missingPhone = overdue.length - sendableOverdue.length;
  const overdueSum = sendableOverdue.reduce((sum, i) => sum + i.value, 0);

  function sendAllOverdue() {
    // One pass, using the same single-card path — so each send gets the same commit, the same
    // rollback on failure, and the same ledger line. A bulk action that took a shortcut around
    // that would be the one place failures went unreported.
    //
    // A card with NO PHONE is skipped, not sent. It used to go through the same loop and report
    // itself as sent — a text to nobody, counted as done. The single-card path never had this
    // problem because it stops at the add-a-number row; the bulk path went around it.
    for (const item of sendableOverdue) handleSend(item, draftFor(item, ctx));
    setArmedBulk(false);
  }

  return (
    <div style={{ marginTop: "var(--space-5)" }}>
      {sendableOverdue.length > 1 && (
        <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap", marginBottom: "var(--space-3)", padding: "var(--space-3) var(--space-4)" }}>
          <span>
            <strong>{overdue.length} overdue {overdue.length === 1 ? "invoice" : "invoices"}</strong>
            <span className="muted"> · ${Math.round(overdueSum).toLocaleString("en-US")} reachable by text</span>
            {missingPhone > 0 && (
              <span className="muted"> · {missingPhone} with no phone number</span>
            )}
          </span>
          {armedBulk ? (
            <span style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", flexWrap: "wrap" }}>
              <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
                Sends {sendableOverdue.length} {sendableOverdue.length === 1 ? "message" : "messages"} now
                {missingPhone > 0 ? `; ${missingPhone} skipped — no number on file` : ""}.
              </span>
              <button className="btn sm" onClick={() => setArmedBulk(false)}>Cancel</button>
              <button className="btn sm primary" onClick={sendAllOverdue}>Yes, send all</button>
            </span>
          ) : (
            <button className="btn sm" onClick={() => setArmedBulk(true)}>
              Send all reminders
            </button>
          )}
        </div>
      )}

      {items.map((item) => (
        <OkCard
          key={item.key}
          item={item}
          leaving={leaving.has(item.key)}
          ctx={ctx}
          onSend={handleSend}
          onSkip={(it) => dismissAttention(it.key)}
          onCall={(it) => openModal(MODAL.CALL, { leadId: it.lead.id })}
          onSavePhone={(it, phone) => updateLead(it.lead.id, { phone })}
        />
      ))}

      {/* Just-sent lines — transient (30s), each carrying its Undo. */}
      {sent.length > 0 && (
        <div style={{ marginTop: items.length > 0 ? 16 : 0 }} aria-live="polite">
          {sent.map((e) => (
            <div key={e.key} className="ledgerrow">
              <b className="fig" style={{ whiteSpace: "nowrap" }}>{e.when}</b>
              <span style={{ minWidth: 0 }}>
                {`✓ sent to ${e.leadFirst} — it's in the thread`}
                <span className="muted"> · </span>
                <button
                  type="button"
                  className="linklike"
                  style={{ fontSize: "var(--type-sm)", whiteSpace: "nowrap" }}
                  onClick={() => handleUndo(e)}
                >
                  Undo · {Math.max(0, Math.ceil((e.expiresAt - Date.now()) / 1000))}s
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
