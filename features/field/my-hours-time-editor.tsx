"use client";

/**
 * features/field/my-hours-time-editor.tsx
 * The in-flow start/end editor that expands beneath a timesheet row (no popover, no modal —
 * the row stays where it was and the editor opens under it).
 *
 * Both time controls are native pickers rather than text boxes on purpose: a free-text field
 * lets a technician type "8" or "0800" or "8pm" on a payroll record, and the first person to
 * discover the typo is the person paying him.
 *
 * TYPE and JOB are here because the clock's guess is not always right. Everything the taps cannot
 * attribute lands as "shop", and until these existed a technician looking at a day filed entirely
 * as shop had no way to say which of it was a job — the one correction a timesheet exists for.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Select, useFieldId, useGroupLabel } from "@/components/ui/input";
import { api } from "@/lib/trpc/client";
import { timesProblem } from "./my-hours-edit";
import { clockLabel } from "./my-hours-derive";

export type EntryKind = "job" | "travel" | "break" | "shop";

const KINDS: readonly { readonly k: EntryKind; readonly label: string }[] = [
  { k: "job", label: "Job" },
  { k: "travel", label: "Travel" },
  { k: "break", label: "Break" },
  { k: "shop", label: "Regular" },
];

export interface MyHoursTimeEditorProps {
  readonly kind: EntryKind;
  readonly jobId: string | null;
  readonly startTime: string;
  /** Empty for a row left open. Pre-filled with the suggestion when there is one. */
  readonly endTime: string;
  /** Shown as a one-tap fill when the row is still open and the day has something to suggest. */
  readonly suggestedEnd?: string | null;
  readonly saving: boolean;
  /** The server's refusal, verbatim — it names the actual problem (e.g. an approved row). */
  readonly serverError: string | null;
  readonly onSave: (patch: { kind: EntryKind; jobId: string | null; startTime: string; endTime: string }) => void;
  readonly onCancel: () => void;
  /** Soft-delete this row. Armed two-tap inside the editor — destruction is never one tap. */
  readonly onDelete: () => void;
}

export function MyHoursTimeEditor({
  kind: initialKind,
  jobId: initialJobId,
  startTime: initialStart,
  endTime: initialEnd,
  suggestedEnd = null,
  saving,
  serverError,
  onSave,
  onCancel,
  onDelete,
}: MyHoursTimeEditorProps) {
  const [kind, setKind] = useState<EntryKind>(initialKind);
  // Destruction is never one tap: first Delete arms, second executes (the sweep modals' grammar).
  const [deleteArmed, setDeleteArmed] = useState(false);
  const kindGroup = useGroupLabel();
  const jobField = useFieldId();
  const [jobId, setJobId] = useState<string | null>(initialJobId);
  const [startTime, setStartTime] = useState(initialStart);
  const [endTime, setEndTime] = useState(initialEnd);
  const problem = timesProblem(startTime, endTime);

  // Only the caller's own jobs, and only fetched once a job is actually being named — there is no
  // reason to load a job list to correct a break.
  const jobs = api.v1.field.myJobs.useQuery(undefined, {
    enabled: kind === "job",
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return (
    <div className="ts-editor">
      {/* The row is the group and the label names it from inside — the buttons are a
          toggle set, so there is no single control for htmlFor to point at. */}
      <div className="ts-erow" {...kindGroup.groupProps}>
        <label {...kindGroup.labelProps}>Type</label>
        <div className="ts-seg">
          {KINDS.map(({ k, label }) => (
            <button
              key={k}
              type="button"
              className={kind === k ? "on" : ""}
              aria-pressed={kind === k}
              onClick={() => {
                setKind(k);
                // A break is not work on a job. Carrying the job across would file the wrong thing.
                if (k !== "job") setJobId(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {kind === "job" && (
        <div className="ts-erow">
          {/* aria-label removed: it outranked this visible label, leaving it dead. */}
          <label {...jobField.labelProps}>Job</label>
          <Select
            {...jobField.controlProps}
            value={jobId ?? ""}
            onChange={(e) => setJobId(e.target.value || null)}
            style={{ maxWidth: 320 }}
          >
            <option value="">
              {jobs.isLoading ? "Loading your jobs…" : "No job"}
            </option>
            {(jobs.data?.items ?? []).map((j) => (
              <option key={j.id} value={j.id}>
                {j.title ? `${j.num} · ${j.title}` : j.num}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div className="ts-times">
        <div className="ts-timecol">
          {/* No aria-label: it outranks the <label>, so it made these Fields'
              visible labels decorative. The label is the accessible name. */}
          <Field label="Start">
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </Field>
        </div>
        <div className="ts-timecol">
          <Field label="End">
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </Field>
        </div>
      </div>
      {suggestedEnd !== null && endTime !== suggestedEnd ? (
        <Button variant="quiet" size="sm" onClick={() => setEndTime(suggestedEnd)}>
          Use {clockLabel(suggestedEnd)}
        </Button>
      ) : null}
      {problem !== null ? <p className="mh-err">{problem}</p> : null}
      {serverError !== null ? <p className="mh-err">{serverError}</p> : null}
      <div className="mh-acts">
        <Button
          size="sm"
          disabled={problem !== null || saving}
          onClick={() => onSave({ kind, jobId, startTime, endTime })}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button variant="quiet" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={saving}
          onClick={() => {
            if (!deleteArmed) {
              setDeleteArmed(true);
              return;
            }
            onDelete();
          }}
        >
          {deleteArmed ? "⚠ Really delete? Tap again" : "Delete"}
        </Button>
      </div>
    </div>
  );
}
