"use client";

/**
 * Tasks page (port of the prototype's vTasks) — the office's running to-do list,
 * grouped by urgency (Overdue / Today / Coming up). Store-backed so it shares one
 * source of truth with the per-lead Tasks card. A task tied to a customer is
 * tappable → opens that customer, so "Call Rob back" is one tap from Rob.
 */

import { useState } from "react";
import { todayISO } from "@/lib/clock";
import type { Lead, Task } from "@/lib/store/types";
import { useTasks, useLeads, useAppStore, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { pressable } from "@/lib/a11y";
import { isOverdue, tomorrowISO } from "@/lib/task-dates";
import { api } from "@/lib/trpc/client";
import { HYDRATOR_PAGE_LIMIT, HYDRATOR_STALE_MS } from "@/lib/store/hydrator-config";
import { shouldShowFirstRun } from "@/lib/first-run";
import { EditableTaskRow, type TaskPatch } from "@/features/tasks/editable-task-row";

// ---- Section ---------------------------------------------------------------

interface TaskSectionProps {
  label: string;
  tasks: Task[];
  leads: Lead[];
  onToggle: (id: string) => void;
  onUpdate: (id: string, patch: TaskPatch) => void;
  onRemove: (id: string) => void;
  onOpenLead: (leadId: string) => void;
}

function TaskSection({ label, tasks, leads, onToggle, onUpdate, onRemove, onOpenLead }: TaskSectionProps) {
  if (tasks.length === 0) return null;
  return (
    <>
      <div className="tsec">{label}</div>
      {tasks.map((t) => (
        <EditableTaskRow
          key={t.id}
          task={t}
          leads={leads}
          onToggle={onToggle}
          onUpdate={onUpdate}
          onRemove={onRemove}
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
  const updateTask = useAppStore((s) => s.updateTask);
  const removeTask = useAppStore((s) => s.removeTask);
  const openModal = useOpenModal();

  // Same query key + options as TasksHydrator → React Query dedupes it (no extra fetch). Lets us
  // tell a brand-new shop (never had a task) apart from a shop that has cleared its list, and never
  // flash the first-run copy mid-load.
  const { isFetched, isError } = api.v1.tasks.list.useQuery(
    { limit: HYDRATOR_PAGE_LIMIT },
    { staleTime: HYDRATOR_STALE_MS, refetchOnWindowFocus: false },
  );

  const [newText, setNewText] = useState("");
  const [newDue, setNewDue] = useState(tomorrowISO());
  const [doneOpen, setDoneOpen] = useState(false);

  function handleAdd() {
    const text = newText.trim();
    if (!text) return;
    addTask({ t: text, due: newDue || todayISO(), leadId: null });
    setNewText("");
    setNewDue(tomorrowISO());
  }

  function openLead(leadId: string) {
    openModal(MODAL.LEAD, { leadId });
  }

  const open = tasks.filter((t) => !t.done);
  const od = open.filter(isOverdue);
  const todayStr = todayISO();
  const today = open.filter((t) => !isOverdue(t) && t.due === todayStr);
  const later = open.filter((t) => !isOverdue(t) && t.due != null && t.due !== todayStr);
  const noDue = open.filter((t) => !t.due);
  const done = tasks.filter((t) => t.done);
  // A brand-new shop has never created a task; distinguish that from "cleared the list" (all done).
  const firstRun = shouldShowFirstRun({ isFetched, isError, count: tasks.length });

  return (
    <div>
      <div className="pagehead">
        <h1>Tasks</h1>
      </div>

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
          min={todayISO()}
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
            <TaskSection label="⚠ Overdue" tasks={od} leads={leads} onToggle={toggleTask} onUpdate={updateTask} onRemove={removeTask} onOpenLead={openLead} />
            <TaskSection label="Today" tasks={today} leads={leads} onToggle={toggleTask} onUpdate={updateTask} onRemove={removeTask} onOpenLead={openLead} />
            <TaskSection label="Coming up" tasks={later} leads={leads} onToggle={toggleTask} onUpdate={updateTask} onRemove={removeTask} onOpenLead={openLead} />
            <TaskSection label="No due date" tasks={noDue} leads={leads} onToggle={toggleTask} onUpdate={updateTask} onRemove={removeTask} onOpenLead={openLead} />
          </div>
        </div>
      ) : firstRun ? (
        <div className="card" style={{ padding: "34px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>No tasks yet</div>
          <p className="muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
            Add your first above — reminders like &ldquo;Call Rob back&rdquo; or &ldquo;Send the quote.&rdquo;
          </p>
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
                <EditableTaskRow
                  key={t.id}
                  task={t}
                  leads={leads}
                  onToggle={toggleTask}
                  onUpdate={updateTask}
                  onRemove={removeTask}
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
