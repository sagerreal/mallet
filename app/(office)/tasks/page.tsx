"use client";

/**
 * Tasks page (port of the prototype's vTasks) — the office's running to-do list,
 * grouped by urgency (Overdue / Today / Coming up). Store-backed so it shares one
 * source of truth with the per-lead Tasks card. A task tied to a customer is
 * tappable → opens that customer, so "Call Rob back" is one tap from Rob.
 */

import { useState } from "react";
import { TODAY_ISO } from "@/lib/prototype-sample";
import type { Task } from "@/lib/store/types";
import { useTasks, useLeads, useAppStore, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { pressable } from "@/lib/a11y";
import { isOverdue, dueLabel, tomorrowISO } from "@/lib/task-dates";

// ---- Task row --------------------------------------------------------------

interface TaskRowProps {
  task: Task;
  leadName: string | null;
  onToggle: (id: number) => void;
  onOpenLead: (leadId: number) => void;
}

function TaskRow({ task, leadName, onToggle, onOpenLead }: TaskRowProps) {
  const overdue = isOverdue(task);
  const isToday = !overdue && task.due === TODAY_ISO;
  const dueCls = overdue ? "od" : isToday ? "now" : "";
  const dueText = dueLabel(task.due);
  const clickable = task.leadId != null && !!leadName;
  const openLead = () => {
    if (task.leadId != null) onOpenLead(task.leadId);
  };

  return (
    <div
      className={`trow${clickable ? " clickable" : ""}`}
      onClick={clickable ? openLead : undefined}
      {...(clickable ? pressable(openLead) : {})}
    >
      <button
        className={`tchk${task.done ? " done" : ""}`}
        aria-label={task.done ? "Reopen task" : "Mark task done"}
        onClick={(e) => {
          e.stopPropagation();
          onToggle(task.id);
        }}
      />
      <div className="tmain">
        <span className="ttitle">
          {task.done ? <s className="muted">{task.t}</s> : task.t}
        </span>
        {leadName && <span className="pill src">{leadName}</span>}
      </div>
      <span className={`tdue${dueCls ? " " + dueCls : ""}`}>{dueText}</span>
    </div>
  );
}

// ---- Section ---------------------------------------------------------------

interface TaskSectionProps {
  label: string;
  tasks: Task[];
  leadNameOf: (leadId: number | null) => string | null;
  onToggle: (id: number) => void;
  onOpenLead: (leadId: number) => void;
}

function TaskSection({ label, tasks, leadNameOf, onToggle, onOpenLead }: TaskSectionProps) {
  if (tasks.length === 0) return null;
  return (
    <>
      <div className="tsec">{label}</div>
      {tasks.map((t) => (
        <TaskRow
          key={t.id}
          task={t}
          leadName={leadNameOf(t.leadId)}
          onToggle={onToggle}
          onOpenLead={onOpenLead}
        />
      ))}
    </>
  );
}

// ---- Page ------------------------------------------------------------------

export default function TasksPage() {
  const tasks = useTasks();
  const leads = useLeads();
  const addTask = useAppStore((s) => s.addTask);
  const toggleTask = useAppStore((s) => s.toggleTask);
  const openModal = useOpenModal();

  const [newText, setNewText] = useState("");
  const [newDue, setNewDue] = useState(tomorrowISO());
  const [doneOpen, setDoneOpen] = useState(false);

  // Derived in the body (never inside a selector).
  const leadNameOf = (leadId: number | null): string | null =>
    leadId == null ? null : (leads.find((l) => l.id === leadId)?.name ?? null);

  function handleAdd() {
    const text = newText.trim();
    if (!text) return;
    addTask({ t: text, due: newDue || TODAY_ISO, leadId: null });
    setNewText("");
    setNewDue(tomorrowISO());
  }

  function openLead(leadId: number) {
    openModal(MODAL.LEAD, { leadId });
  }

  const open = tasks.filter((t) => !t.done);
  const od = open.filter(isOverdue);
  const today = open.filter((t) => !isOverdue(t) && t.due === TODAY_ISO);
  const later = open.filter((t) => !isOverdue(t) && t.due !== TODAY_ISO);
  const done = tasks.filter((t) => t.done);

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Tasks</h1>
      <p className="muted" style={{ fontSize: 13, margin: "0 0 18px" }}>
        Everything you owe a customer — what&apos;s late, what&apos;s today, what&apos;s coming.
      </p>

      {/* Quick add — one cohesive field: type it, hit Enter (due date optional) */}
      <div className="taskadd" style={{ marginBottom: 18 }}>
        <input
          type="text"
          aria-label="Add a task"
          placeholder="Add a task…"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
        />
        <input
          type="date"
          aria-label="Due date"
          title="Due date"
          value={newDue}
          min={TODAY_ISO}
          onChange={(e) => setNewDue(e.target.value)}
        />
        <button
          className="btn sm primary"
          onClick={handleAdd}
          disabled={!newText.trim()}
          style={newText.trim() ? undefined : { opacity: 0.4 }}
        >
          Add
        </button>
      </div>

      {/* The list, grouped by urgency */}
      {open.length > 0 ? (
        <div className="card" style={{ padding: "6px 16px 12px" }}>
          <div className="tasklist">
            <TaskSection label="⚠ Overdue" tasks={od} leadNameOf={leadNameOf} onToggle={toggleTask} onOpenLead={openLead} />
            <TaskSection label="Today" tasks={today} leadNameOf={leadNameOf} onToggle={toggleTask} onOpenLead={openLead} />
            <TaskSection label="Coming up" tasks={later} leadNameOf={leadNameOf} onToggle={toggleTask} onOpenLead={openLead} />
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: "34px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>You&apos;re all caught up</div>
          <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
            No open tasks. Add one above when something needs doing.
          </p>
        </div>
      )}

      {/* Done — collapsed */}
      {done.length > 0 && (
        <div className={`reveal${doneOpen ? " open" : ""}`} style={{ marginTop: 4 }}>
          <div
            className="reveal-head"
            aria-expanded={doneOpen}
            onClick={() => setDoneOpen((v) => !v)}
            {...pressable(() => setDoneOpen((v) => !v))}
          >
            <span className="caret">▸</span> Done{" "}
            <span className="muted" style={{ fontWeight: 500 }}>— {done.length}</span>
          </div>
          <div className="reveal-body">
            <div className="tasklist">
              {done.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  leadName={leadNameOf(t.leadId)}
                  onToggle={toggleTask}
                  onOpenLead={openLead}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
