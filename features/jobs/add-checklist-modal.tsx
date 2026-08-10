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
import { COMPACT_INPUT, Field } from "@/components/ui/input";

type DraftItem = { text: string; type: "check" | "photo" };
type ChecklistStage = "job" | "scope";

export function AddChecklistModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (name: string, stage: ChecklistStage, items?: DraftItem[]) => void;
}) {
  const [name, setName] = useState("");
  // WHEN the checklist runs. "job" is before-you-leave on real work; "scope" runs on an estimate
  // walkthrough — the office's way of making a tech scope a particular way (the domain carried
  // this stage from day one; this control is the first thing to offer it).
  const [stage, setStage] = useState<ChecklistStage>("job");
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setStage("job");
    setDrafting(false);
    setError(null);
  }

  function handleAdd() {
    if (!name.trim()) return;
    onAdd(name.trim(), stage);
    reset();
  }

  async function handleDraft() {
    const jobType = name.trim();
    if (!jobType || drafting) return;
    setDrafting(true);
    setError(null);
    try {
      const { items } = await trpcVanilla.v1.ai.draftChecklist.mutate({ jobType });
      onAdd(jobType, stage, items);
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
      <h3 style={{ margin: "0 0 var(--space-4)", fontSize: "var(--type-lg)", fontWeight: 800, letterSpacing: "-.01em" }}>
        New checklist
      </h3>

      <StagePicker stage={stage} onStage={setStage} disabled={drafting} />

      <Field label="Checklist name">
        <input
          type="text"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          placeholder={stage === "job" ? "e.g. Water heater replacement" : "e.g. Repipe walkthrough"}
          style={COMPACT_INPUT}
          disabled={drafting}
        />
      </Field>

      {error && (
        <p style={{ color: "var(--red)", fontSize: "var(--type-base)", margin: "var(--space-2) 0 0" }} role="alert">{error}</p>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)", marginTop: "var(--space-5)" }}>
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

/** WHEN the checklist runs — the two stages the domain has carried since day one. */
function StagePicker({
  stage,
  onStage,
  disabled,
}: {
  stage: ChecklistStage;
  onStage: (s: ChecklistStage) => void;
  disabled: boolean;
}) {
  return (
    <Field label="Runs on">
      <div className="chips" style={{ marginBottom: 0 }}>
        <button
          type="button"
          className={`chip ${stage === "job" ? "sel" : ""}`}
          onClick={() => onStage("job")}
          disabled={disabled}
        >
          Job — before you leave
        </button>
        <button
          type="button"
          className={`chip ${stage === "scope" ? "sel" : ""}`}
          onClick={() => onStage("scope")}
          disabled={disabled}
        >
          Estimate — scoping visit
        </button>
      </div>
    </Field>
  );
}
