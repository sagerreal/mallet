/**
 * components/modals/standards-modal.tsx
 * Checklist-templates manager (prototype openStandards / openChk).
 * Lists job "before you leave" + scope "visit" checklists; add a template,
 * add/remove items, toggle required, delete a template.
 */

"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import type { Checklist } from "@/lib/store/types";

function ChecklistCard({ chk }: { chk: Checklist }) {
  const addChecklistItem = useAppStore((s) => s.addChecklistItem);
  const deleteChecklistItem = useAppStore((s) => s.deleteChecklistItem);
  const toggleItemRequired = useAppStore((s) => s.toggleItemRequired);
  const deleteChecklist = useAppStore((s) => s.deleteChecklist);
  const [draft, setDraft] = useState("");

  function add() {
    const t = draft.trim();
    if (!t) return;
    addChecklistItem(chk.id, t, /photo|picture/i.test(t) ? "photo" : "check");
    setDraft("");
  }

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>{chk.name}</h3>
        <span
          className="linklike"
          style={{ color: "var(--red)", fontSize: 12 }}
          onClick={() => deleteChecklist(chk.id)}
        >
          Delete
        </span>
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>
        {chk.stage === "job" ? "Before-you-leave" : "Visit"} checklist · {chk.trade}
      </div>

      {chk.items.map((it) => (
        <div
          key={it.id}
          className="stage-row"
          style={{ gap: 8, padding: "6px 0" }}
        >
          <span style={{ color: it.required ? "var(--amber)" : "var(--ink-3)" }}>
            {it.type === "photo" ? "📷" : "○"}
          </span>
          <span style={{ flex: 1, fontSize: 13 }}>{it.text}</span>
          <span
            className={`chip${it.required ? " sel" : ""}`}
            style={{ fontSize: 11, cursor: "pointer" }}
            onClick={() => toggleItemRequired(chk.id, it.id)}
          >
            {it.required ? "Required" : "Optional"}
          </span>
          <span
            className="linklike"
            style={{ color: "var(--ink-3)", fontSize: 12 }}
            onClick={() => deleteChecklistItem(chk.id, it.id)}
          >
            ✕
          </span>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input
          type="text"
          placeholder="Add an item — “Photo of…” makes it a photo step"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn sm primary" onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}

export function StandardsModalContent() {
  const checklists = useAppStore((s) => s.checklists);
  const addChecklist = useAppStore((s) => s.addChecklist);
  const [newName, setNewName] = useState("");

  function create() {
    const n = newName.trim();
    if (!n) return;
    addChecklist(n, "job");
    setNewName("");
  }

  return (
    <div>
      <h2>Checklist templates</h2>
      <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
        Reusable “before you leave” checklists the office attaches to a job.
      </p>

      {checklists.map((chk) => (
        <ChecklistCard key={chk.id} chk={chk} />
      ))}

      <div className="card" style={{ borderStyle: "dashed" }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 13 }}>New checklist</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Name — e.g. Repipe walkthrough"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); create(); } }}
            style={{ flex: 1, minWidth: 180 }}
          />
          <button type="button" className="btn sm primary" onClick={create}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
