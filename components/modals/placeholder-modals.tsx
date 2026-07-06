/**
 * components/modals/placeholder-modals.tsx
 * Lightweight placeholder contents for the Composer + CleanUp modals.
 * These open correctly (real modal, not a no-op) — full internals come in later
 * slices. (The Visit booking modal is now real — see visit-modal.tsx.)
 */

"use client";

import { useCloseModal, useActiveModal, useAppStore } from "@/lib/store/app-store";

// ---- New quote composer modal ----------------------------------------------

export function ComposerModalContent() {
  const close = useCloseModal();
  return (
    <div>
      <h2 className="modal-title">New quote</h2>
      <div className="muted" style={{ marginTop: 12 }}>
        Quote composer coming in a later slice.
      </div>
      <button className="btn ghost" style={{ marginTop: 24 }} onClick={close}>
        Close
      </button>
    </div>
  );
}

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
