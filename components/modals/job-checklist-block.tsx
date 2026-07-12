/**
 * components/modals/job-checklist-block.tsx
 * The job modal's "Before you leave" checklist block (prototype jobChecklistBlock,
 * line 4859). Extracted from job-modal.tsx (file-size cap).
 *
 * Three states:
 *   attached — show the list (+ Remove)
 *   picking  — template rows + an IN-FLOW create form (no floating UI) +
 *              "Manage templates" → MODAL.STANDARDS (the single-modal host
 *              replaces the job modal — accepted trade-off)
 *   entry    — "+ Add a checklist"
 *
 * Attach PERSISTS: updateJob(job.id, { checklist }) rides v1.jobs.update into the
 * jobs.checklist jsonb column, so the crew's device sees the list after a refresh.
 * Crew ANSWERS (verify.ans) remain store-local — the Phase-5 known gap.
 */

"use client";

import { useState } from "react";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { Job } from "@/lib/store/types";

// Item-type heuristic shared with the standards modal: "Photo of…" → photo step.
const PHOTO_ITEM_RE = /photo|picture/i;

// ---- in-flow create form ----------------------------------------------------

interface CreateChecklistFormProps {
  job: Job;
  onDone: () => void;
}

/**
 * Name + item rows + "Create & attach". On submit the template is created in
 * the checklists slice (persisted via v1.checklists with client UUIDs), the
 * authored items are read back from the store, and the checklist is attached
 * to the job through updateJob — which persists via v1.jobs.update.
 */
function CreateChecklistForm({ job, onDone }: CreateChecklistFormProps) {
  const addChecklist = useAppStore((s) => s.addChecklist);
  const addChecklistItem = useAppStore((s) => s.addChecklistItem);
  const updateJob = useAppStore((s) => s.updateJob);
  const [name, setName] = useState("");
  const [items, setItems] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  function addItem() {
    const t = draft.trim();
    if (!t) return;
    setItems((prev) => [...prev, t]);
    setDraft("");
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function createAndAttach() {
    const n = name.trim();
    if (!n) {
      setError("Name the checklist.");
      return;
    }
    // A typed-but-not-added item row must not be silently dropped — fold it in.
    const rows = draft.trim() ? [...items, draft.trim()] : items;
    const { checklist } = addChecklist(n, "job");
    for (const text of rows) {
      addChecklistItem(checklist.id, text, PHOTO_ITEM_RE.test(text) ? "photo" : "check");
    }
    // Read the authored items back (addChecklistItem minted their ids/positions).
    const created = useAppStore
      .getState()
      .checklists.find((c) => c.id === checklist.id);
    updateJob(job.id, {
      checklist: { name: checklist.name, items: created?.items ?? [] },
    });
    onDone();
  }

  return (
    <div style={{ borderTop: "1px solid var(--line)", marginTop: 8, paddingTop: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>New checklist</div>
      <input
        type="text"
        placeholder="Name — e.g. Repipe close-out"
        maxLength={100}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          if (error) setError("");
        }}
        style={{ width: "100%" }}
      />
      {items.map((text, i) => (
        <div key={`${i}-${text}`} className="stage-row" style={{ gap: 8, padding: "4px 0" }}>
          <span style={{ color: "var(--ink-3)" }}>
            {PHOTO_ITEM_RE.test(text) ? "📷" : "○"}
          </span>
          <span style={{ flex: 1, fontSize: 13 }}>{text}</span>
          <span
            className="linklike"
            style={{ color: "var(--ink-3)", fontSize: 12 }}
            onClick={() => removeItem(i)}
          >
            ✕
          </span>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input
          type="text"
          placeholder="Add an item — “Photo of…” makes it a photo step"
          maxLength={200}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addItem();
            }
          }}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn sm" onClick={addItem}>
          Add
        </button>
      </div>
      {error && (
        <div style={{ color: "var(--red)", fontSize: 12, marginTop: 6 }}>{error}</div>
      )}
      <button
        type="button"
        className="btn sm primary"
        style={{ marginTop: 8 }}
        onClick={createAndAttach}
      >
        Create &amp; attach
      </button>
    </div>
  );
}

// ---- the block ---------------------------------------------------------------

export function JobChecklistBlock({ job }: { job: Job }) {
  const checklists = useAppStore((s) => s.checklists);
  const updateJob = useAppStore((s) => s.updateJob);
  const openModal = useOpenModal();
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const templates = checklists.filter((c) => c.stage === "job");

  // Already attached → show it (+ Remove; persists the detach as checklist: null).
  if (job.checklist) {
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h3 style={{ margin: 0, fontSize: 13 }}>Before you leave</h3>
          <span
            className="linklike"
            style={{ fontSize: 12 }}
            onClick={() => updateJob(job.id, { checklist: undefined })}
          >
            Remove
          </span>
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>{job.checklist.name}</div>
        {job.checklist.items.map((it) => (
          <div key={it.id} className="stage-row" style={{ gap: 8, padding: "4px 0" }}>
            <span style={{ color: it.required ? "var(--amber)" : "var(--ink-3)" }}>
              {it.type === "photo" ? "📷" : "○"}
            </span>
            <span style={{ flex: 1, fontSize: 13 }}>{it.text}</span>
            {it.required && <span className="muted" style={{ fontSize: 11 }}>required</span>}
          </div>
        ))}
      </div>
    );
  }

  // Picking a template (or creating one in-flow).
  if (picking) {
    const formOpen = creating || templates.length === 0;
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ margin: "0 0 6px", fontSize: 13 }}>Attach a checklist</h3>
        {templates.length ? (
          templates.map((c) => (
            <div
              key={c.id}
              className="stage-row clickable"
              style={{ cursor: "pointer" }}
              onClick={() => {
                updateJob(job.id, { checklist: { name: c.name, items: c.items } });
                setPicking(false);
              }}
            >
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{c.name}</span>
              <span className="muted" style={{ fontSize: 12 }}>{c.items.length} items</span>
            </div>
          ))
        ) : (
          <div className="muted" style={{ fontSize: 12 }}>
            No templates yet — create one below.
          </div>
        )}
        {formOpen ? (
          <CreateChecklistForm
            job={job}
            onDone={() => {
              setCreating(false);
              setPicking(false);
            }}
          />
        ) : (
          <div style={{ marginTop: 8 }}>
            <span
              className="linklike"
              style={{ fontSize: 12, fontWeight: 700 }}
              onClick={() => setCreating(true)}
            >
              + New checklist
            </span>
          </div>
        )}
        <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
          <span
            className="linklike"
            style={{ fontSize: 12 }}
            onClick={() => openModal(MODAL.STANDARDS)}
          >
            Manage templates
          </span>
          <span
            className="linklike"
            style={{ fontSize: 12 }}
            onClick={() => {
              setPicking(false);
              setCreating(false);
            }}
          >
            Cancel
          </span>
        </div>
      </div>
    );
  }

  // Entry point.
  return (
    <div style={{ marginTop: 16 }}>
      <span
        className="linklike"
        style={{ fontSize: 13, fontWeight: 700 }}
        onClick={() => setPicking(true)}
      >
        + Add a checklist
      </span>{" "}
      <span className="muted" style={{ fontSize: 11.5 }}>
        — the crew runs it before they leave (optional, per job)
      </span>
    </div>
  );
}
