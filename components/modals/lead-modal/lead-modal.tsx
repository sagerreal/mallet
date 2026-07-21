/**
 * components/modals/lead-modal/lead-modal.tsx
 * Faithful port of prototype ovLead / openLead (lines 6137-6202).
 * Composes all 9 sections in exact prototype order.
 * NO "Move stage" bar — stage lives in the header pill only.
 */

"use client";

import { Modal } from "../modal";
import { LeadHeader } from "./lead-header";
import { LeadNotes } from "./lead-notes";
import { VisitCard } from "./visit-card";
import { TasksCard } from "./tasks-card";
import { MoreDetails } from "./more-details";
import { useCloseModal, useActiveModal, useAppStore } from "@/lib/store/app-store";
import { useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { Estimate } from "@/lib/store/types";
import { estTotal } from "@/lib/estimates";
import { SoftPill, type PillTone } from "@/components/shared/stage-pill";

function statusStamp(status: string): string {
  switch (status) {
    case "accepted": return "Signed";
    case "sent": return "Sent";
    case "draft": return "Draft";
    case "declined": return "Declined";
    default: return status;
  }
}

function statusStampCls(status: string): string {
  switch (status) {
    case "accepted": return "good";
    case "sent": return "info";
    case "draft": return "ink";
    case "declined": return "bad";
    default: return "ink";
  }
}

interface QuotesCardProps {
  estimates: Estimate[];
}

function QuotesCard({ estimates }: QuotesCardProps) {
  const openModal = useOpenModal();

  if (estimates.length === 0) return null;

  const title = estimates.length === 1 ? "Quote" : `${estimates.length} quotes`;

  return (
    <div className="card">
      <h3>{title}</h3>
      {estimates.map((e) => {
        const total = estTotal(e);
        const isSigned = e.status === "accepted";
        return (
          <div
            key={e.id}
            className="stage-row"
            style={{ cursor: "pointer" }}
            onClick={() => openModal(MODAL.EST, { estId: e.id })}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "var(--type-base)", fontWeight: 600 }}>
                {e.num} — {e.title}
              </div>
              <div className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-2xs)" }}>
                {isSigned
                  ? `Signed — $${total.toLocaleString()}`
                  : "Tap to open…"}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
              <span style={{ fontSize: "var(--type-base)", fontWeight: 700 }}>
                ${total.toLocaleString()}
              </span>
              <SoftPill tone={statusStampCls(e.status) as PillTone}>
                {statusStamp(e.status)}
              </SoftPill>
              <span style={{ color: "var(--ink-3)" }}>&#8594;</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function LeadModal({ open }: { open: boolean }) {
  const close = useCloseModal();
  const activeModal = useActiveModal();
  const leads = useAppStore((s) => s.leads);
  const estimates = useAppStore((s) => s.estimates);

  const leadId = activeModal?.params?.leadId as string | undefined;
  const lead = leads.find((l) => l.id === leadId);

  // Estimates for this lead
  const leadEstimates = lead
    ? estimates.filter((e) => e.leadId === lead.id)
    : [];

  return (
    <Modal open={open} onClose={close} wide>
      {lead ? (
        <>
          {/* 1. Header: avatar + editable name + pill row + action buttons */}
          <LeadHeader lead={lead} />

          {/* 3. Quotes card — only if lead has estimates */}
          <QuotesCard estimates={leadEstimates} />

          {/* 4. Visit card — only if lead has evisits */}
          <VisitCard lead={lead} />

          {/* 5. Notes timeline (request note from l.job + acts + composer) */}
          <LeadNotes lead={lead} />

          {/* 6. Tasks — add & track what needs to happen */}
          <TasksCard lead={lead} />

          {/* 8. More details reveal + 9. Footer */}
          <MoreDetails lead={lead} />
        </>
      ) : (
        <p className="muted">Customer not found.</p>
      )}
    </Modal>
  );
}
