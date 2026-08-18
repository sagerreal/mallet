"use client";

/**
 * features/field/my-hours-add-block.tsx
 * "Add hours" — the technician's own repair for a block the clock missed, and since Aug 11
 * also the way planned time lands ahead (the day window runs a week each way)
 * (no signal in a crawlspace, a forgotten morning punch, a supply-house run).
 *
 * Expands in-flow beneath its trigger. Day and both times are pickers, not text boxes: the point
 * of the form is that a wrong value cannot be typed onto a payroll record in the first place.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, useGroupLabel } from "@/components/ui/input";
import { KIND_LABELS, dayLabel, type MyHoursEntry } from "./my-hours-derive";
import { editWindowDates, timesProblem } from "./my-hours-edit";
import type { AddBlockInput } from "./use-my-hours-writes";
import { SelectMenu } from "@/components/ui/select-menu";
import { api } from "@/lib/trpc/client";

// The add block types PUNCHED rows only — time off has its own entry path (a kind, a day and
// a length; no times), so the clock kinds are the whole menu here.
type Kind = "job" | "travel" | "break" | "shop";

// Travel is gone: On my way starts JOB time, so nothing writes a travel row any more and
// offering one would be a control whose only outcome is a kind the clock never produces.
// Old days still render their travel rows — the kind stays valid, it is just not offered.
const KINDS: readonly Kind[] = ["job", "shop", "break"];

/**
 * Unassigned shop time is the honest default: it is the state the day container itself runs in,
 * it is paid, and it claims nothing about a job the technician has not named.
 */
const DEFAULT_KIND: Kind = "shop";

function KindPicker({ value, onPick }: { value: Kind; onPick: (kind: Kind) => void }) {
  return (
    <div className="ts-seg">
      {KINDS.map((kind) => (
        <button
          key={kind}
          className={value === kind ? "on" : ""}
          aria-pressed={value === kind}
          onClick={() => onPick(kind)}
        >
          {KIND_LABELS[kind]}
        </button>
      ))}
    </div>
  );
}

export interface AddBlockFormProps {
  readonly today: string;
  readonly techUserId: string | undefined;
  readonly saving: boolean;
  readonly error: string | null;
  readonly onAdd: (input: AddBlockInput, onDone: () => void) => void;
  readonly onCancel: () => void;
}

export function AddBlockForm({ today, techUserId, saving, error, onAdd, onCancel }: AddBlockFormProps) {
  const [workDate, setWorkDate] = useState(today);
  const kindGroup = useGroupLabel();
  const [kind, setKind] = useState<Kind>(DEFAULT_KIND);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [note, setNote] = useState("");
  const [jobId, setJobId] = useState("");
  const problem = timesProblem(startTime, endTime);

  // The jobs this technician may attribute hours to. Assignee-scoped and deliberately NOT
  // limited to today: a timesheet is corrected after the work is done, so a finished job has to
  // still be offered or the correction is impossible.
  const jobs = api.v1.field.myJobs.useQuery(undefined, { enabled: kind === "job" });
  const jobOptions = (jobs.data?.items ?? []).map((j) => ({
    value: j.id,
    label: j.title ? `${j.num} — ${j.title}` : j.num,
  }));

  // Job time that does not name a job cannot be costed, which is the only reason the kind
  // exists. Anything else is Regular.
  const missingJob = kind === "job" && jobId === "";

  const pickKind = (next: Kind): void => {
    setKind(next);
    if (next !== "job") setJobId("");
  };

  const submit = (): void => {
    if (techUserId === undefined || problem !== null || missingJob) return;
    onAdd(
      {
        techUserId,
        workDate,
        kind,
        jobId: kind === "job" ? jobId : null,
        startTime,
        endTime,
        note: note.trim(),
      },
      () => {
        setStartTime("");
        setEndTime("");
        setNote("");
        setJobId("");
        onCancel();
      },
    );
  };

  return (
    <div className="ts-editor">
      <Field label="Day">
        {/* No aria-label here or below: an aria-label outranks the <label> element,
            so it made each Field's visible label decorative and getByLabelText could
            not resolve these controls. The label is the name now. */}
        <SelectMenu
          value={workDate}
          onChange={setWorkDate}
          options={editWindowDates(today).map((date) => ({ value: date, label: dayLabel(date) }))}
          aria-label="Work date"
          compact
        />
      </Field>
      <div className="ts-erow" {...kindGroup.groupProps}>
        <label {...kindGroup.labelProps}>Type</label>
        <KindPicker value={kind} onPick={pickKind} />
      </div>
      {kind === "job" ? (
        <Field label="Job">
          <SelectMenu
            value={jobId}
            onChange={setJobId}
            options={[{ value: "", label: "Pick a job…" }, ...jobOptions]}
            aria-label="Job"
            compact
          />
        </Field>
      ) : null}
      <div className="ts-times">
        <div className="ts-timecol">
          <Field label="Start">
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
        </div>
        <div className="ts-timecol">
          <Field label="End">
            <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </Field>
        </div>
      </div>
      <Field label="Note (optional)">
        <input type="text" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {problem !== null ? <p className="mh-err">{problem}</p> : null}
      {problem === null && missingJob ? (
        <p className="mh-err">Pick the job these hours went to, or record them as Regular.</p>
      ) : null}
      {error !== null ? <p className="mh-err">{error}</p> : null}
      <div className="mh-acts">
        <Button disabled={problem !== null || missingJob || saving || techUserId === undefined} onClick={submit}>
          {saving ? "Adding…" : "Add these hours"}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
