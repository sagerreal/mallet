/**
 * components/modals/estimate-modal.tsx
 * Faithful port of openEst (prototype 7764-7801): quote detail with the line
 * table + pricing rollup, status stamp, expiry banner, the follow-up trail for
 * sent quotes, Send-quote for drafts, and an armed two-tap Delete.
 *
 * The signed agreement now renders here (SignatureRecord) whenever the customer actually signed
 * — name, drawn mark, the sentence they agreed to, and the frozen snapshot of the quote as it
 * stood. An accepted quote with no signature shows nothing, which is the honest state for a
 * phone approval the office marked itself.
 *
 * Deferred (need surfaces not built yet): "Preview as customer" (the customer
 * GBB page) and the change-request banner.
 *
 * Send flow: draft quotes expand an inline send panel (channel toggle →
 * editable destination → confirm). Mirrors the composer's send semantics:
 * the status flip always persists; delivery failure surfaces inline without
 * rolling back the sent state.
 *
 * Sheet grammar (the lead-modal shape): sticky .sheet-head (title · status pill
 * · num · customer · tier line), a quiet "Preview as customer" secondary, the
 * line table + banners in the body, and a sticky .sheet-foot whose one filled
 * primary exists ONLY for drafts:
 *   draft, panel closed → "Send quote"          (opens the in-flow send panel)
 *   draft, panel open   → "Send by text/email"  (the terminal confirm)
 * Sent/accepted/declined quotes are record viewers with no single advance —
 * no foot is rendered, and Delete stays quiet and red, never promoted.
 */

"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAppStore, useActiveModal, useCloseModal, usePushModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { calcQuote } from "@/lib/prototype-sample";
import { STAGE_ORDER } from "@/features/pipeline/pipeline-constants";
import type { Estimate } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";
import { isExpired, gbbTierLine, effectiveEstLines } from "@/lib/estimates";
import { SoftPill, type PillTone } from "@/components/shared/stage-pill";
import { SignatureRecord } from "@/components/shared/signature-record";
import { Field } from "@/components/ui/input";
import { api } from "@/lib/trpc/client";
import { ModalLoading } from "./modal-loading";
import { Trail } from "./trail";
import { useSmsGate } from "@/features/a2p/use-sms-ready";
import { SmsNote } from "@/features/a2p/sms-blocked";


