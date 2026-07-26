/**
 * components/modals/thread-modal.tsx
 * Faithful port of the prototype's openThread / threadRows / sendText / simReply
 * (lines 6492-6536). SMS thread with the business-number framing, bubble rows,
 * a composer, and real two-way SMS via v1.messaging.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { TRPCClientError } from "@trpc/client";
import { useAppStore, useActiveModal, useCloseModal } from "@/lib/store/app-store";
import { api } from "@/lib/trpc/client";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import type { Lead, LeadNote } from "@/lib/store/types";
import type { MessageDTO } from "@mallet/messaging";
import { shortWhen } from "@/lib/format";
import { hasPhone, PhoneAddInput } from "@/lib/phone";

function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

// ── Thread row types ──────────────────────────────────────────────────────────

interface MsgRow {
  kind: "msg";
  id: string;
  from: "us" | "them" | "auto";
  text: string;
  when: string;
  /** Set when the carrier refused it — see MessageDTO.failure. */
  failure?: MessageDTO["failure"];
}

interface SysRow {
  kind: "sys";
  id: string;
  text: string;
}

type Row = MsgRow | SysRow;

function dtoToRow(msg: MessageDTO): MsgRow {
  return {
    kind: "msg",
    id: msg.id,
    from: msg.direction === "inbound" ? "them" : "us",
    text: msg.body,
    when: shortWhen(msg.createdAt),
    failure: msg.failure,
  };
}

function actToRow(act: LeadNote, i: number): Row | null {
  // Text acts are replaced by the fetched thread — skip them here.
  if (act.type === "text") return null;

  const id = act.id ?? String(i);

  if (act.type === "call") {
    const dir = act.dir === "in" ? "Incoming" : "Outgoing";
    return {
      kind: "sys",
      id,
      text: `${dir} call · ${act.outcome ?? ""}${act.dur ? ` · ${act.dur}` : ""} · ${act.when}`,
    };
  }

  if (act.type === "visit" || act.type === "ai") {
    return { kind: "sys", id, text: `${act.t ?? ""} · ${act.when}` };
  }

  return null;
}

/** One timeline row — a system chip for calls/visits/ai, a bubble for texts. */
function ThreadRow({ row, lead }: { row: Row; lead: Lead }) {
  if (row.kind === "sys") {
    return <div className="tsys">{row.text}</div>;
  }

  const metaWho =
    row.from === "them"
      ? `${firstName(lead.name)} · `
      : row.from === "auto"
        ? ""
        : "You · ";

  return (
    <div className={`msg ${row.from}`}>
      <div className="bub">{row.text}</div>
      <div className="meta">
        {metaWho}
        {row.when}
      </div>
      {/* A text the carrier refused. Shown ON the message rather than as a toast, because the
          thread is where somebody looks days later wondering why a customer never replied — and
          before this existed a dropped text was indistinguishable from a delivered one. */}
      {row.failure ? (
        <div className="msg-failed" role="alert">
          <b>Not delivered.</b> {row.failure.says}
          {row.failure.fix ? <> {row.failure.fix}</> : null}
        </div>
      ) : null}
    </div>
  );
}

// ── Optimistic outbound row ───────────────────────────────────────────────────

interface OptimisticMsg {
  id: string;
  body: string;
}

// ── Error label ───────────────────────────────────────────────────────────────

function friendlyError(err: unknown): string {
  // Prefer structured tRPC code over message-string matching — codes are stable, messages are not.
  if (err instanceof TRPCClientError) {
    const code = err.data?.code as string | undefined;
    if (code === "PRECONDITION_FAILED") return "Texting isn't set up yet — no business number.";
    if (code === "BAD_REQUEST") return "This customer has no phone number on file.";
    if (code === "BAD_GATEWAY") return "Couldn't send — please try again.";
    return "Send failed — please try again.";
  }
  // Fallback for non-tRPC errors: match on message strings.
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("PRECONDITION_FAILED") || msg.toLowerCase().includes("not configured") || msg.toLowerCase().includes("twilio")) {
    return "Texting isn't set up yet — no business number.";
  }
  if (msg.includes("BAD_REQUEST") || msg.toLowerCase().includes("no phone")) {
    return "This customer has no phone number on file.";
  }
  if (msg.includes("BAD_GATEWAY")) {
    return "Couldn't send — please try again.";
  }
  return "Send failed — please try again.";
}

// ── Main modal ────────────────────────────────────────────────────────────────

