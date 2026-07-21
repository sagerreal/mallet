"use client";

// "Add checklist" modal for Jobs → Checklists. Collects a name and calls back
// so the panel can optimistically append and expand the new row. "Draft with AI"
// (1A.4) uses the name as the job type, asks the model for before-you-leave steps,
// and opens the new row PRE-FILLED with them — suggestions the owner edits + saves
// through the normal editor (nothing is published automatically).

import { useState } from "react";
import { Modal } from "@/components/modals/modal";
import { trpcVanilla } from "@/lib/trpc/vanilla";
import { userMessage } from "@/lib/trpc/error-map";

const COMPACT_INPUT: React.CSSProperties = { fontSize: 13.5, padding: "8px 10px", borderRadius: 8 };

type DraftItem = { text: string; type: "check" | "photo" };

export function AddChecklistModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (name: string, items?: DraftItem[]) => void;
}) {
  const [name, setName] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setDrafting(false);
    setError(null);
  }

  function handleAdd() {
    if (!name.trim()) return;
    onAdd(name.trim());
    reset();
  }

  async function handleDraft() {
    const jobType = name.trim();
    if (!jobType || drafting) return;
    setDrafting(true);
    setError(null);
    try {
      const { items } = await trpcVanilla.v1.ai.draftChecklist.mutate({ jobType });
      onAdd(jobType, items);
      reset();
    } catch (err) {
      setError(userMessage(err));
      setDrafting(false);
    }
  }

  function handleClose() {
    reset();
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} maxWidth={480}>
      <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 800, letterSpacing: "-.01em" }}>
        New checklist
      </h3>

      <div className="field">
        <label>Checklist name</label>
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          placeholder="e.g. Water heater replacement"
          style={COMPACT_INPUT}
          disabled={drafting}
        />
      </div>

      {error && (
        <p style={{ color: "var(--red)", fontSize: 12.5, margin: "8px 0 0" }} role="alert">{error}</p>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)", marginTop: 18 }}>
        {/* Draft with AI: the name is the job type; drafted steps land in the editor to edit + save. */}
        <button className="btn ghost" onClick={handleDraft} disabled={!name.trim() || drafting}>
          {drafting ? "Drafting…" : "Draft with AI"}
        </button>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <button className="btn ghost" onClick={handleClose} disabled={drafting}>Cancel</button>
          <button className="btn primary" disabled={!name.trim() || drafting} onClick={handleAdd}>
            Add checklist
          </button>
        </div>
      </div>
    </Modal>
  );
}
