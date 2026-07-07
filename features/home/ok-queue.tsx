/**
 * features/home/ok-queue.tsx
 * The drafts + the ledger. Each draft is the ACTUAL artifact — an outbound SMS
 * bubble in ghost ink, one amber Send from real. Sending is a witnessed state
 * change: the bubble inks in and slides (the text "goes"), the card folds shut,
 * a timestamped line materializes in the ledger beside the overnight entries,
 * and the hero figure drains (it derives from the store, so Undo refills it).
 * No chips, no captions, no headers — the artifacts carry the meaning.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { firstName, type OkItem, type Receipt } from "./derive";
import { draftFor, softDraftFor } from "./drafts";

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

function clockNow(): string {
  // Match the ledger's act-timestamp format exactly ("8:47pm") — one voice.
  return new Date()
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .toLowerCase()
    .replace(" ", "");
}

// ---- one draft card ----------------------------------------------------------

function OkCard({
  item,
  leaving,
  onSend,
  onSkip,
  onCall,
}: {
  item: OkItem;
  leaving: boolean;
  onSend: (item: OkItem, text: string) => void;
  onSkip: (item: OkItem) => void;
  onCall: (item: OkItem) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(() => draftFor(item));

  function soften() {
    setText(softDraftFor(item));
    setEditing(true);
  }

  return (
    <div className={`okwrap${leaving ? " leaving" : ""}`}>
      <div className="okinner">
        <div className="card okcard" style={{ padding: "14px 16px", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <b style={{ fontSize: 14, whiteSpace: "nowrap" }}>{item.lead.name}</b>
            <span className="muted" style={{ fontSize: 12.5, flex: 1, minWidth: 0 }}>
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
                margin: "10px 0 0",
                border: "1.5px solid var(--accent)",
                borderRadius: "18px 18px 18px 4px",
                padding: "10px 14px",
                fontFamily: "inherit",
                fontSize: 13,
                lineHeight: 1.55,
                background: "var(--card)",
                color: "var(--ink)",
              }}
            />
          ) : (
            <div className="okghost" style={{ margin: "10px 0 0" }}>
              {text}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button
              className="btn sm approve"
              aria-label={`Send to ${firstName(item.lead.name)}`}
              onClick={() => onSend(item, text)}
            >
              Send
            </button>
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
              <button className="btn sm ghost" onClick={() => onCall(item)}>
                Call {firstName(item.lead.name)}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- the queue + the ledger ----------------------------------------------------

export function OkQueue({ items, receipts }: { items: OkItem[]; receipts: Receipt[] }) {
  const openModal = useOpenModal();
  const addLeadNote = useAppStore((s) => s.addLeadNote);
  const removeLeadNote = useAppStore((s) => s.removeLeadNote);
  const updateLead = useAppStore((s) => s.updateLead);
  const updateEstimate = useAppStore((s) => s.updateEstimate);
  const updateInvoice = useAppStore((s) => s.updateInvoice);
  const moveLeadStage = useAppStore((s) => s.moveLeadStage);
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
    const note = addLeadNote(item.lead.id, {
      type: "text",
      from: "auto",
      when: "Just now",
      t: text,
    });

    let revertKind: () => void = () => {};
    if (item.kind === "quote-viewed" && item.estimate) {
      const prevFu = item.estimate.fu;
      const estId = item.estimate.id;
      updateEstimate(estId, { fu: { on: true, stage: prevFu.stage + 1 } });
      revertKind = () => updateEstimate(estId, { fu: prevFu });
    } else if (item.kind === "invoice-overdue" && item.invoice) {
      const prevFu = item.invoice.fu ?? { on: true, stage: 0 };
      const invId = item.invoice.id;
      updateInvoice(invId, { fu: { on: true, stage: prevFu.stage + 1 } });
      revertKind = () => updateInvoice(invId, { fu: prevFu });
    } else if (item.kind === "reply") {
      const leadId = item.lead.id;
      updateLead(leadId, { unread: false });
      revertKind = () => updateLead(leadId, { unread: true });
    } else if (item.kind === "new-lead") {
      const leadId = item.lead.id;
      moveLeadStage(leadId, "Contacted");
      revertKind = () => moveLeadStage(leadId, "New customer");
    }

    // EXIT — bubble inks in + card folds, then the item leaves the queue
    // (which is what drains the hero figure) and the ledger line lands.
    setLeaving((prev) => new Set(prev).add(item.key));
    const leadId = item.lead.id;
    const noteId = note.id ?? "";
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
              removeLeadNote(leadId, noteId);
              revertKind();
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

  function openReceipt(r: Receipt) {
    if (r.open.kind === "thread") openModal(MODAL.THREAD, { leadId: r.open.id });
    else openModal(MODAL.EST, { estId: r.open.id });
  }

  const hasLedger = receipts.length > 0 || sent.length > 0;

  return (
    <div style={{ marginTop: 18 }}>
      {items.map((item) => (
        <OkCard
          key={item.key}
          item={item}
          leaving={leaving.has(item.key)}
          onSend={handleSend}
          onSkip={(it) => dismissAttention(it.key)}
          onCall={(it) => openModal(MODAL.CALL, { leadId: it.lead.id })}
        />
      ))}

      {/* THE LEDGER — overnight receipts and just-sent items, one primitive.
          The timestamps are the section header. */}
      {hasLedger && (
        <div style={{ marginTop: items.length > 0 ? 16 : 0 }} aria-live="polite">
          {receipts.map((r) => (
            <div key={r.key} className="ledgerrow">
              <b className="fig" style={{ whiteSpace: "nowrap" }}>{r.when}</b>
              <span style={{ minWidth: 0 }}>
                {r.text}
                <span className="muted"> · </span>
                <button
                  type="button"
                  className="linklike"
                  style={{ fontSize: 12, whiteSpace: "nowrap" }}
                  onClick={() => openReceipt(r)}
                >
                  {r.openLabel} ›
                </button>
              </span>
            </div>
          ))}
          {sent.map((e) => (
            <div key={e.key} className="ledgerrow">
              <b className="fig" style={{ whiteSpace: "nowrap" }}>{e.when}</b>
              <span style={{ minWidth: 0 }}>
                {`✓ sent to ${e.leadFirst} — it's in the thread`}
                <span className="muted"> · </span>
                <button
                  type="button"
                  className="linklike"
                  style={{ fontSize: 12, whiteSpace: "nowrap" }}
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
