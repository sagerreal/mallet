"use client";

// Accordion row + in-place editor for a single saved checklist.
// Collapsed: name + step-count chip. Expanded: name field + ordered step list
// (text + Check/Photo toggle + remove), "+ Add step", Save (dirty-gated), Remove.

import { useState } from "react";
import type { Checklist } from "@/lib/store/types";
import type { NewChecklistItem } from "@/lib/store/slices/checklists-slice";
import { useAppStore } from "@/lib/store/app-store";
import { ChecklistStepsEditor, type DraftItem } from "./checklist-steps-editor";
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
      <ChecklistStepsEditor
        name={draftName}
        onName={setDraftName}
        items={draftItems}
        onItems={setDraftItems}
        disabled={saving}
        style={{ maxWidth: FIELD_MAX_WIDTH }}
      />

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
