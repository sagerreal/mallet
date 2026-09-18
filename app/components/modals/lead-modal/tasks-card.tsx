/**
 * components/modals/lead-modal/tasks-card.tsx
 * The Tasks accordion body — open tasks first (check to complete), completed below
 * (muted, check to reopen), plus the inline add row (text + due date + Add). No card
 * chrome: the SheetRow above it is the header, and the collapsed row carries the
 * open count.
 *
 * Clicking a task's TEXT activates inline editing: a text input + compact date
 * input replace the label in-row. Enter or blur commits; Escape cancels.
 * The done-circle is always active and is not part of the edit affordance.
 */

"use client";

import { useState, useRef, useCallback } from "react";
import type { Lead, Task } from "@/lib/store/types";
import { useAppStore } from "@/lib/store/app-store";
import { todayISO } from "@/lib/clock";
import { dueLabel } from "@/lib/task-dates";



/** The same round check control the Tasks page uses (.tchk) — one styling system. */
function TaskCheck({ done, onToggle }: { done: boolean; onToggle: () => void }) {
  // The visible circle stays 19px; the BUTTON is a full-row-height 44px column.
  // An 18px target 4px from a tappable row is a state-changing mis-tap in gloves.
  return (
    <button
      type="button"
      className="sheet-chkzone"
      onClick={onToggle}
      aria-label={done ? "Reopen task" : "Mark task done"}
    >
      <span className={done ? "tchk done" : "tchk"} aria-hidden="true" />
    </button>
  );
}

interface EditingState {
  text: string;
  due: string;
}

interface TaskRowProps {
  task: Task;
  onToggle: () => void;
  onUpdate: (id: string, patch: { t?: string; due?: string | null }) => void;
}

function TaskRow({ task, onToggle, onUpdate }: TaskRowProps) {
  const [editing, setEditing] = useState<EditingState | null>(null);
  // Mirror `editing` into a ref so a queued (blur) commit reads the CURRENT value,
  // not a stale closure — and can detect the edit was already committed/cancelled.
  const editingRef = useRef<EditingState | null>(null);
  editingRef.current = editing;
  // Pending blur→commit timer. Cleared when focus moves between the two inputs
  // (so tabbing text→date doesn't commit) and on Enter/Escape.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const startEditing = useCallback(() => {
    setEditing({ text: task.t, due: task.due ?? "" });
  }, [task.t, task.due]);

  const commit = useCallback(() => {
    clearTimer();
    const cur = editingRef.current;
    if (!cur) return; // already committed or cancelled — bail (no double-fire)
    editingRef.current = null; // guard re-entry before the re-render clears state
    setEditing(null);

    const newText = cur.text.trim();
    const newDue = cur.due; // "" means no due date (mapped to null below)

    // Build patch with only changed fields.
    const patch: { t?: string; due?: string | null } = {};
    if (newText && newText !== task.t) patch.t = newText;
    // Map "" → null; non-empty string → that date string.
    if (newDue !== (task.due ?? "")) {
      patch.due = newDue === "" ? null : newDue;
    }

    if (Object.keys(patch).length > 0) {
      onUpdate(task.id, patch);
    }
  }, [task.id, task.t, task.due, onUpdate, clearTimer]);

  const cancel = useCallback(() => {
    clearTimer();
    editingRef.current = null;
    setEditing(null);
  }, [clearTimer]);

  if (editing) {
    return (
      <div className="stage-row" style={{ gap: "var(--space-3)", alignItems: "center", padding: "var(--space-2) 0" }}>
        <TaskCheck done={!!task.done} onToggle={onToggle} />
        <input
          type="text"
          value={editing.text}
          autoFocus
          onChange={(e) =>
            setEditing((prev) => prev ? { ...prev, text: e.target.value } : prev)
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") cancel();
          }}
          onFocus={clearTimer}
          onBlur={() => {
            // Delay so moving focus to the date input (which clears the timer) doesn't
            // fire a premature commit; a genuine blur-out lets the timer run.
            timerRef.current = setTimeout(commit, 120);
          }}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: "var(--type-base)",
          }}
          aria-label="Edit task text"
        />
        <input
          type="date"
          value={editing.due}
          onChange={(e) =>
            setEditing((prev) => prev ? { ...prev, due: e.target.value } : prev)
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") cancel();
          }}
          onFocus={clearTimer}
          onBlur={() => {
            timerRef.current = setTimeout(commit, 120);
          }}
          aria-label="Edit due date"
          title="Due date (optional)"
          style={{
            width: 130,
            flexShrink: 0,
            fontSize: "var(--type-base)",
            padding: "0 var(--space-2)",
            height: "var(--input-h, 34px)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-sm, 9px)",
            background: "var(--card)",
            color: editing.due ? "var(--ink)" : "var(--ink-3)",
          }}
        />
      </div>
    );
  }

  return (
    <div className="stage-row" style={{ gap: "var(--space-3)", alignItems: "center", padding: "var(--space-2) 0" }}>
      <TaskCheck done={!!task.done} onToggle={onToggle} />
      <div
        role="button"
        tabIndex={0}
        onClick={startEditing}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") startEditing(); }}
        style={{ flex: 1, minWidth: 0, cursor: "text" }}
        title="Click to edit"
        aria-label={`Edit task: ${task.t}`}
      >
        <div
          style={{
            fontSize: "var(--type-base)",
            textDecoration: task.done ? "line-through" : "none",
            color: task.done ? "var(--ink-3)" : "var(--ink)",
          }}
        >
          {task.t}
        </div>
        {task.due && (
          <div className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-2xs)" }}>
            Due {dueLabel(task.due)}
          </div>
        )}
      </div>
    </div>
  );
}

