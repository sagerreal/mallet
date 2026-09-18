"use client";

/**
 * features/jobs/checklist-steps-editor.tsx
 *
 * THE checklist editor: a name, then ordered steps, each a Check or a Photo, with add and remove.
 *
 * Extracted from the Checklists library card so the job sheet uses the same one. The job sheet used
 * to ask for "One item per line" in a textarea, which could not express a photo step at all — the
 * only way to get one was the `/photo|picture/i` guess in linesToItems — and silently made every
 * line required. Two editors for one thing, and the worse one sat on the surface the crew actually
 * runs the list from.
 *
 * Controlled: the caller owns name and items, because the two callers finish differently — the
 * library saves onto an existing checklist, the job sheet creates one and attaches it — and only
 * the footer differs. This renders the fields, nothing else.
 */

import type { CSSProperties } from "react";
import { Segmented } from "@/app/(office)/settings/segmented";
import { COMPACT_INPUT, Field, useGroupLabel } from "@/components/ui/input";

export interface DraftItem {
  id: string;
  text: string;
  type: "check" | "photo";
}

const STEP_TYPE_OPTIONS = [
  { value: "check" as const, label: "Check" },
  { value: "photo" as const, label: "Photo" },
] as const;

/** A blank step. Its id is client-only — it keys the row and never reaches the server. */
export function newDraftStep(): DraftItem {
  return { id: crypto.randomUUID(), text: "", type: "check" };
}

export interface ChecklistStepsEditorProps {
  readonly name: string;
  readonly onName: (name: string) => void;
  readonly items: readonly DraftItem[];
  readonly onItems: (items: DraftItem[]) => void;
  readonly disabled?: boolean;
  readonly style?: CSSProperties;
}

export function ChecklistStepsEditor({
  name,
  onName,
  items,
  onItems,
  disabled,
  style,
}: ChecklistStepsEditorProps) {
  const stepsGroup = useGroupLabel();

  const patch = (id: string, next: Partial<DraftItem>) =>
    onItems(items.map((it) => (it.id === id ? { ...it, ...next } : it)));

  return (
    <div style={style}>
      <Field label="Checklist name">
        <input
          type="text"
          value={name}
          disabled={disabled}
          onChange={(e) => onName(e.target.value)}
          style={COMPACT_INPUT}
        />
      </Field>

      {/* The label names the LIST of rows; each row's input names itself by step number, because
          there is no single control to point at. Hidden until there is a step to label. */}
      {items.length > 0 && (
        <div style={{ marginBottom: "var(--space-3)" }}>
          <label
            {...stepsGroup.labelProps}
            style={{
              display: "block",
              fontWeight: 700,
              fontSize: "var(--type-base)",
              marginBottom: "var(--space-2)",
            }}
          >
            Steps
          </label>
          <div
            {...stepsGroup.groupProps}
            style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
          >
            {items.map((item, stepIdx) => (
              // Layout lives in .clstep (prototype.css): one line on desktop; at phone width the
              // row wraps — full-width input, then Check/Photo + remove beneath — instead of
              // pushing the type control off the right edge of the screen.
              <div key={item.id} className="clstep">
                <input
                  type="text"
                  value={item.text}
                  disabled={disabled}
                  onChange={(e) => patch(item.id, { text: e.target.value })}
                  placeholder="Step description"
                  aria-label={`Step ${stepIdx + 1} description`}
                  className="clstep-input"
                  style={COMPACT_INPUT}
                />
                <Segmented
                  value={item.type}
                  onChange={(v) => patch(item.id, { type: v })}
                  options={STEP_TYPE_OPTIONS}
                  aria-label="Step type"
                />
                <button
                  type="button"
                  className="lineedit-tool"
                  disabled={disabled}
                  onClick={() => onItems(items.filter((it) => it.id !== item.id))}
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

      <button
        type="button"
        className="btn sm ghost"
        disabled={disabled}
        onClick={() => onItems([...items, newDraftStep()])}
        style={{ marginBottom: "var(--space-4)" }}
      >
        + Add step
      </button>
    </div>
  );
}
