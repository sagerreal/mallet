"use client";

// Trade onboarding for the Checklists tab: pick your trade → preview the starter
// checklists → seed the library (dedupe handled by the panel, not here).

import { useState } from "react";
import { Modal } from "@/components/modals/modal";
import { CHECKLIST_STARTERS, type StarterChecklist } from "@/app/(office)/jobs/checklist-starters";

const CHIP: React.CSSProperties = {
  fontSize: 11.5,
  fontWeight: 700,
  padding: "3px 10px",
  borderRadius: 999,
  border: "1px solid var(--line)",
  color: "var(--ink-2)",
  background: "var(--card)",
  whiteSpace: "nowrap",
};

export function StarterChecklistsModal({
  open,
  onClose,
  onSeed,
  existingNames,
}: {
  open: boolean;
  onClose: () => void;
  onSeed: (
    tradeKey: string,
    checklists: Array<{ name: string; items: Array<{ text: string; type: "check" | "photo" }> }>,
  ) => void;
  existingNames?: Set<string>;
}) {
  const [tradeKey, setTradeKey] = useState<string>("plumbing");
  const set = CHECKLIST_STARTERS.find((s) => s.key === tradeKey);

  function countNew(checklists: readonly StarterChecklist[]): number {
    if (!existingNames) return checklists.length;
    return checklists.filter((cl) => !existingNames.has(cl.name)).length;
  }

  function handleSeed() {
    if (!set) return;
    const payload = set.checklists.map((cl) => ({
      name: cl.name,
      items: cl.items.map((it) => ({ text: it.text, type: it.type })),
    }));
    onSeed(tradeKey, payload);
  }

  const newCount = set ? countNew(set.checklists) : 0;

  return (
    <Modal open={open} onClose={onClose} maxWidth={520}>
      <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 800, letterSpacing: "-.01em" }}>
        Starter checklists
      </h3>

      <div className="field">
        <label>Your trade</label>
        <select className="tsel" value={tradeKey} onChange={(e) => setTradeKey(e.target.value)}>
          {CHECKLIST_STARTERS.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* Preview: the actual checklists this seeds */}
      {set && (
        <div
          style={{
            border: "1px solid var(--line-2, var(--line))",
            borderRadius: 10,
            marginBottom: 16,
            overflow: "hidden",
          }}
        >
          {set.checklists.map((cl, i) => {
            const hasPhoto = cl.items.some((it) => it.type === "photo");
            const isLast = i === set.checklists.length - 1;
            return (
              <div
                key={cl.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 12px",
                  borderBottom: isLast ? "none" : "1px solid var(--line-2, var(--line))",
                }}
              >
                <span style={{ flex: 1, fontWeight: 600, fontSize: 13 }}>{cl.name}</span>
                <span style={CHIP}>{cl.items.length} steps</span>
                {hasPhoto && <span style={CHIP}>⚡ photo</span>}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={newCount === 0} onClick={handleSeed}>
          Add {newCount} {newCount === 1 ? "checklist" : "checklists"}
        </button>
      </div>
    </Modal>
  );
}