export function ThreadModalContent() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const leadId = activeModal?.params?.leadId as string | undefined;
  const leads = useAppStore((s) => s.leads);
  const updateLead = useAppStore((s) => s.updateLead);
  const lead = leads.find((l) => l.id === leadId);

  const [draft, setDraft] = useState("");
  const [optimistic, setOptimistic] = useState<OptimisticMsg[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const utils = api.useUtils();

  // Fetch real thread from the backend.
  const { data: thread, isLoading } = api.v1.messaging.listByLead.useQuery(
    { leadId: leadId ?? "" },
    {
      enabled: Boolean(leadId),
      staleTime: 15_000,
      refetchOnWindowFocus: false,
    },
  );

  // Opening the thread clears the unread flag (prototype: l.unread=false).
  useEffect(() => {
    if (lead?.unread) updateLead(lead.id, { unread: false });
  }, [lead?.id, lead?.unread, updateLead]);

  // Keep the thread pinned to the newest message.
  const rowCount = (thread?.length ?? 0) + optimistic.length;
  useEffect(() => {
    const sc = scrollRef.current;
    if (sc) sc.scrollTop = sc.scrollHeight;
  }, [rowCount]);

  if (!lead) return null;

  // Build the combined row list: non-text acts (calls, visits, ai) + fetched SMS thread + optimistic rows.
  const sysRows: Row[] = (lead.acts ?? [])
    .map((act, i) => actToRow(act, i))
    .filter((r): r is Row => r !== null);

  const msgRows: Row[] = (thread ?? []).map(dtoToRow);

  const optimisticRows: Row[] = optimistic.map((o) => ({
    kind: "msg" as const,
    id: o.id,
    from: "us" as const,
    text: o.body,
    when: "Sending…",
  }));

  // Interleave: sys rows first (they carry a `when` string, not a Date, so we can't sort precisely),
  // then fetched messages (chronological from backend), then optimistic pending rows.
  const allRows: Row[] = [...sysRows, ...msgRows, ...optimisticRows];

  async function send() {
    if (!lead) return;
    // No number on file — the add-phone row above is the way in; don't optimistically
    // append a bubble that will fail server-side.
    if (!hasPhone(lead)) {
      setSendError("Add a phone number above to text them.");
      return;
    }
    const v = draft.trim();
    if (!v) return;
    setSendError(null);
    setDraft("");

    // Optimistic append.
    const tempId = `opt-${Date.now()}`;
    setOptimistic((prev) => [...prev, { id: tempId, body: v }]);

    try {
      await trpcVanilla.v1.messaging.send.mutate({ leadId: lead.id, body: v });
      // Success: drop the optimistic row and let the refetch carry the real message.
      setOptimistic((prev) => prev.filter((o) => o.id !== tempId));
      await utils.v1.messaging.listByLead.invalidate({ leadId: lead.id });
    } catch (err: unknown) {
      // Rollback optimistic row, restore the draft so the user can retry or edit, show inline error.
      setOptimistic((prev) => prev.filter((o) => o.id !== tempId));
      setDraft(v);
      setSendError(friendlyError(err));
    }
  }

  return (
    <div>
      <h2 style={{ marginBottom: "var(--space-2xs)" }}>{lead.name}</h2>
      {hasPhone(lead) ? (
        <div className="muted" style={{ fontSize: "var(--type-sm)" }}>
          {lead.phone} · texting from your <b>business number</b> — quote links and
          reminders land in this same thread, marked ✦
        </div>
      ) : (
        // No number on file — the modal becomes the add-a-phone prompt (big, legible). The
        // optimistic store write enables the composer immediately; unlike the call modal this
        // does NOT race its own save, because the send passes the fresh number forward rather
        // than having the server look it up.
        <PhoneAddInput
          label="No phone number yet"
          sub={`Add ${firstName(lead.name)}'s mobile and your text goes out from your business number.`}
          cta="Save & text"
          onSave={(phone) => updateLead(lead!.id, { phone })}
          onCancel={close}
        />
      )}

      <div className="thread" ref={scrollRef}>
        {isLoading ? (
          <div className="thread-empty">
            <div className="thread-empty-sub">Loading…</div>
          </div>
        ) : allRows.length > 0 ? (
          allRows.map((row) => <ThreadRow key={row.id} row={row} lead={lead} />)
        ) : (
          <div className="thread-empty">
            <div className="thread-empty-title">No messages yet</div>
            <div className="thread-empty-sub">Send a text to start the conversation.</div>
          </div>
        )}
      </div>

      {sendError && (
        <div className="muted" style={{ fontSize: "var(--type-sm)", color: "var(--red, #c0392b)", padding: "var(--space-1) 0" }}>
          {sendError}
        </div>
      )}

      <div className="composer">
        <input
          value={draft}
          placeholder={hasPhone(lead) ? `Text ${firstName(lead.name)}…` : "Add a number above to text"}
          disabled={!hasPhone(lead)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
        />
        <button className="btn primary" onClick={() => void send()} disabled={!hasPhone(lead)}>
          Send
        </button>
      </div>
    </div>
  );
}
