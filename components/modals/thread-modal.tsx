/**
 * components/modals/thread-modal.tsx
 * Faithful port of the prototype's openThread / threadRows / sendText / simReply
 * (lines 6492-6536). SMS thread with the business-number framing, bubble rows,
 * a composer, and real two-way SMS via v1.messaging.
 *
 * Sheet grammar (frame only): the customer name + business-number line live in a
 * sticky .sheet-head so the record never scrolls away. There is NO .sheet-foot —
 * the chat composer at the bottom already IS the footer, and promoting Send to a
 * .sheet-pri would duplicate it.
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
import { userMessage } from "@/lib/trpc/error-map";
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
  /** Who sent an outbound message as the business — see MessageDTO.senderName. */
  senderName?: string | null;
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
    // The whole org texts as ONE business number; the name is how anyone tells who spoke.
    senderName: msg.senderName,
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
function ThreadRow({ row, custName }: { row: Row; custName: string }) {
  if (row.kind === "sys") {
    return <div className="tsys">{row.text}</div>;
  }

  // Outbound: the staffer who sent it ("Dana · 2:14 PM"). Absent attribution (system sends,
  // rows from before the column existed) shows just the time — never a guessed "You".
  const metaWho =
    row.from === "them"
      ? `${firstName(custName)} · `
      : row.kind === "msg" && row.senderName
        ? `${row.senderName} · `
        : "";

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
    // PRECONDITION_FAILED covers THREE unrelated blockers on this one endpoint: no business
    // number, 10DLC not approved, and texting not set up on the server. Collapsing them into one
    // sentence sent somebody hunting a business number that was configured all along, so the
    // server's own wording wins here — it is the only thing that names the real cause.
    if (code === "PRECONDITION_FAILED") {
      return userMessage(err, "Texting isn't set up yet.");
    }
    if (code === "BAD_REQUEST") return "This customer has no phone number on file.";
    if (code === "BAD_GATEWAY") return "Couldn't send — please try again.";
    return "Send failed — please try again.";
  }
  // Fallback for non-tRPC errors: match on message strings.
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("PRECONDITION_FAILED") || msg.toLowerCase().includes("not configured") || msg.toLowerCase().includes("twilio")) {
    return "Texting isn't set up yet.";
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

/**
 * The customer conversation itself, independent of how it is presented.
 *
 * Two surfaces render it: the Messages page shows it in its right pane (no overlay at all), and
 * the drill-in modal shows it when you tap Text from a job or customer sheet. Splitting the body
 * from the params-reader is what lets one conversation live in both without a second copy.
 */
export interface CustomerThreadPaneProps {
  readonly leadId: string | undefined;
  /** Passed by field openers, whose store has no leads to look a name/phone up in. */
  readonly paramName?: string;
  readonly paramPhone?: string;
  readonly onClose: () => void;
}

export function CustomerThreadPane({
  leadId,
  paramName,
  paramPhone,
  onClose: close,
}: CustomerThreadPaneProps) {
  const leads = useAppStore((s) => s.leads);
  const updateLead = useAppStore((s) => s.updateLead);
  const clearLeadUnreadLocal = useAppStore((s) => s.clearLeadUnreadLocal);
  const lead = leads.find((l) => l.id === leadId);
  const custName = lead?.name ?? paramName ?? "Customer";
  const phoneOnFile = lead ? (hasPhone(lead) ? lead.phone : null) : ((paramPhone ?? "").trim() || null);

  const [draft, setDraft] = useState("");
  const [optimistic, setOptimistic] = useState<OptimisticMsg[]>([]);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const utils = api.useUtils();

  // Fetch real thread from the backend.
  //
  // An open thread has to keep asking. There is no realtime channel for messages, so with
  // refetchOnWindowFocus off and no interval this modal was a snapshot taken the moment it opened:
  // a customer could reply and the reply would never appear while you sat looking at the
  // conversation. Tabbing away to a phone and back is the single most likely moment a new message
  // exists, and that was the one event explicitly turned off.
  //
  // Polling only while the modal is open, matching the repo's existing precedent
  // (features/field/hooks.ts) — one request per open thread, and none once it closes.
  const { data: thread, isLoading } = api.v1.messaging.listByLead.useQuery(
    { leadId: leadId ?? "" },
    {
      enabled: Boolean(leadId),
      staleTime: 5_000,
      refetchOnWindowFocus: true,
      refetchInterval: leadId ? 10_000 : false,
    },
  );

  // Opening the thread clears the unread flag — shared org state, cleared through the
  // messaging endpoint so techs (who cannot edit leads) clear it the same way the office does.
  // Local store first so the Customers-list dot dies instantly; server is idempotent.
  useEffect(() => {
    if (!leadId) return;
    clearLeadUnreadLocal(leadId);
    trpcVanilla.v1.messaging.markThreadRead
      .mutate({ leadId })
      .then(() => utils.v1.messaging.listConversations.invalidate())
      .catch((err: unknown) => {
        if (process.env.NODE_ENV !== "production") console.error("[markThreadRead]", err);
      });
    // utils is a stable ref from api.useUtils(); leadId is the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, clearLeadUnreadLocal]);

  // Keep the thread pinned to the newest message.
  const rowCount = (thread?.length ?? 0) + optimistic.length;
  useEffect(() => {
    const sc = scrollRef.current;
    if (sc) sc.scrollTop = sc.scrollHeight;
  }, [rowCount]);

  if (!leadId) return null;

  // Build the combined row list: non-text acts (calls, visits, ai) + fetched SMS thread + optimistic rows.
  // A field viewer has no store lead, so no system chips — the SMS thread itself is complete.
  const sysRows: Row[] = (lead?.acts ?? [])
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
    if (!leadId) return;
    // No number on file — the add-phone row above is the way in; don't optimistically
    // append a bubble that will fail server-side.
    if (!phoneOnFile) {
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
      await trpcVanilla.v1.messaging.send.mutate({ leadId, body: v });
      // Success: drop the optimistic row and let the refetch carry the real message.
      setOptimistic((prev) => prev.filter((o) => o.id !== tempId));
      await utils.v1.messaging.listByLead.invalidate({ leadId });
    } catch (err: unknown) {
      // Rollback optimistic row, restore the draft so the user can retry or edit, show inline error.
      setOptimistic((prev) => prev.filter((o) => o.id !== tempId));
      setDraft(v);
      setSendError(friendlyError(err));
    }
  }

  return (
    <>
      <div className="sheet-head">
        <h2>{custName}</h2>
        <div className="sheet-meta">
          {/* The meta line is the state: the number + transport, or the fact there's no number. */}
          <span>
            {phoneOnFile ? (
              <>
                {phoneOnFile} · texting from your <b>business number</b> — quote links and
                reminders land in this same thread, marked ✦
              </>
            ) : (
              "No phone number yet"
            )}
          </span>
        </div>
      </div>

      {!phoneOnFile ? (
        // No number on file — the WHOLE sheet is the add-a-phone ask, in the standard grammar
        // (labeled field + [Cancel][Save & text] foot). The thread panel and composer do not
        // render here: an empty thread under the ask says nothing, and a disabled composer
        // with a dead Send is exactly the dead-control shape the house bans. The optimistic
        // store write flips hasPhone the moment the number saves, and the thread takes over.
        lead ? (
          <PhoneAddInput
            label="Mobile number"
            sub="Texts go out from your business number."
            cta="Save & text"
            onSave={(phone) => updateLead(lead.id, { phone })}
            onCancel={close}
          />
        ) : (
          // Field viewer with no number on file: techs cannot edit the customer record, so the
          // honest state is the ask routed to someone who can — never a dead save button.
          <div className="empty-att">No phone number on file — ask the office to add one.</div>
        )
      ) : (
        <>
          <div className="thread" ref={scrollRef}>
            {isLoading ? (
              <div className="thread-empty">
                <div className="thread-empty-sub">Loading…</div>
              </div>
            ) : allRows.length > 0 ? (
              allRows.map((row) => <ThreadRow key={row.id} row={row} custName={custName} />)
            ) : (
              <div className="thread-empty">
                <div className="thread-empty-title">No messages yet</div>
                <div className="thread-empty-sub">Send a text to start the conversation.</div>
              </div>
            )}
          </div>

          {sendError && (
            <div className="muted" style={{ fontSize: "var(--type-sm)", color: "var(--red)", padding: "var(--space-1) 0" }}>
              {sendError}
            </div>
          )}

          <div className="composer">
            <input
              value={draft}
              placeholder={`Text ${firstName(custName)}…`}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void send();
              }}
            />
            <button className="btn primary" onClick={() => void send()}>
              Send
            </button>
          </div>
        </>
      )}
    </>
  );
}

/**
 * The drill-in presentation: reads the modal params and renders the pane. Kept so every existing
 * opener (job sheet, customer sheet, tech job sheet, command bar) is untouched.
 */
export function ThreadModalContent() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  return (
    <CustomerThreadPane
      leadId={activeModal?.params?.leadId as string | undefined}
      paramName={activeModal?.params?.leadName as string | undefined}
      paramPhone={activeModal?.params?.phone as string | undefined}
      onClose={close}
    />
  );
}
