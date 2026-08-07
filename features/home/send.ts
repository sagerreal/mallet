/**
 * features/home/send.ts
 * The ONE approved-send primitive. The Handoff's OK queue and the command bar's
 * Counter both commit an outbound text through here, so "what a Send does" can
 * never drift between surfaces: append the real note, advance the record's
 * follow-up state, and hand back an exact undo.
 */

import { useAppStore } from "@/lib/store/app-store";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { localToday } from "@/features/jobs/use-jobs-query";
import type { OkItem } from "./derive";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The server's own bounds for an idempotency key (messaging-router sendInput). */
const KEY_MIN = 8;
const KEY_MAX = 64;

/**
 * The dedupe key for an approved reminder: THE RECORD PLUS THE DAY.
 *
 * WHY NOT THE FOLLOW-UP STAGE. The obvious key is `<record>-fu<stage>`, and it is wrong here: a
 * queue item's estimate is a query-built STUB (`use-ok-queue.ts` casts `{id, num, cachedTotal,
 * lines}` to an Estimate) and `fu` is not a persisted column at all — so the stage read `0` on
 * every item forever. Every reminder about the same quote would have carried the SAME key for the
 * rest of that quote's life, and the second one would have deduped against the first: a "✓ sent"
 * over a text that was never sent. Silent, and exactly the failure the ledger exists to prevent.
 *
 * The day is the salt because the day is what actually distinguishes two honest reminders. What
 * this buys, in the three cases that matter:
 *   - double-click, same day     → same key → the server returns the prior row. One text.
 *   - retry after a FAILED send  → same key → a failed claim is reclaimable, so it really re-sends.
 *   - a nudge on a later day     → new key  → it goes out.
 *
 * The shop's OWN day (`localToday`, the browser's timezone) — never `toISOString()`, which is UTC
 * and would roll the key over mid-evening for a west-coast shop.
 */
export function okSendKey(item: OkItem): string {
  return `${item.key}-d${localToday().replaceAll("-", "")}`;
}

/**
 * A key the server will accept, or none. Out-of-bounds is not a send-blocking condition: without a
 * key the server mints its own (`msg-<id>`), so the text still goes — it just isn't deduped. The
 * alternative is a request rejected by input validation, which would roll back a real send.
 */
const usableKey = (key: string | undefined): string | undefined =>
  key && key.length >= KEY_MIN && key.length <= KEY_MAX ? key : undefined;

/**
 * The REAL outbound dispatch behind every approved Send. Until Jul 30 2026 the
 * primitive below only wrote a note into browser memory — "✓ sent" with no
 * message created anywhere (Owen: "if I click send here it doesnt actually
 * work"). This routes the body through v1.messaging.send — the same pipeline
 * the thread modal and estimate modal use — so the text persists to the thread
 * and goes out through Twilio. Rejects with the server's reason on failure so
 * surfaces can show it and roll the local note back.
 *
 * `idempotencyKey` is optional and every caller that HAS a record to key on should pass one (see
 * okSendKey). Callers without one — a free-typed nudge at a lead with no queue item behind it —
 * keep the un-keyed path.
 */
export function dispatchOkSend(leadId: string, body: string, idempotencyKey?: string): Promise<void> {
  // Store-local leads (non-uuid ids, never persisted) have no thread to send
  // through — the local note is all there is. Skip the wire, succeed locally.
  if (!UUID_RE.test(leadId)) return Promise.resolve();
  return trpcVanilla.v1.messaging.send
    .mutate({ leadId, body, idempotencyKey: usableKey(idempotencyKey) })
    .then(() => undefined);
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
 *
 * THE FOLLOW-UP BUMP IS CONDITIONAL, and that is not defensive padding: a queue item's estimate
 * is a stub built from `quoting.followUps` and carries no `fu` at all, so `item.estimate.fu.stage`
 * threw a TypeError on every real quote reminder — before the text was ever dispatched. Where
 * there is no follow-up state there is nothing to advance and nothing to undo; the NOTE is the
 * commit, and it still happens. An invented `{on:true,stage:0}` "previous" value would be worse
 * than skipping: undo would write state the record never had.
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
  if (item.kind === "quote-viewed" && item.estimate?.fu) {
    const prevFu = item.estimate.fu;
    const estId = item.estimate.id;
    s.updateEstimate(estId, { fu: { on: true, stage: prevFu.stage + 1 } });
    revertKind = () => useAppStore.getState().updateEstimate(estId, { fu: prevFu });
  } else if (item.kind === "invoice-overdue" && item.invoice?.fu) {
    const prevFu = item.invoice.fu;
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
