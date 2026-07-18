/**
 * features/tasks/editable-task-row.tsx
 * A Tasks-page row you can edit in place. Resting: the round check toggles done, the
 * text (and a visible pencil) open the editor, and the attached-customer name is a
 * separate link to that customer. Editing: the row is replaced by a calm inset panel
 * (in-flow, no floating UI) with labeled Due date + Customer fields and Delete. Enter
 * saves, Escape cancels. Only ONE task edits at a time — the open/close state is owned
 * by the page, so opening one closes any other.
 *
 * Pure + dependency-injected: the store actions and open-customer navigation are passed
 * in, so it holds no store or router.
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
  editing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onToggle: (id: string) => void;
  onUpdate: (id: string, patch: TaskPatch) => void;
  onRemove: (id: string) => void;
  onOpenLead: (leadId: string) => void;
}

export function EditableTaskRow(props: EditableTaskRowProps) {
  if (props.editing) {
    return (
      <TaskEditor
        task={props.task}
        leads={props.leads}
        onToggle={props.onToggle}
        onSave={(patch) => {
          if (Object.keys(patch).length > 0) props.onUpdate(props.task.id, patch);
          props.onStopEdit();
        }}
        onCancel={props.onStopEdit}
        onRemove={() => {
          props.onRemove(props.task.id);
          props.onStopEdit();
        }}
      />
    );
  }
  return (
    <RestingRow task={props.task} leads={props.leads} onToggle={props.onToggle} onEdit={props.onStartEdit} onOpenLead={props.onOpenLead} />
  );
}

// ── resting row ────────────────────────────────────────────────────────────

function RestingRow({
  task, leads, onToggle, onEdit, onOpenLead,
}: {
  task: Task;
  leads: readonly Lead[];
  onToggle: (id: string) => void;
  onEdit: () => void;
  onOpenLead: (leadId: string) => void;
}) {
  const leadName = task.leadId ? (leads.find((l) => l.id === task.leadId)?.name ?? null) : null;
  const openLead = () => { if (task.leadId) onOpenLead(task.leadId); };
  const overdue = isOverdue(task);
  const isToday = !overdue && task.due === todayISO();
  const dueCls = overdue ? "od" : isToday ? "now" : "";

  return (
    <div className="trow">
      <button
        className={`tchk${task.done ? " done" : ""}`}
        aria-label={task.done ? "Reopen task" : "Mark task done"}
        onClick={() => onToggle(task.id)}
      />
      {/* Text and the customer pill are SIBLING controls: text opens the editor, the
          customer name opens that customer. Neither nests inside the other. */}
      <div className="tmain">
        <span
          className="ttitle"
          onClick={onEdit}
          title="Click to edit"
          aria-label={`Edit task: ${task.t}`}
          {...pressable(onEdit)}
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
      <button className="trow-edit" aria-label="Edit" title="Edit" onClick={onEdit}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </button>
      <span className={`tdue${dueCls ? " " + dueCls : ""}`}>{dueLabel(task.due)}</span>
    </div>
  );
}

// ── editor panel (mounts fresh per edit; initializes from the task) ──────────

interface Draft {
  text: string;
  due: string;
  leadId: string;
}

function TaskEditor({
  task, leads, onToggle, onSave, onCancel, onRemove,
}: {
  task: Task;
  leads: readonly Lead[];
  onToggle: (id: string) => void;
  onSave: (patch: TaskPatch) => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({ text: task.t, due: task.due ?? "", leadId: task.leadId ?? "" });

  const save = () => {
    const patch: TaskPatch = {};
    const text = draft.text.trim();
    if (text && text !== task.t) patch.t = text;
    if (draft.due !== (task.due ?? "")) patch.due = draft.due; // store maps "" → null
    if (draft.leadId !== (task.leadId ?? "")) patch.leadId = draft.leadId; // store maps "" → null
    onSave(patch);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); save(); }
    if (e.key === "Escape") onCancel();
  };

  return (
    <div className="task-editor">
      <div className="te-head">
        <button className={`tchk${task.done ? " done" : ""}`} aria-label={task.done ? "Reopen task" : "Mark task done"} onClick={() => onToggle(task.id)} />
        <input
          className="te-input"
          type="text"
          value={draft.text}
          autoFocus
          aria-label="Task"
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          onKeyDown={onKey}
        />
      </div>
      <div className="te-grid">
        <label className="te-fld">
          <span>Due date</span>
          <input
            className="te-input"
            type="date"
            value={draft.due}
            min={todayISO()}
            aria-label="Due date"
            onChange={(e) => setDraft({ ...draft, due: e.target.value })}
            onKeyDown={onKey}
          />
        </label>
        <label className="te-fld">
          <span>Customer</span>
          <select
            className="te-input"
            value={draft.leadId}
            aria-label="Attached customer"
            onChange={(e) => setDraft({ ...draft, leadId: e.target.value })}
            onKeyDown={onKey}
          >
            <option value="">No customer</option>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="te-foot">
        <button className="te-del" onClick={onRemove}>Delete</button>
        <span className="te-sp" />
        <button className="btn ghost sm" onClick={onCancel}>Cancel</button>
        <button className="btn sm primary" onClick={save}>Save</button>
      </div>
    </div>
  );
}
