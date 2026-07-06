/**
 * components/modals/lead-modal/tasks-card.tsx
 * The lead's Tasks area — add and track what needs to happen. Replaces the old
 * "NEXT STEP" nudge (the stage-aware first action now lives on the header's
 * primary button). Open tasks first (check to complete), completed ones below
 * (muted / struck, check to reopen), plus an inline add row.
 */

"use client";

import { useState } from "react";
import type { Lead, Task } from "@/lib/store/types";
import { useAppStore } from "@/lib/store/app-store";

interface TasksCardProps {
  lead: Lead;
}

/** A round check control — filled green with ✓ when done, empty ring otherwise. */
function TaskCheck({ done, onToggle }: { done: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={done ? "Reopen task" : "Mark task done"}
      style={{
        width: 20,
        height: 20,
        flexShrink: 0,
        borderRadius: "50%",
        border: `1.5px solid ${done ? "var(--green-700)" : "var(--line)"}`,
        background: done ? "var(--green-700)" : "transparent",
        color: "#fff",
        fontSize: 12,
        lineHeight: 1,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 0,
      }}
    >
      {done ? "✓" : ""}
    </button>
  );
}

function TaskRow({ task, onToggle }: { task: Task; onToggle: () => void }) {
  return (
    <div className="stage-row" style={{ gap: 10, alignItems: "center", padding: "8px 0" }}>
      <TaskCheck done={!!task.done} onToggle={onToggle} />
      <div style={{ flex: 1, minWidth: 0 }}>
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
            Due {task.due}
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

  const [taskText, setTaskText] = useState("");
  const [taskDue, setTaskDue] = useState("");

  // Derive this lead's tasks in the component body (never inside a selector).
  const leadTasks = tasks.filter((t) => t.leadId === lead.id);
  const openTasks = leadTasks.filter((t) => !t.done);
  const doneTasks = leadTasks.filter((t) => t.done);

  function handleAddTask() {
    const trimmed = taskText.trim();
    if (!trimmed) return;
    addTask({
      t: trimmed,
      due: taskDue || new Date().toISOString().slice(0, 10),
      leadId: lead.id,
    });
    setTaskText("");
    setTaskDue("");
  }

  return (
    <div className="card">
      <h3>Tasks</h3>

      {openTasks.length === 0 && doneTasks.length === 0 && (
        <p className="muted" style={{ fontSize: 13, margin: "4px 0 12px" }}>
          Nothing to do yet — add a task to track what needs to happen.
        </p>
      )}

      {openTasks.map((t) => (
        <TaskRow key={t.id} task={t} onToggle={() => toggleTask(t.id)} />
      ))}

      {doneTasks.length > 0 && (
        <div style={{ marginTop: openTasks.length ? 8 : 0, opacity: 0.75 }}>
          {doneTasks.map((t) => (
            <TaskRow key={t.id} task={t} onToggle={() => toggleTask(t.id)} />
          ))}
        </div>
      )}

      {/* Add a task — always available */}
      <div className="cfrow" style={{ marginTop: 12, flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Add a task — e.g. First call, send quote…"
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
          aria-label="Task due date"
        />
        <button className="btn sm primary" onClick={handleAddTask} disabled={!taskText.trim()}>
          Add task
        </button>
      </div>
    </div>
  );
}
