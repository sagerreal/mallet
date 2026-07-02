/**
 * components/modals/lead-modal/next-step-card.tsx
 * Faithful port of prototype nextStepBlock(l).
 * Shows: "NEXT STEP" label + suggested action + open tasks + upcoming visits + add-task toggle.
 */

"use client";

import { useState } from "react";
import type { Lead } from "@/lib/store/types";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";

interface NextStepCardProps {
  lead: Lead;
}

export function NextStepCard({ lead }: NextStepCardProps) {
  const tasks = useAppStore((s) => s.tasks);
  const taskDone = useAppStore((s) => s.taskDone);
  const addTask = useAppStore((s) => s.addTask);
  const openModal = useOpenModal();

  const [showTaskInput, setShowTaskInput] = useState(false);
  const [taskText, setTaskText] = useState("");
  const [taskDue, setTaskDue] = useState("");

  // Open tasks for this lead
  const openTasks = tasks.filter(
    (t) => t.leadId === lead.id && !t.done
  );

  // Upcoming evisits (not done)
  const upcomingVisits = (lead.evisits ?? []).filter(
    (v) => v.status !== "done"
  );

  // First name
  const firstName = lead.name.split(" ")[0] ?? lead.name;

  // Suggested action — only when no open tasks
  function suggestedAction() {
    if (openTasks.length > 0) return null;
    if (lead.stage === "New customer") {
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 13 }}>First call to {firstName}</span>
          <button
            className="btn sm primary"
            onClick={() => openModal(MODAL.CALL, { leadId: lead.id })}
          >
            Call now
          </button>
        </div>
      );
    }
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 13 }}>Follow up with {firstName}</span>
        <button
          className="btn sm"
          onClick={() => openModal(MODAL.CALL, { leadId: lead.id })}
        >
          Call
        </button>
      </div>
    );
  }

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
    setShowTaskInput(false);
  }

  return (
    <div className="card">
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--ink-3)",
          marginBottom: 10,
        }}
      >
        Next step
      </div>

      {/* Suggested action */}
      {suggestedAction()}

      {/* Open tasks */}
      {openTasks.length > 0 && (
        <div style={{ marginTop: openTasks.length > 0 ? 10 : 0 }}>
          {openTasks.map((t) => (
            <div
              key={t.id}
              className="stage-row"
              style={{ fontSize: 13, alignItems: "flex-start", gap: 8 }}
            >
              <div style={{ flex: 1 }}>
                <div>{t.t}</div>
                {t.due && (
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
                    Due {t.due}
                  </div>
                )}
              </div>
              <button
                className="btn sm ghost"
                onClick={() => taskDone(t.id)}
              >
                Done
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Upcoming visits */}
      {upcomingVisits.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {upcomingVisits.map((v) => (
            <div
              key={v.id}
              className="stage-row"
              style={{ fontSize: 13 }}
            >
              <span className="pill blue">Visit</span>
              <span>{v.date}</span>
              <button
                className="btn sm ghost"
                style={{ marginLeft: "auto" }}
                onClick={() =>
                  openModal(MODAL.VISIT, { visitId: v.id, leadId: lead.id })
                }
              >
                Open
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add task toggle */}
      {!showTaskInput ? (
        <button
          className="btn ghost sm"
          style={{ marginTop: 12, fontSize: 12 }}
          onClick={() => setShowTaskInput(true)}
        >
          + Add a task
        </button>
      ) : (
        <div className="cfrow" style={{ marginTop: 12, flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="What needs to happen…"
            value={taskText}
            onChange={(e) => setTaskText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAddTask();
              if (e.key === "Escape") {
                setShowTaskInput(false);
                setTaskText("");
              }
            }}
            autoFocus
          />
          <input
            type="date"
            value={taskDue}
            onChange={(e) => setTaskDue(e.target.value)}
          />
          <button
            className="btn sm primary"
            onClick={handleAddTask}
            disabled={!taskText.trim()}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
