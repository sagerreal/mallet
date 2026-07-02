/**
 * components/modals/thread-modal.tsx
 * Faithful port of the prototype's openThread / threadRows / sendText / simReply
 * (lines 6492-6536). SMS thread with the business-number framing, bubble rows,
 * a composer, and the prototype's two "simulate a reply" affordances.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useAppStore, useActiveModal } from "@/lib/store/app-store";
import type { Lead, LeadNote } from "@/lib/store/types";

const CANNED_REPLIES = [
  "Sounds good 👍",
  "Could you do Thursday afternoon?",
  "What would that run me roughly?",
  "Yes please — go ahead.",
];

function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

/** One timeline row — a system chip for calls/visits/ai, a bubble for texts. */
function ThreadRow({ act, lead }: { act: LeadNote; lead: Lead }) {
  if (act.type === "call") {
    const dir = act.dir === "in" ? "Incoming" : "Outgoing";
    return (
      <div className="tsys">
        {dir} call · {act.outcome}
        {act.dur ? ` · ${act.dur}` : ""} · {act.when}
      </div>
    );
  }
  if (act.type === "visit" || act.type === "ai") {
    return (
      <div className="tsys">
        {act.t} · {act.when}
      </div>
    );
  }
  // text message
  const from = act.from ?? "us";
  const metaWho =
    from === "them" ? `${firstName(lead.name)} · ` : from === "auto" ? "" : "You · ";
  return (
    <div className={`msg ${from}`}>
      <div className="bub">{act.t}</div>
      <div className="meta">
        {metaWho}
        {act.when}
      </div>
    </div>
  );
}

export function ThreadModalContent() {
  const activeModal = useActiveModal();
  const leadId = activeModal?.params?.leadId as number | undefined;
  const leads = useAppStore((s) => s.leads);
  const addLeadNote = useAppStore((s) => s.addLeadNote);
  const updateLead = useAppStore((s) => s.updateLead);
  const lead = leads.find((l) => l.id === leadId);

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Opening the thread clears the unread flag (prototype: l.unread=false).
  useEffect(() => {
    if (lead?.unread) updateLead(lead.id, { unread: false });
  }, [lead?.id, lead?.unread, updateLead]);

  // Keep the thread pinned to the newest message.
  const actCount = lead?.acts?.length ?? 0;
  useEffect(() => {
    const sc = scrollRef.current;
    if (sc) sc.scrollTop = sc.scrollHeight;
  }, [actCount]);

  if (!lead) return null;

  const acts = lead.acts ?? [];

  function send() {
    if (!lead) return;
    const v = draft.trim();
    if (!v) return;
    addLeadNote(lead.id, { type: "text", from: "us", t: v, when: "Just now" });
    setDraft("");
  }

  function simReply() {
    if (!lead) return;
    const themCount = acts.filter((a) => a.type === "text" && a.from === "them").length;
    addLeadNote(lead.id, {
      type: "text",
      from: "them",
      t: CANNED_REPLIES[themCount % CANNED_REPLIES.length],
      when: "Just now",
    });
  }

  function simReplyAway() {
    if (!lead) return;
    addLeadNote(lead.id, {
      type: "text",
      from: "them",
      t: "Hey — any update on this?",
      when: "Just now",
    });
    updateLead(lead.id, { unread: true });
  }

  return (
    <div>
      <h2 style={{ marginBottom: 2 }}>{lead.name}</h2>
      <div className="muted" style={{ fontSize: 12 }}>
        {lead.phone} · texting from your <b>business number</b> — quote links and
        reminders land in this same thread, marked ✦
      </div>

      <div className="thread" ref={scrollRef}>
        {acts.length > 0 ? (
          acts.map((act, i) => <ThreadRow key={act.id ?? i} act={act} lead={lead} />)
        ) : (
          <div className="tsys">No messages yet — say hi 👋</div>
        )}
      </div>

      <div className="composer">
        <input
          value={draft}
          placeholder={`Text ${firstName(lead.name)}…`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
        />
        <button className="btn primary" onClick={send}>
          Send
        </button>
      </div>

      <p className="muted" style={{ marginTop: 8, fontSize: 11.5 }}>
        Prototype:{" "}
        <span className="linklike" onClick={simReply}>
          simulate a reply now
        </span>{" "}
        ·{" "}
        <span className="linklike" onClick={simReplyAway}>
          simulate a reply while you are away
        </span>
      </p>
    </div>
  );
}
