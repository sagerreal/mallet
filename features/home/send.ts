/**
 * features/home/send.ts
 * The ONE approved-send primitive. The Handoff's OK queue and the command bar's
 * Counter both commit an outbound text through here, so "what a Send does" can
 * never drift between surfaces: append the real note, advance the record's
 * follow-up state, and hand back an exact undo.
 */

import { useAppStore } from "@/lib/store/app-store";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import type { OkItem } from "./derive";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The REAL outbound dispatch behind every approved Send. Until Jul 30 2026 the
 * primitive below only wrote a note into browser memory — "✓ sent" with no
 * message created anywhere (Owen: "if I click send here it doesnt actually
 * work"). This routes the body through v1.messaging.send — the same pipeline
 * the thread modal and estimate modal use — so the text persists to the thread
 * and goes out through Twilio. Rejects with the server's reason on failure so
 * surfaces can show it and roll the local note back.
 */
export function dispatchOkSend(leadId: string, body: string): Promise<void> {
  // Store-local leads (non-uuid ids, never persisted) have no thread to send
  // through — the local note is all there is. Skip the wire, succeed locally.
  if (!UUID_RE.test(leadId)) return Promise.resolve();
  return trpcVanilla.v1.messaging.send.mutate({ leadId, body }).then(() => undefined);
}

/** "8:47pm" — matches the ledger's act-timestamp format exactly. One voice. */
export function clockNow(): string {
  return new Date()
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .toLowerCase()
    .replace(" ", "");
}

/**
 * Commit an approved outbound text for a queue item — the note plus the
 * kind-specific record advance (fu bump / unread clear / stage move).
 * Does NOT touch dismissal: callers own when the item leaves their surface.
 * Returns the exact inverse.
 */
export function commitOkSend(item: OkItem, text: string): () => void {
  const s = useAppStore.getState();
  const note = s.addLeadNote(item.lead.id, {
    type: "text",
    from: "auto",
    when: "Just now",
    t: text,
  });

  let revertKind: () => void = () => {};
  if (item.kind === "quote-viewed" && item.estimate) {
    const prevFu = item.estimate.fu;
    const estId = item.estimate.id;
    s.updateEstimate(estId, { fu: { on: true, stage: prevFu.stage + 1 } });
    revertKind = () => useAppStore.getState().updateEstimate(estId, { fu: prevFu });
  } else if (item.kind === "invoice-overdue" && item.invoice) {
    const prevFu = item.invoice.fu ?? { on: true, stage: 0 };
    const invId = item.invoice.id;
    s.updateInvoice(invId, { fu: { on: true, stage: prevFu.stage + 1 } });
    revertKind = () => useAppStore.getState().updateInvoice(invId, { fu: prevFu });
  } else if (item.kind === "reply") {
    const leadId = item.lead.id;
    s.updateLead(leadId, { unread: false });
    revertKind = () => useAppStore.getState().updateLead(leadId, { unread: true });
  } else if (item.kind === "new-lead") {
    const leadId = item.lead.id;
    s.moveLeadStage(leadId, "Contacted");
    revertKind = () => useAppStore.getState().moveLeadStage(leadId, "New customer");
  }

  const leadId = item.lead.id;
  const noteId = note.id ?? "";
  return () => {
    useAppStore.getState().removeLeadNote(leadId, noteId);
    revertKind();
  };
}
