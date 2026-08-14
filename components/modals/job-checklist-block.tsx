/**
 * components/modals/job-checklist-block.tsx
 * The job modal's "Before you leave" checklist block.
 *
 * ONE panel: saved checklists as tap-to-attach rows (✕ deletes), then a
 * multiline textarea ("One item per line") + optional name + "Add to job".
 * A quick-created checklist is ALSO saved for reuse — saved lists ARE the
 * templates; there is no separate template manager.
 *
 * Attach PERSISTS: updateJob(job.id, { checklist }) rides v1.jobs.update into
 * the jobs.checklist jsonb column. The template itself persists in ONE
 * v1.checklists.create call (items included — the old per-item mutations raced
 * the create inside a tRPC batch and saved empty templates). Every write
 * AWAITS its outcome — a failure keeps the panel open with inline copy (house
 * rule: no silent failures on interactive paths).
 *
 * Quick-created items are required:true so the tech close-out gap nudge fires
 * for them (it nudges only — never blocks the bill).
 */

"use client";

import { useRef, useState } from "react";
import { useAppStore } from "@/lib/store/app-store";
import type { Checklist, Job } from "@/lib/store/types";
import type { NewChecklistItem } from "@/lib/store/slices/checklists-slice";
import { PLUMBING_STARTER_CHECKLISTS } from "@/features/checklists/checklist-seed";
import { ChecklistStepsEditor, type DraftItem } from "@/features/jobs/checklist-steps-editor";

// Item-type heuristic for the CANNED STARTER checklists only — their text is ours, so reading
// "photo" out of it is a fact about our own copy, not a guess at what somebody typed. Author-typed
// steps carry an explicit Check/Photo toggle.
const PHOTO_ITEM_RE = /photo|picture/i;

// Mirrors JOB_CHECKLIST_MAX_ITEMS (modules/jobs/domain/job.ts) — the client-side
// mirror pattern used across the store slices; the module barrel can't be imported
// from client code under test (it pulls the router → server config validator).
const JOB_CHECKLIST_MAX_ITEMS = 50;
// Mirrors the server's own cap (checklist-router createInput: items[].text max 500). Without a
// client guard a long line reached the API, came back a raw 400, and the office was told only
// "try again" — the one thing that could not work.
const JOB_CHECKLIST_MAX_ITEM_CHARS = 500;

// Shown when a persist path (create / attach / remove) fails — state is kept so
// the office can retry.
const SAVE_FAILED_COPY = "Couldn't save the checklist — try again.";


// ---- the add panel ------------------------------------------------------------

interface AddChecklistPanelProps {
  job: Job;
  onDone: () => void;
  onCancel: () => void;
}

