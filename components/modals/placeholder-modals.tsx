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
  const leadId = activeModal?.params?.leadId as string | undefined;
  const lead = leads.find((l) => l.id === leadId);

  function handleArchive() {
    if (lead == null) return; // guarded below — never a silent no-op
    archiveLead(lead.id);
    close();
  }

  return (
    <div>
      <h2 className="modal-title">Clean up{lead ? ` · ${lead.name}` : ""}</h2>
      <p className="muted" style={{ marginTop: 8 }}>
        {lead
          ? "Mark as lost or archive this customer."
          : "No customer selected — close and pick one to clean up."}
      </p>
      <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
        <button
          className="btn ghost bad"
          onClick={handleArchive}
          disabled={lead == null}
          style={lead == null ? { opacity: 0.45 } : undefined}
        >
          Mark lost &amp; archive
        </button>
        <button className="btn ghost" onClick={close}>
          Cancel
        </button>
      </div>
    </div>
  );
}
