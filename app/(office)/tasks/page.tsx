"use client";

/**
 * Tasks page — pixel-faithful port of the prototype's vTasks().
 * Uses SAMPLE_TASKS / SAMPLE_LEADS from lib/prototype-sample.ts.
 * No live hooks. All interactive actions are console-logged stubs.
 *
 * Prototype reference: elas-crm-prototype.html lines 2822–2851.
 *
 * STUBS (visual / no-op):
 *   - taskDone(id)     — mark a task done (toggles done state)
 *   - addTask()        — create a new task from the input + date
 *   - openLead(id)     — navigate to a lead (from the lead pill)
 */

import { useState } from "react";
import {
  SAMPLE_TASKS,
  SAMPLE_LEADS,
  TODAY_ISO,
  dPlus,
  type SampleTask,
} from "@/lib/prototype-sample";

// ---- helpers ported from prototype -----------------------------------------

function todayISO(): string {
  return TODAY_ISO;
}

function isOverdue(t: SampleTask): boolean {
  return !t.done && !!t.due && t.due < todayISO();
}

function dueLabel(iso: string): string {
  if (iso === todayISO()) return "Today";
  const d = new Date(iso + "T12:00:00");
  const today = new Date(todayISO() + "T12:00:00");
  const diff = Math.round(
    (d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diff < 0) return `${Math.abs(diff)}d ago`;
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function leadName(leadId: number): string | null {
  return SAMPLE_LEADS.find((l) => l.id === leadId)?.name ?? null;
}

// ---- stubs ------------------------------------------------------------------

function stub(action: string, ...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log(`[stub] ${action}`, ...args);
}

// ---- Task row ---------------------------------------------------------------

function TaskRow({
  t,
  onDone,
}: {
  t: SampleTask;
  onDone: (id: number) => void;
}) {
  const overdue = isOverdue(t);
  const isToday = !overdue && t.due === todayISO();
  const dueCls = overdue ? "od" : isToday ? "now" : "";
  const dueText = t.due === todayISO() ? "Today" : dueLabel(t.due);
  const lName = t.leadId != null ? leadName(t.leadId) : null;

  if (t.done) {
    return (
      <div className="trow">
        <span className="tchk done" title="Done" />
        <div className="tmain">
          <span className="ttitle">
            <s className="muted">{t.t}</s>
          </span>
          {lName && (
            <span
              className="pill src"
              style={{ cursor: "pointer" }}
              onClick={() => stub("openLead", t.leadId)}
            >
              {lName}
            </span>
          )}
        </div>
        <span className="tdue">{dueLabel(t.due)}</span>
      </div>
    );
  }

  return (
    <div className="trow">
      <button
        className="tchk"
        title="Mark done"
        onClick={() => onDone(t.id)}
      />
      <div className="tmain">
        <span className="ttitle">{t.t}</span>
        {lName && (
          <span
            className="pill src"
            style={{ cursor: "pointer" }}
            onClick={() => stub("openLead", t.leadId)}
          >
            {lName}
          </span>
        )}
      </div>
      <span className={`tdue${dueCls ? " " + dueCls : ""}`}>{dueText}</span>
    </div>
  );
}

// ---- Section header ---------------------------------------------------------

function TaskSection({
  label,
  tasks,
  onDone,
}: {
  label: string;
  tasks: SampleTask[];
  onDone: (id: number) => void;
}) {
  if (tasks.length === 0) return null;
  return (
    <>
      <div className="tsec">{label}</div>
      {tasks.map((t) => (
        <TaskRow key={t.id} t={t} onDone={onDone} />
      ))}
    </>
  );
}

// ---- Main page --------------------------------------------------------------

export default function TasksPage() {
  const [tasks, setTasks] = useState<SampleTask[]>(SAMPLE_TASKS);
  const [newText, setNewText] = useState("");
  const [newDue, setNewDue] = useState(dPlus(1));
  const [doneOpen, setDoneOpen] = useState(false);

  function handleDone(id: number) {
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, done: true } : t))
    );
    stub("taskDone", id);
  }

  function handleAdd() {
    const text = newText.trim();
    if (!text) return;
    const newTask: SampleTask = {
      id: Date.now(),
      t: text,
      due: newDue,
      leadId: null,
      done: false,
    };
    setTasks((prev) => [...prev, newTask]);
    setNewText("");
    setNewDue(dPlus(1));
    stub("addTask", newTask);
  }

  const open = tasks.filter((t) => !t.done);
  const od = open.filter(isOverdue);
  const today = open.filter((t) => !isOverdue(t) && t.due === todayISO());
  const later = open.filter((t) => !isOverdue(t) && t.due !== todayISO());
  const done = tasks.filter((t) => t.done);

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 14,
        }}
      >
        <h1>Tasks</h1>
      </div>

      {/* Add task card */}
      <div className="card" style={{ padding: "13px 15px", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            placeholder="Add a task — e.g. order more yard signs"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
            }}
            style={{
              flex: 1,
              border: "1.5px solid var(--line)",
              borderRadius: 9,
              padding: "9px 11px",
              fontFamily: "inherit",
              fontSize: "13.5px",
            }}
          />
          <span className="muted" style={{ fontSize: 12, fontWeight: 600 }}>
            Due
          </span>
          <input
            type="date"
            className="taskmeta-in"
            value={newDue}
            min={todayISO()}
            onChange={(e) => setNewDue(e.target.value)}
          />
          <button className="btn primary" onClick={handleAdd}>
            + Add
          </button>
        </div>
      </div>

      {/* Task list card */}
      <div className="card" style={{ padding: "8px 16px" }}>
        {open.length > 0 ? (
          <div className="tasklist">
            <TaskSection label="⚠ Overdue" tasks={od} onDone={handleDone} />
            <TaskSection label="Today" tasks={today} onDone={handleDone} />
            <TaskSection label="Coming up" tasks={later} onDone={handleDone} />
          </div>
        ) : (
          <div className="empty-att">
            No open tasks — you&apos;re caught up.
          </div>
        )}
      </div>

      {/* Done section */}
      {done.length > 0 && (
        <div className={`reveal${doneOpen ? " open" : ""}`}>
          <div
            className="reveal-head"
            onClick={() => setDoneOpen((v) => !v)}
          >
            <span className="caret">▸</span> Done{" "}
            <span className="muted" style={{ fontWeight: 500 }}>
              — {done.length}
            </span>
          </div>
          <div className="reveal-body">
            <div className="tasklist">
              {done.map((t) => (
                <TaskRow key={t.id} t={t} onDone={handleDone} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
