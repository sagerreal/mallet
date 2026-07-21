"use client";

// Accordion row + in-place editor for a single saved checklist.
// Collapsed: name + step-count chip. Expanded: name field + ordered step list
// (text + Check/Photo toggle + remove), "+ Add step", Save (dirty-gated), Remove.

import { useState } from "react";
import type { Checklist } from "@/lib/store/types";
import type { NewChecklistItem } from "@/lib/store/slices/checklists-slice";
import { useAppStore } from "@/lib/store/app-store";
import { Segmented } from "@/app/(office)/settings/segmented";

const COMPACT_INPUT: React.CSSProperties = { fontSize: "var(--type-base)", padding: "var(--space-2) var(--space-3)", borderRadius: "var(--radius-sm)" };
const FIELD_MAX_WIDTH = 560;
const CHIP_STYLE: React.CSSProperties = {
  fontSize: "var(--type-sm)",
  fontWeight: 700,
  padding: "var(--space-1) var(--space-3)",
  borderRadius: "var(--radius-pill)",
  border: "1px solid var(--line)",
  color: "var(--ink-2)",
  background: "var(--card)",
  whiteSpace: "nowrap",
};

const STEP_TYPE_OPTIONS = [
  { value: "check" as const, label: "Check" },
  { value: "photo" as const, label: "Photo" },
] as const;

interface DraftItem {
  id: string;
  text: string;
  type: "check" | "photo";
}

export interface ChecklistEditorCardProps {
  checklist: Checklist;
  isExpanded: boolean;
  onToggle: () => void;
  isLast: boolean;
}

// ---- Collapsed row -----------------------------------------------------------------

function CollapsedRow({
  checklist,
  isExpanded,
  onToggle,
  isLast,
}: Pick<ChecklistEditorCardProps, "checklist" | "isExpanded" | "onToggle" | "isLast">) {
  return (
    <div
      style={{
        borderBottom: isLast && !isExpanded ? "none" : "1px solid var(--line-2, var(--line))",
      }}
    >
    <button
      type="button"
      aria-expanded={isExpanded}
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-3)",
        width: "100%",
        padding: "var(--space-3) var(--space-4)",
        background: "none",
        border: "none",
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        minHeight: 48,
      }}
    >
      <span style={{ fontSize: "var(--type-sm)", color: "var(--ink-3)", flexShrink: 0 }}>
        {isExpanded ? "▾" : "▸"}
      </span>
      <span
        style={{
          fontWeight: 700,
          fontSize: "var(--type-md)",
          flex: 1,
          color: "var(--ink)",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          letterSpacing: "-.01em",
        }}
      >
        {checklist.name || "Untitled checklist"}
      </span>
      <span style={CHIP_STYLE}>{checklist.items.length} {checklist.items.length === 1 ? "step" : "steps"}</span>
    </button>
    </div>
  );
}

// ---- Expanded editor -----------------------------------------------------------------

function ExpandedEditor({
  checklist,
  onToggle,
  isLast,
}: Pick<ChecklistEditorCardProps, "checklist" | "onToggle" | "isLast">) {
  const deleteChecklist = useAppStore((s) => s.deleteChecklist);
  const updateChecklist = useAppStore((s) => s.updateChecklist);

  const [draftName, setDraftName] = useState(checklist.name);
  const [draftItems, setDraftItems] = useState<DraftItem[]>(
    checklist.items
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((it) => ({ id: it.id, text: it.text, type: it.type })),
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const nameValid = draftName.trim().length > 0;
  const dirty =
    draftName.trim() !== checklist.name ||
    draftItems.length !== checklist.items.length ||
    draftItems.some((di, i) => {
      const orig = checklist.items.find((it) => it.id === di.id);
      if (!orig) return true;
      return di.text !== orig.text || di.type !== orig.type || i !== orig.position;
    });

  function handleAddStep() {
    setDraftItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), text: "", type: "check" as const },
    ]);
  }

  function handleRemoveStep(id: string) {
    setDraftItems((prev) => prev.filter((it) => it.id !== id));
  }

  function handleStepText(id: string, text: string) {
    setDraftItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, text } : it)),
    );
  }

  function handleStepType(id: string, type: "check" | "photo") {
    setDraftItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, type } : it)),
    );
  }

  async function handleSave() {
    const items: NewChecklistItem[] = draftItems.map((it) => ({
      text: it.text,
      type: it.type,
    }));
    setSaving(true);
    setSaveError(null);
    try {
      // Await the persist so a failed save is SURFACED (the optimistic write + rollback are
      // invisible otherwise). Only collapse the editor on success.
      await updateChecklist(checklist.id, draftName, items);
      setSaving(false);
      onToggle();
    } catch {
      setSaving(false);
      setSaveError("Couldn't save — check your connection and try again.");
    }
  }

  function handleRemove() {
    deleteChecklist(checklist.id);
  }

  return (
    <div
      style={{
        padding: "var(--space-4) var(--space-4) var(--space-4) var(--space-10)",
        borderBottom: isLast ? "none" : "1px solid var(--line-2, var(--line))",
      }}
    >
      <div style={{ maxWidth: FIELD_MAX_WIDTH }}>
        <div className="field">
          <label>Checklist name</label>
          <input
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            style={COMPACT_INPUT}
          />
        </div>

        {/* Steps list */}
        {draftItems.length > 0 && (
          <div style={{ marginBottom: "var(--space-3)" }}>
            <label style={{ display: "block", fontWeight: 700, fontSize: "var(--type-base)", marginBottom: "var(--space-2)" }}>Steps</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {draftItems.map((item) => (
                <div key={item.id} style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                  <input
                    type="text"
                    value={item.text}
                    onChange={(e) => handleStepText(item.id, e.target.value)}
                    placeholder="Step description"
                    style={{ ...COMPACT_INPUT, flex: 1 }}
                  />
                  <Segmented
                    value={item.type}
                    onChange={(v) => handleStepType(item.id, v)}
                    options={STEP_TYPE_OPTIONS}
                    aria-label="Step type"
                  />
                  <button
                    type="button"
                    className="lineedit-tool"
                    onClick={() => handleRemoveStep(item.id)}
                    style={{ color: "var(--ink-3)", flexShrink: 0 }}
                    aria-label="Remove step"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <button type="button" className="btn sm ghost" onClick={handleAddStep} style={{ marginBottom: "var(--space-4)" }}>
          + Add step
        </button>
      </div>

      {/* Footer: save left, remove right */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-2)",
          maxWidth: FIELD_MAX_WIDTH,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
          <button
            type="button"
            className="btn primary"
            disabled={!dirty || !nameValid || saving}
            onClick={handleSave}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {saveError && (
            <span style={{ color: "var(--red, #B3261E)", fontSize: "var(--type-sm)" }}>{saveError}</span>
          )}
        </div>
        <button
          type="button"
          className="lineedit-tool"
          onClick={handleRemove}
          style={{ color: "var(--red, #B3261E)" }}
        >
          Remove checklist
        </button>
      </div>
    </div>
  );
}

// ---- ChecklistEditorCard (collapsed + expanded) -------------------------------------------------

export function ChecklistEditorCard(props: ChecklistEditorCardProps) {
  const { checklist, isExpanded, onToggle, isLast } = props;
  return (
    <div>
      <CollapsedRow
        checklist={checklist}
        isExpanded={isExpanded}
        onToggle={onToggle}
        isLast={isLast && !isExpanded}
      />
      {isExpanded && (
        <ExpandedEditor
          checklist={checklist}
          onToggle={onToggle}
          isLast={isLast}
        />
      )}
    </div>
  );
}
