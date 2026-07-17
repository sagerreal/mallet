"use client";

import { useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import { ChecklistEditorCard } from "./checklist-editor-card";
import { AddChecklistModal } from "./add-checklist-modal";
import { StarterChecklistsModal } from "./starter-checklists-modal";

export function ChecklistsPanel() {
  const checklists = useAppStore((s) => s.checklists);
  const addChecklist = useAppStore((s) => s.addChecklist);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [starterOpen, setStarterOpen] = useState(false);

  // AI-draft (1A.4) passes proposed items; a plain add passes none. Either way the
  // new row is created and expanded so the owner edits/saves through the normal path
  // (drafted items are suggestions, never auto-published).
  function handleAdd(name: string, items: Array<{ text: string; type: "check" | "photo" }> = []) {
    const { checklist } = addChecklist(name, "job", items);
    setExpandedId(checklist.id);
    setAddOpen(false);
  }

  function handleSeedTrade(
    _tradeKey: string,
    items: Array<{ name: string; items: Array<{ text: string; type: "check" | "photo" }> }>,
  ) {
    // Batch add, dedupe by name
    const existingNames = new Set(checklists.map((c) => c.name));
    items.forEach(({ name, items: itms }) => {
      if (!existingNames.has(name)) {
        addChecklist(name, "job", itms);
        existingNames.add(name);
      }
    });
    setStarterOpen(false);
  }

  function handleToggle(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  const existingNames = new Set(checklists.map((c) => c.name));

  return (
    <div style={{ padding: "20px 24px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: "-.02em" }}>Checklists</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn ghost" onClick={() => setStarterOpen(true)}>Starter checklists</button>
          <button className="btn primary" onClick={() => setAddOpen(true)}>+ New checklist</button>
        </div>
      </div>

      {/* Empty state */}
      {checklists.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "var(--ink-2)" }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>No checklists yet</div>
          <div style={{ fontSize: 13, marginBottom: 20, color: "var(--ink-3)" }}>Pick your trade to load starter checklists</div>
          <button className="btn primary" onClick={() => setStarterOpen(true)}>Choose trade</button>
        </div>
      ) : (
        /* List — bordered card with rows */
        <div style={{ border: "1px solid var(--line-2, var(--line))", borderRadius: 8, overflow: "hidden" }}>
          {checklists.map((cl, i) => (
            <ChecklistEditorCard
              key={cl.id}
              checklist={cl}
              isExpanded={expandedId === cl.id}
              onToggle={() => handleToggle(cl.id)}
              isLast={i === checklists.length - 1}
            />
          ))}
        </div>
      )}

      <AddChecklistModal open={addOpen} onClose={() => setAddOpen(false)} onAdd={handleAdd} />
      <StarterChecklistsModal
        open={starterOpen}
        onClose={() => setStarterOpen(false)}
        onSeed={handleSeedTrade}
        existingNames={existingNames}
      />
    </div>
  );
}