function AddChecklistPanel({ job, onDone, onCancel }: AddChecklistPanelProps) {
  // A finished or canceled job refuses every checklist write server-side (Job.patchFields ->
  // "cannot edit a completed or canceled job"). Attempting it anyway produced the worst possible
  // shape: the optimistic write flipped the panel away, the typed text was lost, the request
  // 400'd, and each retry left ANOTHER orphan template behind. Refuse up front and say why.
  const isTerminal = job.status === "complete" || job.status === "canceled";
  const checklists = useAppStore((s) => s.checklists);
  const addChecklist = useAppStore((s) => s.addChecklist);
  const deleteChecklist = useAppStore((s) => s.deleteChecklist);
  const updateJob = useAppStore((s) => s.updateJob);
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<DraftItem[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The checklist created by a previous (failed-attach) submit, keyed to the
  // content it was built from — a retry with unchanged content reuses it
  // instead of minting a duplicate.
  const createdRef = useRef<{ id: string; fingerprint: string } | null>(null);
  // Every saved checklist, unfiltered. This used to filter to stage === "job", which meant a list
  // on the retired "scope" stage could be created but never attached from here — the only way onto
  // a job was at creation time. There is one kind of checklist now.
  const saved = checklists;

  /** Attach a snapshot to the job; outcome awaited. Returns true on success. */
  async function attach(chkName: string, items: Checklist["items"]): Promise<boolean> {
    if (isTerminal) {
      setError("This job is finished — reopen it to change its checklist.");
      return false;
    }
    const { ok } = await updateJob(job.id, { checklist: { name: chkName, items } });
    if (!ok) setError(SAVE_FAILED_COPY);
    return ok;
  }

  /** Tap a saved row — attach it to this job. */
  async function attachSaved(c: Checklist) {
    if (busy) return;
    if (c.items.length > JOB_CHECKLIST_MAX_ITEMS) {
      setError(
        `This checklist has ${c.items.length} items — a job holds at most ${JOB_CHECKLIST_MAX_ITEMS}.`,
      );
      return;
    }
    setError("");
    setBusy(true);
    try {
      if (await attach(c.name, c.items)) onDone();
    } finally {
      setBusy(false);
    }
  }

  /** "Add to job" — save the pasted lines as a checklist, then attach it. */
  async function addToJob() {
    if (busy) return;
    if (isTerminal) {
      // Checked BEFORE anything is created — the old order saved a template, failed the attach,
      // and left the orphan behind on every retry.
      setError("This job is finished — reopen it to change its checklist.");
      return;
    }
    // Blank rows are dropped rather than saved as empty steps — an added-then-unused row is a
    // slip, not an instruction to the crew.
    const items: NewChecklistItem[] = steps
      .map((s) => ({ text: s.text.trim(), type: s.type, required: true }))
      .filter((s) => s.text.length > 0);
    if (items.length === 0) {
      setError("Add at least one step.");
      return;
    }
    if (items.length > JOB_CHECKLIST_MAX_ITEMS) {
      setError(
        `A checklist holds at most ${JOB_CHECKLIST_MAX_ITEMS} items — remove ${items.length - JOB_CHECKLIST_MAX_ITEMS}.`,
      );
      return;
    }
    // Say WHICH line and by how much — the server rejects the whole checklist for one long line,
    // and "try again" leaves somebody re-pasting the same text forever.
    const longIdx = items.findIndex((i) => i.text.length > JOB_CHECKLIST_MAX_ITEM_CHARS);
    if (longIdx !== -1) {
      const over = (items[longIdx]?.text.length ?? 0) - JOB_CHECKLIST_MAX_ITEM_CHARS;
      setError(
        `Step ${longIdx + 1} is ${over} character${over === 1 ? "" : "s"} too long — a step holds at most ${JOB_CHECKLIST_MAX_ITEM_CHARS}.`,
      );
      return;
    }
    const chkName = name.trim() || "Checklist";
    setError("");
    setBusy(true);
    try {
      const fingerprint = JSON.stringify([chkName, items.map((i) => i.text)]);
      let template: Checklist | undefined =
        createdRef.current?.fingerprint === fingerprint
          ? useAppStore.getState().checklists.find((c) => c.id === createdRef.current?.id)
          : undefined;
      if (!template) {
        const { persisted } = addChecklist(chkName, "job", items);
        try {
          template = await persisted;
        } catch {
          // Slice rolled back and dev-logged; tell the office why nothing saved.
          setError(SAVE_FAILED_COPY);
          return;
        }
        createdRef.current = { id: template.id, fingerprint };
      }
      if (await attach(template.name, template.items)) onDone();
    } finally {
      setBusy(false);
    }
  }

  /** Empty state: one tap creates the plumbing starter checklists (saved, not attached). */
  async function seedStarters() {
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      await Promise.all(
        PLUMBING_STARTER_CHECKLISTS.map(
          (s) =>
            addChecklist(
              s.name,
              "job",
              s.items.map((text) => ({
                text,
                type: PHOTO_ITEM_RE.test(text) ? ("photo" as const) : ("check" as const),
                required: true,
              })),
            ).persisted,
        ),
      );
    } catch {
      setError(SAVE_FAILED_COPY);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: "var(--space-4)" }}>
      <h3 style={{ margin: "0 0 var(--space-2)", fontSize: "var(--type-base)" }}>Add a checklist</h3>

      {/* The saved list is unbounded — a shop with twenty close-out lists pushed this panel's own
          "Add to job" (and the inline error above it) under the modal's sticky footer, so the
          primary action opened behind a bar. Capped and scrolled in place: the rows give, the
          action below them does not move. */}
      <div className="chk-saved" style={{ maxHeight: "34vh", overflowY: "auto" }}>
      {saved.map((c) => (
        <div key={c.id} className="stage-row clickable" style={{ gap: "var(--space-2)" }}>
          <span
            style={{ flex: 1, fontSize: "var(--type-base)", fontWeight: 600, cursor: "pointer" }}
            onClick={() => void attachSaved(c)}
          >
            {c.name}
          </span>
          <span className="muted" style={{ fontSize: "var(--type-sm)" }}>{c.items.length} items</span>
          <span
            className="linklike"
            style={{ color: "var(--ink-3)", fontSize: "var(--type-sm)" }}
            title="Delete this checklist"
            onClick={() => deleteChecklist(c.id)}
          >
            ✕
          </span>
        </div>
      ))}
      {saved.length === 0 && (
        <div className="stage-row" style={{ gap: "var(--space-2)" }}>
          <span
            className="linklike"
            style={{ fontSize: "var(--type-base)", fontWeight: 700 }}
            onClick={() => void seedStarters()}
          >
            Start with plumbing basics
          </span>
          <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
            {PLUMBING_STARTER_CHECKLISTS.length} checklists
          </span>
        </div>
      )}
      </div>

      {/* The SAME editor the Checklists library uses. This was "One item per line" in a textarea,
          which could not express a photo step at all — the only way to get one was a
          /photo|picture/i guess at the words — and made every line required with no way to say
          otherwise. */}
      <ChecklistStepsEditor
        name={name}
        onName={(v) => {
          setName(v);
          if (error) setError("");
        }}
        items={steps}
        onItems={(v) => {
          setSteps(v);
          if (error) setError("");
        }}
        disabled={busy}
        style={{ marginTop: "var(--space-3)" }}
      />
      {error && (
        <div style={{ color: "var(--red)", fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>{error}</div>
      )}
      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", marginTop: "var(--space-2)" }}>
        <button
          type="button"
          className="btn sm primary"
          disabled={busy}
          onClick={() => void addToJob()}
        >
          {busy ? "Saving…" : "Add to job"}
        </button>
        <span className="linklike" style={{ fontSize: "var(--type-sm)" }} onClick={onCancel}>
          Cancel
        </span>
      </div>
    </div>
  );
}

// ---- the block ---------------------------------------------------------------

export function JobChecklistBlock({ job }: { job: Job }) {
  // Every checklist control on this block writes to the job, and the job domain refuses a write
  // to a completed or canceled job. Rather than let each control fail its own way, the block
  // reads the state once and stops offering what cannot work.
  const isTerminal = job.status === "complete" || job.status === "canceled";
  const updateJob = useAppStore((s) => s.updateJob);
  const [open, setOpen] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [busy, setBusy] = useState(false);

  /** Detach — outcome awaited so a failed remove doesn't silently reappear. */
  async function removeChecklist() {
    if (busy) return;
    setRemoveError("");
    setBusy(true);
    try {
      const { ok } = await updateJob(job.id, { checklist: undefined });
      if (!ok) setRemoveError(SAVE_FAILED_COPY);
    } finally {
      setBusy(false);
    }
  }

  // Already attached → show it (+ Remove; persists the detach as checklist: null).
  if (job.checklist) {
    return (
      <div className="card" style={{ marginTop: "var(--space-4)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h3 style={{ margin: "0", fontSize: "var(--type-base)" }}>Before you leave</h3>
          {/* Remove writes to the job, so a finished job can't offer it — the request would 400
              and the row would reappear on the next render. Read-only is the honest state. */}
          {isTerminal ? null : (
            <span
              className="linklike"
              style={{ fontSize: "var(--type-sm)" }}
              onClick={() => void removeChecklist()}
            >
              Remove
            </span>
          )}
        </div>
        <div className="muted" style={{ fontSize: "var(--type-sm)", marginBottom: "var(--space-2)" }}>{job.checklist.name}</div>
        {removeError && (
          <div style={{ color: "var(--red)", fontSize: "var(--type-sm)", marginBottom: "var(--space-2)" }}>{removeError}</div>
        )}
        {job.checklist.items.map((it) => (
          <div key={it.id} className="stage-row" style={{ gap: "var(--space-2)", padding: "var(--space-1) 0" }}>
            <span style={{ color: it.required ? "var(--amber)" : "var(--ink-3)" }}>
              {it.type === "photo" ? "📷" : "○"}
            </span>
            <span style={{ flex: 1, fontSize: "var(--type-base)" }}>{it.text}</span>
            {it.required && <span className="muted" style={{ fontSize: "var(--type-xs)" }}>required</span>}
          </div>
        ))}
      </div>
    );
  }

  if (open) {
    return <AddChecklistPanel job={job} onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />;
  }

  // Entry point. A finished or canceled job refuses the write, so the opener isn't offered —
  // a control that can only fail is a dead button.
  if (isTerminal) {
    return (
      <div className="muted" style={{ marginTop: "var(--space-4)", fontSize: "var(--type-sm)" }}>
        No checklist on this job — reopen it to add one.
      </div>
    );
  }

  return (
    <div style={{ marginTop: "var(--space-4)" }}>
      <span
        className="linklike"
        style={{ fontSize: "var(--type-base)", fontWeight: 700 }}
        onClick={() => setOpen(true)}
      >
        + Add a checklist
      </span>{" "}
      <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
        — the crew runs it before they leave (optional, per job)
      </span>
    </div>
  );
}
