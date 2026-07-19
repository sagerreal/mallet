/**
 * components/modals/estimate-modal.tsx
 * Faithful port of openEst (prototype 7764-7801): quote detail with the line
 * table + pricing rollup, status stamp, expiry banner, the follow-up trail for
 * sent quotes, Send-quote for drafts, and an armed two-tap Delete.
 *
 * Deferred (need surfaces not built yet): "Preview as customer" (the customer
 * GBB page) and the signed-agreement / change-request banners (extended sample
 * states). The modal renders faithfully for the data the store carries today.
 *
 * Send flow: draft quotes expand an inline send panel (channel toggle →
 * editable destination → confirm). Mirrors the composer's send semantics:
 * the status flip always persists; delivery failure surfaces inline without
 * rolling back the sent state.
 */

"use client";

import { useState, useEffect } from "react";
import { useAppStore, useActiveModal, useCloseModal, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { calcQuote } from "@/lib/prototype-sample";
import { STAGE_ORDER } from "@/features/pipeline/pipeline-constants";
import type { Estimate } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";
import { isExpired, gbbTierLine, effectiveEstLines } from "@/lib/estimates";
import { SoftPill, type PillTone } from "@/components/shared/stage-pill";
import { api } from "@/lib/trpc/client";


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
  const openModal = useOpenModal();
  const estimates = useAppStore((s) => s.estimates);
  const leads = useAppStore((s) => s.leads);
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

  const messagingSend = api.v1.messaging.send.useMutation();
  const notificationsSend = api.v1.notifications.send.useMutation();
  const clearChangeRequestMutation = api.v1.quoting.clearChangeRequest.useMutation();

  const estId = activeModal?.params?.estId as string | undefined;
  const e = estimates.find((x) => x.id === estId);

  // Full-record fetch: list hydration carries only headers (the summary DTO omits
  // lines/pricing), so without this a refreshed session opens every quote as an
  // empty table with a $0 total. Fetch once per open and adopt into the store.
  // retry:false — store-local drafts (never persisted) 404 here; that's expected.
  const needsFull = Boolean(e) && e!.lines.length === 0;
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

  if (!e) return null;

  // L2: surface a non-not_found query error inline rather than silently leaving the table empty.
  if (fullQuery.isError && fullQuery.error?.data?.code !== "NOT_FOUND") {
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
          <div>
            <div className="muted">{e.num}</div>
            <h2>{e.title}</h2>
          </div>
        </div>
        <div className="card" style={{ marginTop: 14, color: "var(--ink-2)", fontSize: 13 }}>
          Couldn&apos;t load the quote details — close and reopen to retry.
        </div>
      </div>
    );
  }

  // Tier-aware lines: a pre-accept GBB estimate shows the RECOMMENDED tier only
  // (effectiveEstLines) so the table and total match the pipeline card's figure —
  // never the sum of all three tiers. Single/resolved quotes pass through as-is.
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

    const appOrigin = typeof window !== "undefined" ? window.location.origin : "";
    const quoteLink = `${appOrigin}/q/${est.publicToken}`;
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
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, paddingRight: 34 }}>
        <div>
          <div className="muted">{e.num}</div>
          <h2>{e.title}</h2>
          <div className="muted">
            {lead ? lead.name : ""} · {lead ? lead.phone : ""}
          </div>
          {gbbTierLine(e) && <div className="muted">{gbbTierLine(e)}</div>}
        </div>
        <div>
          <SoftPill tone={stamp.cls as PillTone}>{stamp.label}</SoftPill>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
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
                <td colSpan={4} style={{ textAlign: "right", paddingTop: 8 }}>
                  <span className="pill green">
                    Deposit due on acceptance: {fmt$(m.dep)} ({p.dep}%)
                  </span>
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
        <div className="reqcard" style={{ marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div>
              <span className="muted" style={{ fontSize: 11.5, display: "block", marginBottom: 3 }}>Change requested</span>
              {e.changeRequest
                ? <span>&ldquo;{e.changeRequest}&rdquo;</span>
                : <span className="muted">Message loading…</span>
              }
            </div>
            <button
              className="btn sm ghost"
              style={{ flexShrink: 0 }}
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
      )}
      {e.status === "sent" && <FollowUpTrail e={e} />}

      {(e.status === "draft" || e.status === "sent") && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button className="btn ghost" onClick={() => openModal(MODAL.CUST_QUOTE, { estId: e.id })}>
              Preview as customer
            </button>
            {e.status === "draft" && !sendOpen && (
              <button className="btn primary" onClick={openSendPanel}>
                Send quote
              </button>
            )}
          </div>

          {/* Inline send panel — expands in-flow below the action row */}
          {e.status === "draft" && sendOpen && (
            <div
              style={{
                marginTop: 12,
                padding: "14px 16px",
                border: "1.5px solid var(--line)",
                borderRadius: "var(--radius-sm, 9px)",
                background: "var(--card)",
              }}
            >
              {/* Channel toggle */}
              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
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

              {/* Destination input */}
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "var(--ink-2)",
                    marginBottom: 3,
                  }}
                >
                  {sendChannel === "text" ? "Mobile number" : "Email address"}
                </label>
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
                  aria-label={sendChannel === "text" ? "Mobile number" : "Email address"}
                  style={{
                    width: "100%",
                    maxWidth: 280,
                    border: `1.5px solid ${destError ? "var(--red)" : "var(--line)"}`,
                    borderRadius: "var(--radius-sm, 9px)",
                    padding: "8px 11px",
                    fontFamily: "inherit",
                    fontSize: 13.5,
                    background: "var(--card)",
                    color: "var(--ink)",
                  }}
                />
                {destError && (
                  <div style={{ marginTop: 4, fontSize: 12, color: "var(--red)" }}>
                    {destError}
                  </div>
                )}
              </div>

              {/* Inline delivery error */}
              {sendError && (
                <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--red)" }}>
                  {sendError}
                </div>
              )}

              {/* Panel actions */}
              <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
                <button
                  className="btn sm ghost"
                  onClick={closeSendPanel}
                  disabled={isSending}
                >
                  Cancel
                </button>
                <button
                  className="btn sm primary"
                  onClick={confirmSend}
                  disabled={isSending}
                >
                  {isSending
                    ? "Sending…"
                    : sendChannel === "text"
                    ? "Send by text"
                    : "Send by email"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          alignItems: "center",
          marginTop: 14,
          borderTop: "1px solid var(--line)",
          paddingTop: 12,
          gap: 8,
        }}
      >
        {deleteArmed && (
          <span className="muted" style={{ fontSize: 12 }}>
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
    </div>
  );
}
