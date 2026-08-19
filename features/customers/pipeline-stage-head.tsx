"use client";

import { useState } from "react";
import { STAGE_NAME_MAX } from "@/modules/customers/domain/pipeline-stage";

/**
 * One column's head — the stage name, its count, and the in-flow editor behind "Edit".
 *
 * Everything here is a real button: rename, move and delete have to be reachable without a mouse
 * because drag is the only other way to change the board, and drag is pointer-only. The editor
 * opens IN the head (no floating UI) and closes on save/cancel.
 */
export function PipelineStageHead({
  name,
  count,
  first,
  last,
  onRename,
  onMove,
  onRemove,
}: {
  name: string;
  count: number;
  first: boolean;
  last: boolean;
  onRename: (name: string) => void;
  onMove: (direction: "up" | "down") => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  if (!editing) {
    return (
      <div className="col-head">
        <span>{name}</span>
        <span className="pipe-headacts">
          <span className="sum">{count}</span>
          <button
            type="button"
            className="pipe-edit"
            aria-label={`Edit stage ${name}`}
            onClick={() => {
              setDraft(name);
              setEditing(true);
            }}
          >
            Edit
          </button>
        </span>
      </div>
    );
  }

  return (
    <form
      className="pipe-headedit"
      onSubmit={(e) => {
        e.preventDefault();
        const next = draft.trim();
        if (next && next !== name) onRename(next);
        setEditing(false);
      }}
    >
      <input
        value={draft}
        maxLength={STAGE_NAME_MAX}
        onChange={(e) => setDraft(e.target.value)}
        aria-label="Stage name"
        // The field the tap asked for — same rule as every expander on the sheet grammar.
        autoFocus
      />
      <div className="pipe-headrow">
        <button type="submit" className="btn sm primary">Save</button>
        {/* Move is disabled at the edge, not hidden — a control that vanishes reads as broken. */}
        <button type="button" className="btn sm ghost" disabled={first} aria-label={`Move ${name} left`} onClick={() => onMove("up")}>←</button>
        <button type="button" className="btn sm ghost" disabled={last} aria-label={`Move ${name} right`} onClick={() => onMove("down")}>→</button>
        {/* Neutral ink: removing a stage is recoverable in effect — its customers return to
            Not staged, nothing is lost. Red is reserved for destroying records. */}
        <button type="button" className="btn sm ghost" onClick={onRemove}>Delete</button>
        <button type="button" className="btn sm ghost" onClick={() => setEditing(false)}>Cancel</button>
      </div>
    </form>
  );
}

/** The "+ Add stage" ghost column — a button until tapped, an in-flow input after. */
export function AddStage({ onAdd, disabled }: { onAdd: (name: string) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  if (!open) {
    return (
      <button type="button" className="pipe-addstage" disabled={disabled} onClick={() => setOpen(true)}>
        + Add stage
      </button>
    );
  }
  return (
    <form
      className="pipe-addstage pipe-addform"
      onSubmit={(e) => {
        e.preventDefault();
        const name = draft.trim();
        if (name) onAdd(name);
        setDraft("");
        setOpen(false);
      }}
    >
      <input
        value={draft}
        maxLength={STAGE_NAME_MAX}
        onChange={(e) => setDraft(e.target.value)}
        aria-label="New stage name"
        placeholder="Stage name"
        autoFocus
      />
      <div className="pipe-headrow">
        <button type="submit" className="btn sm primary">Add</button>
        <button type="button" className="btn sm ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
