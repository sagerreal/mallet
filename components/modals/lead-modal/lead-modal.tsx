/**
 * components/modals/lead-modal/lead-modal.tsx
 * Port of ovLead / openLead (§5.3).
 * Composes LeadHeader + LeadNotes + LeadStageBar.
 */

"use client";

import { Modal } from "../modal";
import { LeadHeader } from "./lead-header";
import { LeadNotes } from "./lead-notes";
import { LeadStageBar } from "./lead-stage-bar";
import { useCloseModal, useActiveModal, useAppStore } from "@/lib/store/app-store";

export function LeadModal({ open }: { open: boolean }) {
  const close = useCloseModal();
  const activeModal = useActiveModal();
  const leads = useAppStore((s) => s.leads);

  const leadId = activeModal?.params?.leadId as number | undefined;
  const lead = leads.find((l) => l.id === leadId);

  return (
    <Modal open={open} onClose={close}>
      {lead ? (
        <>
          <LeadHeader lead={lead} />
          <LeadNotes lead={lead} />
          <LeadStageBar lead={lead} />
        </>
      ) : (
        <p className="muted">Customer not found.</p>
      )}
    </Modal>
  );
}