/** Trailing text for the collapsed Tasks row. */
export function openTaskLabel(openCount: number): string | null {
  return openCount > 0 ? `${openCount} open` : null;
}

export function TasksBody({ lead }: { lead: Lead }) {
  const tasks = useAppStore((s) => s.tasks);
  const toggleTask = useAppStore((s) => s.toggleTask);
  const addTask = useAppStore((s) => s.addTask);
  const updateTask = useAppStore((s) => s.updateTask);

  const [taskText, setTaskText] = useState("");
  const [taskDue, setTaskDue] = useState("");

  // Derive this lead's tasks in the component body (never inside a selector).
  const leadTasks = tasks.filter((t) => t.leadId === lead.id);
  const openTasks = leadTasks.filter((t) => !t.done);
  const doneTasks = leadTasks.filter((t) => t.done);

  function handleAddTask() {
    const trimmed = taskText.trim();
    if (!trimmed) return;
    // Use the chosen date if set; fall back to today (preserving prior behaviour).
    addTask({
      t: trimmed,
      due: taskDue || todayISO(),
      leadId: lead.id,
    });
    setTaskText("");
    setTaskDue("");
  }

  return (
    <>
      {openTasks.map((t) => (
        <TaskRow
          key={t.id}
          task={t}
          onToggle={() => toggleTask(t.id)}
          onUpdate={updateTask}
        />
      ))}

      {doneTasks.length > 0 && (
        <div style={{ marginTop: openTasks.length ? 8 : 0, opacity: 0.75 }}>
          {doneTasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              onToggle={() => toggleTask(t.id)}
              onUpdate={updateTask}
            />
          ))}
        </div>
      )}

      {/* Add a task — text + optional due date + Add button, all in one row */}
      <div className="cfrow" style={{ marginTop: "var(--space-3)", gap: "var(--space-2)" }}>
        <input
          type="text"
          placeholder="Add a task…"
          value={taskText}
          onChange={(e) => setTaskText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAddTask();
          }}
        />
        <input
          type="date"
          value={taskDue}
          onChange={(e) => setTaskDue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAddTask();
          }}
          aria-label="Due date"
          title="Due date (optional)"
          style={{
            width: 130,
            flexShrink: 0,
            fontSize: "var(--type-base)",
            padding: "0 var(--space-2)",
            height: "var(--input-h, 34px)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-sm, 9px)",
            background: "var(--card)",
            color: taskDue ? "var(--ink)" : "var(--ink-3)",
          }}
        />
        <button className="btn" onClick={handleAddTask} disabled={!taskText.trim()}>
          Add task
        </button>
      </div>
    </>
  );
}
