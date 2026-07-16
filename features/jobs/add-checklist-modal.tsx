"use client";

// "Add checklist" modal for Jobs → Checklists. Collects a name and calls back
// so the panel can optimistically append and expand the new row.

import { useState } from "react";
import { Modal } from "@/components/modals/modal";

const COMPACT_INPUT: React.CSSProperties = { fontSize: 13.5, padding: "8px 10px", borderRadius: 8 };

export function AddChecklistModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (name: string) => void;
}) {
  const [name, setName] = useState("");

  function reset() {
    setName("");
  }

  function handleAdd() {
    if (!name.trim()) return;
    onAdd(name.trim());
    reset();
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
        />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
        <button className="btn ghost" onClick={handleClose}>Cancel</button>
        <button className="btn primary" disabled={!name.trim()} onClick={handleAdd}>
          Add checklist
        </button>
      </div>
    </Modal>
  );
}
