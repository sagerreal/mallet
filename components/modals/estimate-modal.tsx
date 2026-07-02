/**
 * components/modals/estimate-modal.tsx
 * Faithful port of openEst (prototype 7764-7801): quote detail with the line
 * table + pricing rollup, status stamp, expiry banner, the follow-up trail for
 * sent quotes, Send-quote for drafts, and an armed two-tap Delete.
 *
 * Deferred (need surfaces not built yet): "Preview as customer" (the customer
 * GBB page) and the signed-agreement / change-request banners (extended sample
 * states). The modal renders faithfully for the data the store carries today.
 */

"use client";

import { useState } from "react";
import { useAppStore, useActiveModal, useCloseModal, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { calcQuote } from "@/lib/prototype-sample";
import { STAGE_ORDER } from "@/features/pipeline/pipeline-constants";
import type { Estimate } from "@/lib/store/types";

function fmt$(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

const STATUS_STAMP: Record<string, { cls: string; label: string }> = {
  sent: { cls: "info", label: "Sent" },
  accepted: { cls: "good", label: "Accepted" },
  declined: { cls: "bad", label: "Declined" },
  draft: { cls: "ink", label: "Draft" },
};

function isExpired(e: Estimate): boolean {
  return e.status === "sent" && e.age > (e.validDays ?? 14);
}

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

  const [deleteArmed, setDeleteArmed] = useState(false);

  const estId = activeModal?.params?.estId as number | undefined;
  const e = estimates.find((x) => x.id === estId);
  if (!e) return null;
  const lead = leads.find((l) => l.id === e.leadId);
  const m = calcQuote(e.lines, e.pricing);
  const p = e.pricing ?? { disc: 0, dep: 0, tax: 0 };
  const stamp = STATUS_STAMP[e.status] ?? { cls: "ink", label: e.status };

  function sendDraft() {
    updateEstimate(e!.id, { status: "sent", age: 0 });
    if (lead) {
      const order: readonly string[] = STAGE_ORDER;
      if (order.indexOf(lead.stage) < order.indexOf("Quote Sent")) {
        moveLeadStage(lead.id, "Quote Sent");
      }
    }
    close();
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div>
          <div className="muted">{e.num}</div>
          <h2>{e.title}</h2>
          <div className="muted">
            {lead ? lead.name : ""} · {lead ? lead.phone : ""}
          </div>
        </div>
        <div>
          <span className={`stamp ${stamp.cls}`}>{stamp.label}</span>
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
            {e.lines.map((x, i) => (
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
              <td style={{ textAlign: "right", fontWeight: 800 }}>{fmt$(m.total)}</td>
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

      {e.status === "sent" && <FollowUpTrail e={e} />}

      {(e.status === "draft" || e.status === "sent") && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 12 }}>
          <button className="btn ghost" onClick={() => openModal(MODAL.CUST_QUOTE, { estId: e.id })}>
            Preview as customer
          </button>
          {e.status === "draft" && (
            <button className="btn primary" onClick={sendDraft}>
              Send quote
            </button>
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
