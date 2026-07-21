/**
 * components/modals/lead-modal/tasks-card.tsx
 * The lead's Tasks area — add and track what needs to happen. Replaces the old
 * "NEXT STEP" nudge (the stage-aware first action now lives on the header's
 * primary button). Open tasks first (check to complete), completed ones below
 * (muted / struck, check to reopen), plus an inline add row.
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

interface TasksCardProps {
  lead: Lead;
}

/** The same round check control the Tasks page uses (.tchk) — one styling system. */
function TaskCheck({ done, onToggle }: { done: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={done ? "tchk done" : "tchk"}
      onClick={onToggle}
      aria-label={done ? "Reopen task" : "Mark task done"}
    />
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
      <div className="stage-row" style={{ gap: 10, alignItems: "center", padding: "8px 0" }}>
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
            fontSize: 13.5,
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
            fontSize: 12.5,
            padding: "0 6px",
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
    <div className="stage-row" style={{ gap: 10, alignItems: "center", padding: "8px 0" }}>
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
            fontSize: 13.5,
            textDecoration: task.done ? "line-through" : "none",
            color: task.done ? "var(--ink-3)" : "var(--ink)",
          }}
        >
          {task.t}
        </div>
        {task.due && (
          <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
            Due {dueLabel(task.due)}
          </div>
        )}
      </div>
    </div>
  );
}

export function TasksCard({ lead }: TasksCardProps) {
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
    <div className="card">
      <h3>Tasks</h3>

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
      <div className="cfrow" style={{ marginTop: "var(--space-3)", gap: 6 }}>
        <input
          type="text"
          placeholder="Add a task — e.g. First call, send quote…"
          value={taskText}
          onChange={(e) => setTaskText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAddTask();
          }}
          style={{ flex: 1 }}
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
            fontSize: 12.5,
            padding: "0 6px",
            height: "var(--input-h, 34px)",
            border: "1px solid var(--line)",
            borderRadius: "var(--radius-sm, 9px)",
            background: "var(--card)",
            color: taskDue ? "var(--ink)" : "var(--ink-3)",
          }}
        />
        <button className="btn sm primary" onClick={handleAddTask} disabled={!taskText.trim()}>
          Add task
        </button>
      </div>
    </div>
  );
}
