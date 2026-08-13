/**
 * components/modals/placeholder-modals.tsx
 * The Clean-up (mark Lost / Archive) modal. (New quote → the /composer route;
 *)
 *
 * Sheet grammar (PR #253): sticky .sheet-head with the h2, and the terminal
 * confirm — "Mark lost & archive" — docked as the one .sheet-pri in a sticky
 * .sheet-foot. This is a confirm sheet, so the confirm IS the primary; archive
 * is recoverable (archiveLead, not a hard delete), so it is not destructive in
 * the Delete/Void sense. Cancel stays quiet beside it.
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
      <div className="sheet-head">
        <h2>Clean up{lead ? ` · ${lead.name}` : ""}</h2>
      </div>
      <p className="muted" style={{ marginTop: "var(--space-2)" }}>
        {lead
          ? "Mark as lost or archive this customer."
          : "No customer selected — close and pick one to clean up."}
      </p>
      {/* Two-button foot (#362): `.sheet-pri` is width:100% at the class level,
          so beside Cancel it takes flex:1 / width:auto and Cancel keeps its
          intrinsic width — otherwise the flex line is over-constrained and the
          primary crushes into Cancel. */}
      <div className="sheet-foot" style={{ display: "flex", gap: "var(--space-3)" }}>
        <button
          className="sheet-pri"
          onClick={handleArchive}
          disabled={lead == null}
          style={{ flex: 1, width: "auto", ...(lead == null ? { opacity: 0.45 } : null) }}
        >
          Mark lost &amp; archive
        </button>
        <button className="btn ghost" onClick={close} style={{ flexShrink: 0, minHeight: 44 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
