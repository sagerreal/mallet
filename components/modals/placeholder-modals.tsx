/**
 * components/modals/placeholder-modals.tsx
 * The Clean-up (mark Lost / Archive) modal. (New quote → the /composer route;
 * the Visit booking modal is real — see visit-modal.tsx.)
 */

"use client";

import { useCloseModal, useActiveModal, useAppStore } from "@/lib/store/app-store";

// ---- Clean-up (archive / mark lost) modal ----------------------------------

export function CleanUpModalContent() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const archiveLead = useAppStore((s) => s.archiveLead);
  const leads = useAppStore((s) => s.leads);
  const leadId = activeModal?.params?.leadId as number | undefined;
  const lead = leads.find((l) => l.id === leadId);

  function handleArchive() {
    if (leadId != null) archiveLead(leadId);
    close();
  }

  return (
    <div>
      <h2 className="modal-title">Clean up{lead ? ` · ${lead.name}` : ""}</h2>
      <p className="muted" style={{ marginTop: 8 }}>
        Mark as lost or archive this customer.
      </p>
      <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
        <button className="btn ghost bad" onClick={handleArchive}>
          Mark lost &amp; archive
        </button>
        <button className="btn ghost" onClick={close}>
          Cancel
        </button>
      </div>
    </div>
  );
}
