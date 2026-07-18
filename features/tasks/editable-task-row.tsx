/**
 * features/tasks/editable-task-row.tsx
 * A Tasks-page row you can edit in place. Not editing: the round check toggles done,
 * the text opens an inline editor, and the attached-customer name stays a separate
 * link to that customer. Editing: the row expands in-flow (no floating UI) to edit
 * the text, due date, and attached customer, plus Delete. Enter saves, Escape cancels.
 *
 * Pure presentational + dependency-injected — the store actions (toggle/update/remove)
 * and the open-customer navigation are passed in, so it holds no store or router.
 */

"use client";

import { useState } from "react";
import type { Lead, Task } from "@/lib/store/types";
import { isOverdue, dueLabel } from "@/lib/task-dates";
import { todayISO } from "@/lib/clock";
import { pressable } from "@/lib/a11y";

export type TaskPatch = { t?: string; due?: string | null; leadId?: string | null };

interface EditableTaskRowProps {
  task: Task;
  leads: readonly Lead[];
  onToggle: (id: string) => void;
  onUpdate: (id: string, patch: TaskPatch) => void;
  onRemove: (id: string) => void;
  onOpenLead: (leadId: string) => void;
}

interface Draft {
  text: string;
  due: string;
  leadId: string;
}

const dateInputStyle: React.CSSProperties = {
  width: 150,
  flexShrink: 0,
  fontSize: 12.5,
  padding: "0 6px",
  height: "var(--input-h, 34px)",
  border: "1px solid var(--line)",
  borderRadius: "var(--radius-sm, 9px)",
  background: "var(--card)",
};

export function EditableTaskRow({ task, leads, onToggle, onUpdate, onRemove, onOpenLead }: EditableTaskRowProps) {
  const [draft, setDraft] = useState<Draft | null>(null);

  const leadName = task.leadId ? (leads.find((l) => l.id === task.leadId)?.name ?? null) : null;

  const startEditing = () => setDraft({ text: task.t, due: task.due ?? "", leadId: task.leadId ?? "" });
  const cancel = () => setDraft(null);

  const save = () => {
    if (!draft) return;
    const patch: TaskPatch = {};
    const text = draft.text.trim();
    if (text && text !== task.t) patch.t = text;
    if (draft.due !== (task.due ?? "")) patch.due = draft.due; // store maps "" → null
    if (draft.leadId !== (task.leadId ?? "")) patch.leadId = draft.leadId; // store maps "" → null
    if (Object.keys(patch).length > 0) onUpdate(task.id, patch);
    setDraft(null);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); save(); }
    if (e.key === "Escape") cancel();
  };

  if (draft) {
    return (
      <div className="trow trow-editing" style={{ flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <button className={`tchk${task.done ? " done" : ""}`} aria-label={task.done ? "Reopen task" : "Mark task done"} onClick={() => onToggle(task.id)} />
        <input
          type="text"
          value={draft.text}
          autoFocus
          aria-label="Task"
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          onKeyDown={onKey}
          style={{ flex: "1 1 220px", minWidth: 0, fontSize: 13.5 }}
        />
        <input
          type="date"
          value={draft.due}
          min={todayISO()}
          aria-label="Due date"
          title="Due date (optional)"
          onChange={(e) => setDraft({ ...draft, due: e.target.value })}
          onKeyDown={onKey}
          style={{ ...dateInputStyle, color: draft.due ? "var(--ink)" : "var(--ink-3)" }}
        />
        <select
          value={draft.leadId}
          aria-label="Attached customer"
          onChange={(e) => setDraft({ ...draft, leadId: e.target.value })}
          onKeyDown={onKey}
          style={{ ...dateInputStyle, width: 180, color: draft.leadId ? "var(--ink)" : "var(--ink-3)" }}
        >
          <option value="">No customer</option>
          {leads.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
        <button className="btn ghost sm" style={{ color: "var(--red)" }} onClick={() => onRemove(task.id)}>Delete</button>
        <span style={{ flex: "1 0 0" }} />
        <button className="btn ghost sm" onClick={cancel}>Cancel</button>
        <button className="btn sm primary" onClick={save}>Save</button>
      </div>
    );
  }

  const overdue = isOverdue(task);
  const isToday = !overdue && task.due === todayISO();
  const dueCls = overdue ? "od" : isToday ? "now" : "";

  const openLead = () => { if (task.leadId) onOpenLead(task.leadId); };

  return (
    <div className="trow">
      <button
        className={`tchk${task.done ? " done" : ""}`}
        aria-label={task.done ? "Reopen task" : "Mark task done"}
        onClick={() => onToggle(task.id)}
      />
      {/* Text and the customer pill are SIBLING controls: the text opens the inline editor,
          the customer name opens that customer. Neither nests inside the other. */}
      <div className="tmain">
        <span
          className="ttitle"
          onClick={startEditing}
          title="Click to edit"
          aria-label={`Edit task: ${task.t}`}
          {...pressable(startEditing)}
          style={{ cursor: "text" }}
        >
          {task.done ? <s className="muted">{task.t}</s> : task.t}
        </span>
        {leadName && (
          <span
            className="pill src"
            onClick={openLead}
            title={`Open ${leadName}`}
            aria-label={`Open ${leadName}`}
            {...pressable(openLead)}
            style={{ cursor: "pointer" }}
          >
            {leadName}
          </span>
        )}
      </div>
      <span className={`tdue${dueCls ? " " + dueCls : ""}`}>{dueLabel(task.due)}</span>
    </div>
  );
}