const STATUS_STAMP: Record<string, { cls: string; label: string }> = {
  sent: { cls: "info", label: "Sent" },
  accepted: { cls: "good", label: "Accepted" },
  declined: { cls: "bad", label: "Declined" },
  draft: { cls: "ink", label: "Draft" },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Sent-quote follow-up trail (prototype fuRows). */
function FollowUpTrail({ e }: { e: Estimate }) {
  return (
    <div className="card">
      <h3>Follow-up — running on its own</h3>
      <div className="trail">
        <div className="t">
          <span className="dot" />
          <span>
            Sent {e.age === 0 ? "today" : `${e.age} days ago`}{" "}
            {e.viewed ? "· " : ""}
            {e.viewed ? <b>viewed ✓</b> : ""}
          </span>
        </div>
        <div className="t">
          <span className={`dot ${e.fu.stage >= 1 ? "" : "pending"}`} />
          <span>
            Reminder 1{" "}
            {e.fu.stage >= 1 ? <b>sent automatically</b> : "scheduled (+3d)"}
          </span>
        </div>
        <div className="t">
          <span className={`dot ${e.fu.stage >= 2 ? "" : "pending"}`} />
          <span>
            Reminder 2{" "}
            {e.fu.stage >= 2 ? (
              <b>sent automatically → flagged: time to call</b>
            ) : (
              "scheduled (+6d)"
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

export function EstimateModalContent() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const router = useRouter();
  const pushModal = usePushModal();
  const estimates = useAppStore((s) => s.estimates);
  const leads = useAppStore((s) => s.leads);
  const jobs = useAppStore((s) => s.jobs);
  const updateEstimate = useAppStore((s) => s.updateEstimate);
  const deleteEstimate = useAppStore((s) => s.deleteEstimate);
  const moveLeadStage = useAppStore((s) => s.moveLeadStage);
  const updateLead = useAppStore((s) => s.updateLead);
  const adoptEstimate = useAppStore((s) => s.adoptEstimate);

  const [deleteArmed, setDeleteArmed] = useState(false);

  // --- Send panel state -------------------------------------------------------
  const [sendOpen, setSendOpen] = useState(false);
  const [sendChannel, setSendChannel] = useState<"text" | "email">("text");
  const [dest, setDest] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [destError, setDestError] = useState<string | null>(null);

  // Text-channel only: 10DLC governs SMS, never email.
  const smsGate = useSmsGate();
  const messagingSend = api.v1.messaging.send.useMutation();
  const notificationsSend = api.v1.notifications.send.useMutation();
  const textBlocked = sendChannel === "text" && !smsGate.ready;
  const clearChangeRequestMutation = api.v1.quoting.clearChangeRequest.useMutation();

  const estId = activeModal?.params?.estId as string | undefined;
  const e = estimates.find((x) => x.id === estId);

  // Full-record fetch: list hydration carries only headers (the summary DTO omits
  // lines/pricing), so without this a refreshed session opens every quote as an
  // empty table with a $0 total. Fetch once per open and adopt into the store.
  // retry:false — store-local drafts (never persisted) 404 here; that's expected.
  // Two reasons to fetch, and the second was missing. `needsFull` covers a store copy that is
  // header-only (lines are not hydrated, so a refreshed session opened every quote as an empty
  // table). `absent` covers the quote not being in the store AT ALL — estimates hydrate one page,
  // so a quote outside it opened as a blank sheet with no explanation.
  const absent = Boolean(estId) && !e;
  const needsFull = absent || (Boolean(e) && e!.lines.length === 0);
  const fullQuery = api.v1.quoting.get.useQuery(
    { estimateId: estId ?? "" },
    { enabled: Boolean(estId) && needsFull, staleTime: 30_000, retry: false, refetchOnWindowFocus: false },
  );
  useEffect(() => {
    if (fullQuery.data) adoptEstimate(fullQuery.data, e?.fu ?? { on: false, stage: 0 });
    // e?.fu intentionally not a dep — adopt fires once per fetched record; fu is
    // read from the store copy at that moment.
  }, [fullQuery.data]);

  const lead = leads.find((l) => l.id === e?.leadId);

  // Sync dest when the panel opens or channel changes. Lives ABOVE the early returns —
  // every hook must run on every render or React throws when the returns start firing.
  useEffect(() => {
    if (!sendOpen) return;
    const val =
      sendChannel === "text"
        ? lead?.phone && lead.phone !== "—"
          ? lead.phone
          : ""
        : (lead?.email ?? "");
    setDest(val);
    setDestError(null);
    setSendError(null);
  // lead?.id is the stable dep: re-run when panel opens/channel changes/customer changes.
  // lead.phone / lead.email are intentionally excluded to avoid spurious resets on every render.
  }, [sendOpen, sendChannel, lead?.id]);

  if (!e) {
    if (absent && fullQuery.isLoading) return <ModalLoading size="lg" />;
    if (absent && fullQuery.isError) {
      return <p className="muted">Couldn&apos;t load this quote. Close and try again.</p>;
    }
    return null;
  }

  // The HEADER-ONLY beat. List hydration carries no lines, so a quote opened from the ledger
  // rendered instantly as an empty table with a $0 total, then reflowed wholesale when the full
  // record landed — the "glitch" (Owen). The absent case above already showed the loading state;
  // the header-only case is the same wait and gets the same answer.
  if (needsFull && fullQuery.isLoading) return <ModalLoading size="lg" />;

  // L2: surface a non-not_found query error inline rather than silently leaving the table empty.
  if (fullQuery.isError && fullQuery.error?.data?.code !== "NOT_FOUND") {
    return (
      <>
        <div className="sheet-head">
          <h2>{e.title}</h2>
          <div className="sheet-meta">
            <span>{e.num}</span>
          </div>
        </div>
        <div className="card" style={{ marginTop: "var(--space-4)", color: "var(--ink-2)", fontSize: "var(--type-base)" }}>
          Couldn&apos;t load the quote details — close and reopen to retry.
        </div>
      </>
    );
  }

  // Tier-aware lines: a pre-accept GBB estimate shows the RECOMMENDED tier only
  // (effectiveEstLines) so the table and total match the pipeline card's figure —
  // never the sum of all three tiers. Single/resolved quotes pass through as-is.
  const wonJob = jobs.find((j) => j.sourceEstimateId === e.id && !j.archived);
  const displayLines = effectiveEstLines(e);
  const m = calcQuote(displayLines, e.pricing);
  const p = e.pricing ?? { disc: 0, dep: 0, tax: 0 };
  const stamp = STATUS_STAMP[e.status] ?? { cls: "ink", label: e.status };

  // Derive default channel: text if lead has a phone, else email.
  const defaultChannel: "text" | "email" =
    lead?.phone && lead.phone !== "—" ? "text" : "email";

  function openSendPanel() {
    setSendChannel(defaultChannel);
    setSendOpen(true);
    setDeleteArmed(false);
    setSendError(null);
    setDestError(null);
  }

  function closeSendPanel() {
    setSendOpen(false);
    setSendError(null);
    setDestError(null);
  }

  function commitDest() {
    const trimmed = dest.trim();
    if (!lead) return;
    // Persist the edited contact field so the fix carries forward.
    const current =
      sendChannel === "text"
        ? lead.phone && lead.phone !== "—"
          ? lead.phone
          : ""
        : (lead.email ?? "");
    if (trimmed !== current) {
      updateLead(lead.id, sendChannel === "text" ? { phone: trimmed } : { email: trimmed });
    }
  }

  function validateDest(): boolean {
    const trimmed = dest.trim();
    if (!trimmed) {
      setDestError(sendChannel === "text" ? "Enter a mobile number." : "Enter an email address.");
      return false;
    }
    if (sendChannel === "email" && !EMAIL_RE.test(trimmed)) {
      setDestError("Enter a valid email address.");
      return false;
    }
    setDestError(null);
    return true;
  }

  async function confirmSend() {
    // Defense in depth behind the blocked button: sending by text on a shop whose campaign isn't
    // active marks the estimate sent and then fails delivery, so the pipeline says the customer
    // was quoted and the customer heard nothing.
    if (textBlocked) return;
    if (!validateDest()) return;
    commitDest();

    setSendError(null);
    setIsSending(true);

    // e is guaranteed non-null: confirmSend is only reachable when sendOpen &&
    // e.status === "draft", both of which require e to exist (see render guard).
    const est = e!;

    // Step 1: flip status + persist (fire-and-forget via the slice; it reconciles the DTO).
    // This is unconditional — the quote IS sent even if delivery fails below.
    updateEstimate(est.id, { status: "sent", age: 0 });

    // Step 2: advance lead stage.
    if (lead) {
      const order: readonly string[] = STAGE_ORDER;
      if (order.indexOf(lead.stage) < order.indexOf("Quote Sent")) {
        moveLeadStage(lead.id, "Quote Sent");
      }
    }

    // Step 3: build the share link.
    if (!est.publicToken) {
      // Should not happen for DB-persisted estimates, but guard gracefully.
      setSendError("This quote predates share links — resend from the composer.");
      setIsSending(false);
      close();
      return;
    }

    // The link comes from the SERVER, not from window.location.origin.
    //
    // It used to be composed from wherever the shop happened to be when they pressed Send, which is
    // only correct by luck: a deployment/preview URL, a branch alias, a custom domain or a localhost
    // demo each yield a link the customer cannot open. It happened — a quote sent from a Vercel
    // deployment URL emailed a link behind Vercel's own login wall, fine on the sender's laptop and
    // a sign-in prompt on the customer's phone.
    const quoteLink = est.publicUrl;
    if (!quoteLink) {
      // Refuse rather than send a broken link: a quote nobody can open converts at zero, and a
      // silent fallback to the browser's origin is exactly the bug this replaced.
      setSendError("This app has no public address configured, so the customer link can't be built. Ask your admin to set it, then resend.");
      setIsSending(false);
      return;
    }
    const firstName = (lead?.name ?? "").split(" ")[0] ?? lead?.name ?? "";
    const body =
      `${firstName}, your quote ${est.num} is ready — view and approve here: ${quoteLink}`;

    try {
      if (sendChannel === "text") {
        // Pass the panel's destination explicitly — the server validates it and uses it
        // directly, so the send never races the (fire-and-forget) lead phone update.
        await messagingSend.mutateAsync({ leadId: est.leadId, body, to: dest.trim() });
      } else {
        await notificationsSend.mutateAsync({
          channel: "email",
          to: dest.trim(),
          kind: "estimate_sent",
          body,
          relatedType: "estimate",
          relatedId: est.id,
          idempotencyKey: `estimate-sent-${est.id}`,
        });
      }
      // Delivery succeeded — close.
      close();
    } catch (err: unknown) {
      // Delivery failed. The status flip already persisted — surface inline.
      // Do NOT roll back the sent status (mirror composer semantics).
      const code = (err as { data?: { code?: string } }).data?.code;
      if (code === "PRECONDITION_FAILED") {
        setSendError(
          sendChannel === "text"
            ? "Quote saved — but no business number is set up for texting yet. Share the link manually."
            : "Quote saved — email delivery isn't configured yet. Share the link manually.",
        );
      } else if (code === "BAD_REQUEST") {
        setSendError(
          sendChannel === "text"
            ? "Quote saved — that phone number doesn't look right. Fix it and resend."
            : "Quote saved — that email doesn't look right. Fix it and resend.",
        );
      } else if (code === "BAD_GATEWAY") {
        // The provider rejected the send (e.g. Resend refused the from-address/key).
        setSendError(
          sendChannel === "text"
            ? "Quote saved — the texting provider rejected the send. Check the Twilio setup."
            : "Quote saved — the email provider rejected the send. Check EMAIL_FROM and the Resend key.",
        );
      } else {
        setSendError("Quote saved — couldn't deliver. Check your connection.");
      }
      setIsSending(false);
    }
  }

  function confirmDelete() {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    deleteEstimate(e!.id);
    close();
  }

  return (
    <>
      {/* Sticky head — the quote's title, one calm meta line under it.
          The shell renders the ✕; .sheet-head's own padding clears it. */}
      <div className="sheet-head">
        <h2>{e.title}</h2>
        <div className="sheet-meta">
          <SoftPill tone={stamp.cls as PillTone}>{stamp.label}</SoftPill>
          <span>{e.num}</span>
          {/* customer > quote > job > invoice. The customer's name was DEAD TEXT here: it named who
              the quote was for and gave no way to reach them, the job it produced, or the bill. */}
          <Trail kind="quote" id={e.id} />
          {lead?.phone && lead.phone !== "—" ? <span>{lead.phone}</span> : null}
          {gbbTierLine(e) ? <span>{gbbTierLine(e)}</span> : null}
        </div>
      </div>

      {/* Quiet secondary — the customer-facing preview, a peer not the primary. */}
      {(e.status === "draft" || e.status === "sent") && (
        <div className="sheet-secrow">
          <button className="sheet-sec" onClick={() => pushModal(MODAL.CUST_QUOTE, { estId: e.id })}>
            Preview as customer
          </button>
        </div>
      )}

      <div className="card" style={{ marginTop: "var(--space-4)" }}>
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>Qty</th>
              <th>Rate</th>
              <th style={{ textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {displayLines.map((x, i) => (
              <tr key={i}>
                <td>{x.d}</td>
                <td>{x.q}</td>
                <td>{fmt$(x.r)}</td>
                <td style={{ textAlign: "right" }}>{fmt$(x.q * x.r)}</td>
              </tr>
            ))}
            {(p.disc || p.tax) ? (
              <tr>
                <td colSpan={3} style={{ textAlign: "right" }} className="muted">Subtotal</td>
                <td style={{ textAlign: "right" }}>{fmt$(m.sub)}</td>
              </tr>
            ) : null}
            {p.disc ? (
              <tr>
                <td colSpan={3} style={{ textAlign: "right" }} className="muted">Discount {p.disc}%</td>
                <td style={{ textAlign: "right", color: "var(--red)" }}>−{fmt$(m.disc)}</td>
              </tr>
            ) : null}
            {p.tax ? (
              <tr>
                <td colSpan={3} style={{ textAlign: "right" }} className="muted">Tax {p.tax}%</td>
                <td style={{ textAlign: "right" }}>+{fmt$(m.taxed)}</td>
              </tr>
            ) : null}
            <tr>
              <td colSpan={3} style={{ textAlign: "right", fontWeight: 800 }}>Total</td>
              {/* cachedTotal fallback: header-only estimates (lines still loading) show the
                  list total instead of a $0 flash. */}
              <td style={{ textAlign: "right", fontWeight: 800 }}>{fmt$(e.lines.length ? m.total : (e.cachedTotal ?? 0))}</td>
            </tr>
            {p.dep ? (
              <tr>
                <td colSpan={4} style={{ textAlign: "right", paddingTop: "var(--space-2)" }}>
                  {/* Asked for vs COLLECTED. The office could previously see only the ask, so a
                      deposit that had actually landed was invisible until the final invoice netted
                      it out — which is how deposit bugs stayed unnoticed. Once money is in, the
                      pill states that instead, and names any remainder still outstanding. */}
                  {e.depPaid ? (
                    <span className="pill green">
                      Deposit paid: {fmt$(e.depPaid)}
                      {e.depPaid < m.dep ? ` of ${fmt$(m.dep)}` : ""}
                    </span>
                  ) : (
                    <span className="pill green">
                      Deposit due on acceptance: {fmt$(m.dep)} ({p.dep}%)
                    </span>
                  )}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {isExpired(e) && (
        <div className="reqcard">
          ⌛ <b>Expired</b> — valid {e.validDays ?? 14}d, it&apos;s been {e.age}d.
        </div>
      )}

      {e.status === "sent" && e.changeRequestedAt && (
        <div className="reqcard" style={{ marginTop: "var(--space-3)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-2)" }}>
            <div>
              <span className="muted" style={{ fontSize: "var(--type-sm)", display: "block", marginBottom: "var(--space-1)" }}>Change requested</span>
              {e.changeRequest
                ? <span>&ldquo;{e.changeRequest}&rdquo;</span>
                : <span className="muted">Message loading…</span>
              }
            </div>
            <div style={{ display: "flex", gap: "var(--space-2)", flexShrink: 0 }}>
              {/* The answer to a change request: edit the quote and resend. Opens the
                  composer seeded with this quote; the original archives when the
                  revision actually sends. */}
              <button
                className="btn sm primary"
                onClick={() => {
                  close();
                  router.push(`/composer?revise=${e.id}`);
                }}
              >
                Edit &amp; resend
              </button>
              <button
                className="btn sm ghost"
                disabled={clearChangeRequestMutation.isPending}
                onClick={async () => {
                  try {
                    const updated = await clearChangeRequestMutation.mutateAsync({ estimateId: e.id });
                    adoptEstimate(updated, e.fu ?? { on: false, stage: 0 });
                  } catch {
                    // Surfaced on the button itself (isError → "Failed — retry"); no silent failure.
                  }
                }}
              >
                {clearChangeRequestMutation.isPending
                  ? "Clearing…"
                  : clearChangeRequestMutation.isError
                    ? "Failed — retry"
                    : "Mark handled"}
              </button>
            </div>
          </div>
        </div>
      )}
      {e.status === "sent" && <FollowUpTrail e={e} />}

      {/* The signed agreement. Renders ONLY when a signature actually exists — an accepted quote
          with no signature (the office marking a phone approval) correctly shows nothing here
          rather than an empty block implying evidence that was never captured. */}
      {e.signature && <SignatureRecord signature={e.signature} />}

      {/* Inline send panel — expands in-flow; the confirm lives in the foot. */}
      {e.status === "draft" && sendOpen && (
        <div
          style={{
            marginTop: "var(--space-3)",
            padding: "var(--space-4) var(--space-4)",
            border: "1.5px solid var(--line)",
            borderRadius: "var(--radius-sm)",
            background: "var(--card)",
          }}
        >
          {/* Channel toggle */}
          <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
            {(["text", "email"] as const).map((ch) => (
              <button
                key={ch}
                className={`btn sm ${sendChannel === ch ? "primary" : "ghost"}`}
                onClick={() => setSendChannel(ch)}
                disabled={isSending}
              >
                {ch === "text" ? "Text" : "Email"}
              </button>
            ))}
          </div>

          {/* Destination input — Field associates the label with the control. */}
          <Field
            label={sendChannel === "text" ? "Mobile number" : "Email address"}
            style={{ margin: 0 }}
          >
            <input
              type={sendChannel === "text" ? "tel" : "email"}
              value={dest}
              placeholder={sendChannel === "text" ? "(925) 555-0123" : "name@email.com"}
              onChange={(ev) => {
                setDest(ev.target.value);
                if (destError) setDestError(null);
              }}
              onBlur={commitDest}
              onKeyDown={(ev) => {
                if (ev.key === "Enter") {
                  ev.preventDefault();
                  commitDest();
                }
              }}
              disabled={isSending}
              style={{
                width: "100%",
                border: `1.5px solid ${destError ? "var(--red)" : "var(--line)"}`,
                borderRadius: "var(--radius-sm)",
                padding: "var(--space-2) var(--space-3)",
                fontFamily: "inherit",
                fontSize: "var(--type-base)",
                background: "var(--card)",
                color: "var(--ink)",
              }}
            />
          </Field>
          {destError && (
            <div style={{ marginTop: "var(--space-1)", fontSize: "var(--type-sm)", color: "var(--red)" }}>
              {destError}
            </div>
          )}

          {/* Why the text channel is blocked, if it is. Sits with the destination field rather
              than under the button: this is a fact about the shop, and it is true before anyone
              reaches for Send. */}
          {textBlocked && <SmsNote gate={smsGate} />}

          {/* Inline delivery error */}
          {sendError && (
            <div style={{ marginTop: "var(--space-2)", fontSize: "var(--type-base)", color: "var(--red)" }}>
              {sendError}
            </div>
          )}
        </div>
      )}

      {/* Delete — destructive, so quiet and red with the armed two-tap; never the primary. */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          marginTop: "var(--space-4)",
          borderTop: "1px solid var(--line)",
          paddingTop: "var(--space-3)",
          gap: "var(--space-2)",
        }}
      >
        {deleteArmed && (
          <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
            {e.status === "accepted"
              ? "This is a WON quote — trashing it removes the revenue from your numbers. "
              : "30 days in the trash, then gone. "}
          </span>
        )}
        <button
          className="btn sm ghost"
          style={{ color: "var(--red)", borderColor: deleteArmed ? "var(--red)" : undefined }}
          onClick={confirmDelete}
        >
          {deleteArmed ? "Yes, delete" : "Delete quote"}
        </button>
      </div>

      {/* Sticky foot — drafts only: the ONE advance action. A sent/accepted/
          declined quote is a record viewer with no terminal action, so no foot. */}
      {e.status === "draft" && (
        <div className="sheet-foot">
          {sendOpen ? (
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <button
                className="btn ghost"
                style={{ flex: 1, minHeight: 44 }}
                onClick={closeSendPanel}
                disabled={isSending}
              >
                Cancel
              </button>
              {/* The carrier gate applies to the TEXT channel only — email is unaffected by
                  10DLC, and a quote that can still go by email must not be blocked wholesale.
                  Blocked rather than disabled, so the control keeps its place and its focus. */}
              <button
                className="sheet-pri"
                style={{ flex: 2, width: "auto" }}
                aria-disabled={textBlocked ? true : undefined}
                onClick={(ev) => {
                  if (textBlocked) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    return;
                  }
                  void confirmSend();
                }}
                disabled={isSending}
              >
                {isSending
                  ? "Sending…"
                  : sendChannel === "text"
                  ? "Send by text"
                  : "Send by email"}
              </button>
            </div>
          ) : (
            // Edit sits BESIDE Send, not behind it. A draft is the one state where changing the
            // price is the obvious next thing, and it was the only state with no way to do it:
            // a SENT quote could be revised, a draft could only be sent as-is or deleted.
            // Opens the composer seeded with this quote — the same path Revise uses.
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <button
                className="btn ghost"
                style={{ flex: 1, minHeight: 44 }}
                onClick={() => {
                  close();
                  router.push(`/composer?revise=${e.id}`);
                }}
              >
                Edit
              </button>
              <button className="sheet-pri" style={{ flex: 2, width: "auto" }} onClick={openSendPanel}>
                Send quote
              </button>
            </div>
          )}
        </div>
      )}

      {/* A SENT quote's one advance action: revise it. Opens the composer seeded with
          this quote's lead/lines/pricing; the original archives only when the revision
          sends, so backing out changes nothing. (Accepted/declined stay record-only.) */}
      {e.status === "sent" && (
        <div className="sheet-foot">
          <button
            className="sheet-pri"
            onClick={() => {
              close();
              router.push(`/composer?revise=${e.id}`);
            }}
          >
            Edit &amp; resend
          </button>
        </div>
      )}

      {/* A WON quote's next move is the JOB it became (accept converts; job.sourceEstimateId is
          the link written by both sale directions). Pushed, not swapped — back returns to the
          quote. No job in the store gets no button: a primary that opens nothing is worse than
          the quiet read-back this modal already is. The terminal states had NO foot at all,
          which is what read as "just a viewing modal" (Owen). */}
      {e.status === "accepted" && wonJob && (
        <div className="sheet-foot">
          <button className="sheet-pri" onClick={() => pushModal(MODAL.JOB, { jobId: wonJob.id })}>
            Open the job &rarr;
          </button>
        </div>
      )}

      {/* A LOST quote's honest next move: another attempt. Same composer path Revise uses —
          the original stays live until the revision sends. */}
      {e.status === "declined" && (
        <div className="sheet-foot">
          <button
            className="sheet-pri"
            onClick={() => {
              close();
              router.push(`/composer?revise=${e.id}`);
            }}
          >
            Revise &amp; try again
          </button>
        </div>
      )}
    </>
  );
}
