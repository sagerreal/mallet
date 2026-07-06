/**
 * features/home/ok-queue.tsx
 * The Needs-your-OK queue — the heart of the Handoff. Each card is a prepared
 * ARTIFACT (a drafted text you can read), not a chore: Send fires it into the
 * customer's real thread (with a 30s Undo that fully reverts), Change opens the
 * draft for editing in place, Skip dismisses for the session. Ranked by dollars.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { fmt$ } from "@/lib/format";
import { firstName, type OkItem } from "./derive";
import { draftFor, softDraftFor } from "./drafts";

const UNDO_MS = 30_000;

interface SentEntry {
  item: OkItem;
  noteId: string;
  restore: () => void;
  expiresAt: number;
}

/** One queue card — situation line, the draft, and the three-button row. */
function OkCard({
  item,
  onSend,
  onSkip,
  onCall,
}: {
  item: OkItem;
  onSend: (item: OkItem, text: string) => void;
  onSkip: (item: OkItem) => void;
  onCall: (item: OkItem) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(() => draftFor(item));

  const canCall = item.kind !== "invoice-overdue";

  function soften() {
    if (item.kind === "invoice-overdue") {
      setText(softDraftFor(item));
      setEditing(true);
    } else {
      setEditing(true);
    }
  }

  return (
    <div className="card" style={{ padding: "14px 16px", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <b style={{ fontSize: 14 }}>{item.lead.name}</b>
        <span className="muted" style={{ fontSize: 12.5, flex: 1, minWidth: 0 }}>
          {item.situation}
        </span>
        {item.value > 0 && <b className="fig">{fmt$(item.value)}</b>}
        <button
          type="button"
          className="linklike"
          aria-label={`Skip ${item.lead.name}`}
          style={{ color: "var(--ink-3)", fontSize: 14 }}
          onClick={() => onSkip(item)}
        >
          ✕
        </button>
      </div>

      {/* The prepared message — read it, tweak it, or just send it. */}
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
            borderRadius: 10,
            padding: "9px 11px",
            fontFamily: "inherit",
            fontSize: 13,
            background: "var(--card)",
            color: "var(--ink)",
          }}
        />
      ) : (
        <div
          style={{
            margin: "10px 0 0",
            background: "var(--paper)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: "9px 12px",
            fontSize: 13,
            lineHeight: 1.5,
            color: "var(--ink-2)",
          }}
        >
          {text}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button className="btn sm primary" onClick={() => onSend(item, text)}>
          Send
        </button>
        {item.kind === "invoice-overdue" ? (
          <button className="btn sm ghost" onClick={soften}>
            Soften it
          </button>
        ) : (
          <button className="btn sm ghost" onClick={() => setEditing((v) => !v)}>
            {editing ? "Done editing" : item.editLabel}
          </button>
        )}
        {canCall && (
          <button className="btn sm ghost" onClick={() => onCall(item)}>
            Call {firstName(item.lead.name)}
          </button>
        )}
      </div>
    </div>
  );
}

export function OkQueue({ items }: { items: OkItem[] }) {
  const openModal = useOpenModal();
  const addLeadNote = useAppStore((s) => s.addLeadNote);
  const removeLeadNote = useAppStore((s) => s.removeLeadNote);
  const updateLead = useAppStore((s) => s.updateLead);
  const updateEstimate = useAppStore((s) => s.updateEstimate);
  const updateInvoice = useAppStore((s) => s.updateInvoice);
  const moveLeadStage = useAppStore((s) => s.moveLeadStage);
  const dismissAttention = useAppStore((s) => s.dismissAttention);
  const undismissAttention = useAppStore((s) => s.undismissAttention);

  const [sent, setSent] = useState<SentEntry[]>([]);
  const [, forceTick] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tick once a second while an Undo window is open (for the countdown label).
  useEffect(() => {
    if (sent.length === 0) {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }
    tickRef.current = setInterval(() => {
      const now = Date.now();
      setSent((prev) => prev.filter((e) => e.expiresAt > now));
      forceTick((n) => n + 1);
    }, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [sent.length]);

  function handleSend(item: OkItem, text: string) {
    const note = addLeadNote(item.lead.id, {
      type: "text",
      from: "auto",
      when: "Just now",
      t: text,
    });

    // Kind-specific bookkeeping + its exact inverse for Undo.
    let revertKind: () => void = () => {};
    if (item.kind === "quote-viewed" && item.estimate) {
      const prevFu = item.estimate.fu;
      updateEstimate(item.estimate.id, { fu: { on: true, stage: prevFu.stage + 1 } });
      const estId = item.estimate.id;
      revertKind = () => updateEstimate(estId, { fu: prevFu });
    } else if (item.kind === "invoice-overdue" && item.invoice) {
      const prevFu = item.invoice.fu ?? { on: true, stage: 0 };
      updateInvoice(item.invoice.id, { fu: { on: true, stage: prevFu.stage + 1 } });
      const invId = item.invoice.id;
      revertKind = () => updateInvoice(invId, { fu: prevFu });
    } else if (item.kind === "reply") {
      updateLead(item.lead.id, { unread: false });
      const leadId = item.lead.id;
      revertKind = () => updateLead(leadId, { unread: true });
    } else if (item.kind === "new-lead") {
      moveLeadStage(item.lead.id, "Contacted");
      const leadId = item.lead.id;
      revertKind = () => moveLeadStage(leadId, "New customer");
    }

    dismissAttention(item.key);
    const leadId = item.lead.id;
    const noteId = note.id ?? "";
    setSent((prev) => [
      ...prev,
      {
        item,
        noteId,
        expiresAt: Date.now() + UNDO_MS,
        restore: () => {
          removeLeadNote(leadId, noteId);
          revertKind();
          undismissAttention(item.key);
        },
      },
    ]);
  }

  function handleUndo(entry: SentEntry) {
    entry.restore();
    setSent((prev) => prev.filter((e) => e !== entry));
  }

  if (items.length === 0 && sent.length === 0) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: ".07em",
          color: "var(--ink-3)",
          marginBottom: 8,
        }}
      >
        Needs your OK{items.length > 0 ? ` · ${items.length}` : ""}
      </div>

      {items.map((item) => (
        <OkCard
          key={item.key}
          item={item}
          onSend={handleSend}
          onSkip={(it) => dismissAttention(it.key)}
          onCall={(it) => openModal(MODAL.CALL, { leadId: it.lead.id })}
        />
      ))}

      {/* Just-sent rows — visible proof + a real 30s Undo. */}
      {sent.map((e) => (
        <div
          key={e.item.key}
          className="card"
          style={{
            padding: "10px 16px",
            marginBottom: 10,
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "var(--green-50)",
          }}
        >
          <span style={{ fontSize: 13 }}>
            ✓ Sent to <b>{firstName(e.item.lead.name)}</b>
            <span className="muted"> — it's in the thread</span>
          </span>
          <button
            type="button"
            className="linklike"
            style={{ marginLeft: "auto", fontSize: 12.5 }}
            onClick={() => handleUndo(e)}
          >
            Undo · {Math.max(0, Math.ceil((e.expiresAt - Date.now()) / 1000))}s
          </button>
        </div>
      ))}
    </div>
  );
}
