"use client";

/**
 * features/jobs/timesheets-entries.tsx
 * The timesheet row + its inline editor and pickers. All in-flow (no floating
 * popover — matches the prototype and Owen's no-floating-UI rule). These are
 * presentational: they read the entry and call back on every change; the panel
 * owns the state and the store writes. Pure labels/math live in timesheet-derive.
 */

import { useState } from "react";
import type { Job, Lead, Tech, TimeEntry } from "@/lib/store/types";
import { timeToH } from "@/lib/time";
import { custName, liveJobs, techById } from "./jobs-helpers";
import { TS_KINDS, TS_KIND_KEYS, MAX_JOB_SUGGESTIONS } from "./timesheet-constants";
import {
  tsJob,
  tsLabel,
  tsTimeLabel,
  tsSortEntries,
  tsMoney,
  tsPaid,
  tsHours,
  tsTimeOpts,
  tsTechWeekJobIds,
} from "./timesheet-derive";

// Which sub-picker is open inside the row editor ('job'|'start'|'end'|none).
export type TsPick = "job" | "start" | "end" | null;

interface TsKindSegProps {
  entry: TimeEntry;
  onPick: (kind: string) => void;
}

/** Segmented control choosing the entry kind (job/travel/break/shop). */
function TsKindSeg({ entry, onPick }: TsKindSegProps) {
  return (
    <div className="ts-seg">
      {TS_KIND_KEYS.map((k) => (
        <button key={k} className={entry.kind === k ? "on" : ""} onClick={() => onPick(k)}>
          {TS_KINDS[k]}
        </button>
      ))}
    </div>
  );
}

interface TsJobPickerProps {
  entry: TimeEntry;
  jobs: Job[];
  leads: Lead[];
  techs: Tech[];
  weekDates: string[];
  open: boolean;
  onToggle: () => void;
  onPick: (jobId: string) => void;
}

/** Job dropdown — this crew's week jobs first, then other open jobs (capped). */
function TsJobPicker({ entry, jobs, leads, techs, weekDates, open, onToggle, onPick }: TsJobPickerProps) {
  const [q, setQ] = useState("");
  const cur = tsJob(entry, jobs);
  const tc = techById(techs, entry.techId);
  const who = tc ? tc.name.split(" ")[0] : "the crew";
  const wk = tsTechWeekJobIds(jobs, entry.techId, weekDates);
  const jobLabel = (j: Job) => {
    const cn = custName(j, leads);
    return cn && cn !== "—" ? `${j.title} · ${cn}` : j.title;
  };
  const matches = (j: Job) => {
    const s = (j.title + " " + (custName(j, leads) || "")).toLowerCase();
    return !q.trim() || s.indexOf(q.toLowerCase().trim()) >= 0;
  };
  const openJobs = liveJobs(jobs);
  const scoped = openJobs.filter((j) => wk.has(j.id) && matches(j));
  const rest = openJobs.filter((j) => !wk.has(j.id)).slice(0, MAX_JOB_SUGGESTIONS).filter(matches);
  const opt = (j: Job) => (
    <button
      key={j.id}
      className={`ts-opt ts-jobopt ${entry.jobId === j.id ? "sel" : ""}`}
      onClick={() => onPick(j.id)}
    >
      {jobLabel(j)}
    </button>
  );
  return (
    <>
      <button type="button" className={`ts-trig ${entry.jobId ? "" : "empty"}`} onClick={onToggle}>
        <span className="cv">{entry.jobId && cur ? jobLabel(cur) : "Pick a job"}</span>
        <span style={{ color: "var(--ink-3)" }}>▾</span>
      </button>
      {open && (
        <div className="ts-list">
          <input
            className="ts-search"
            placeholder="Search all jobs…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {scoped.length > 0 && (
            <>
              <div className="grp">On {who}&rsquo;s schedule this week</div>
              {scoped.map(opt)}
            </>
          )}
          {rest.length > 0 && (
            <>
              <div className="grp">Other open jobs</div>
              {rest.map(opt)}
            </>
          )}
          {scoped.length === 0 && rest.length === 0 && <div className="grp">No open jobs</div>}
        </div>
      )}
    </>
  );
}

interface TsTimePickerProps {
  entry: TimeEntry;
  field: "start" | "end";
  open: boolean;
  onToggle: () => void;
  onPick: (val: string) => void;
}

/** In/out time dropdown across the configured timesheet window. */
function TsTimePicker({ entry, field, open, onToggle, onPick }: TsTimePickerProps) {
  const val = entry[field];
  const cur = val ? tsTimeLabel(val) : field === "end" && entry.running ? "running" : "Set time";
  return (
    <>
      <button type="button" className={`ts-trig ${val ? "" : "empty"}`} onClick={onToggle}>
        <span className="cv">{cur}</span>
        <span style={{ color: "var(--ink-3)" }}>▾</span>
      </button>
      {open && (
        <div className="ts-list ts-timelist">
          {tsTimeOpts().map((o) => (
            <button
              key={o.t}
              className={`ts-opt ${val && Math.abs(timeToH(val) - o.h) < 0.001 ? "sel" : ""}`}
              onClick={() => onPick(o.t)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

interface TsEditorProps {
  entry: TimeEntry;
  jobs: Job[];
  leads: Lead[];
  techs: Tech[];
  weekDates: string[];
  pick: TsPick;
  onSetPick: (p: TsPick) => void;
  onSetField: (field: keyof TimeEntry, val: string | number) => void;
  onClose: () => void;
}

/** The expanded editor beneath a row: type, job (if job kind), in/out times. */
function TsEditor({ entry, jobs, leads, techs, weekDates, pick, onSetPick, onSetField, onClose }: TsEditorProps) {
  return (
    <div className="ts-editor">
      <div className="ts-erow">
        <label>Type</label>
        <TsKindSeg
          entry={entry}
          onPick={(kind) => {
            onSetPick(null);
            onSetField("kind", kind);
          }}
        />
      </div>
      {entry.kind === "job" && (
        <div className="ts-erow">
          <label>Job</label>
          <div className="ts-pickwrap">
            <TsJobPicker
              entry={entry}
              jobs={jobs}
              leads={leads}
              techs={techs}
              weekDates={weekDates}
              open={pick === "job"}
              onToggle={() => onSetPick(pick === "job" ? null : "job")}
              onPick={(jobId) => {
                onSetPick(null);
                onSetField("jobId", jobId);
              }}
            />
          </div>
        </div>
      )}
      <div className="ts-erow">
        <label>Time</label>
        <div className="ts-times">
          <div className="ts-timecol">
            <div className="tl">In</div>
            <TsTimePicker
              entry={entry}
              field="start"
              open={pick === "start"}
              onToggle={() => onSetPick(pick === "start" ? null : "start")}
              onPick={(val) => {
                onSetPick(null);
                onSetField("start", val);
              }}
            />
          </div>
          <div className="ts-timecol">
            <div className="tl">Out</div>
            <TsTimePicker
              entry={entry}
              field="end"
              open={pick === "end"}
              onToggle={() => onSetPick(pick === "end" ? null : "end")}
              onPick={(val) => {
                onSetPick(null);
                onSetField("end", val);
              }}
            />
          </div>
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <button className="btn sm primary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

interface TsEntryRowProps {
  entry: TimeEntry;
  jobs: Job[];
  leads: Lead[];
  techs: Tech[];
  weekDates: string[];
  editing: boolean;
  pick: TsPick;
  onSetPick: (p: TsPick) => void;
  onEdit: () => void;
  onDelete: () => void;
  onSetField: (field: keyof TimeEntry, val: string | number) => void;
  onCloseEdit: () => void;
}

/** One entry line; expands into TsEditor when `editing`. */
function TsEntryRow({
  entry,
  jobs,
  leads,
  techs,
  weekDates,
  editing,
  pick,
  onSetPick,
  onEdit,
  onDelete,
  onSetField,
  onCloseEdit,
}: TsEntryRowProps) {
  const appr = entry.status === "approved";
  const isJob = entry.kind === "job";
  const hasJob = !!tsJob(entry, jobs);
  const timeStr = entry.running
    ? `${tsTimeLabel(entry.start)}– running`
    : entry.end
      ? `${tsTimeLabel(entry.start)}–${tsTimeLabel(entry.end)}`
      : tsTimeLabel(entry.start);
  const lbl = isJob ? (hasJob ? tsLabel(entry, jobs, leads) : "— no job —") : tsLabel(entry, jobs, leads);
  return (
    <>
      <div className={`ts-e ${appr ? "appr" : ""}${editing ? " editing" : ""}`}>
        <span className={`ts-kind ${isJob ? "job" : ""}`}>{TS_KINDS[entry.kind]}</span>
        <span className={`ts-elabel ${!isJob || !hasJob ? "muted" : ""}`}>{lbl}</span>
        <span className="ts-etime">{timeStr}</span>
        <span className="ts-ehrs">
          {entry.running ? "··" : tsHours(entry).toFixed(2)}
          {entry.kind === "break" && <span className="upd">unpaid</span>}
        </span>
        <span className="ts-eact">
          {appr ? (
            <span className="muted">✓</span>
          ) : entry.running ? (
            <span className="muted" style={{ fontSize: 11 }}>
              live
            </span>
          ) : (
            <>
              <button className="ts-del" title="Edit" onClick={onEdit}>
                ✎
              </button>
              <button className="ts-del" title="Delete entry" onClick={onDelete}>
                ✕
              </button>
            </>
          )}
        </span>
      </div>
      {editing && (
        <TsEditor
          entry={entry}
          jobs={jobs}
          leads={leads}
          techs={techs}
          weekDates={weekDates}
          pick={pick}
          onSetPick={onSetPick}
          onSetField={onSetField}
          onClose={onCloseEdit}
        />
      )}
    </>
  );
}

export interface TsEntriesBlockProps {
  entries: TimeEntry[];
  jobs: Job[];
  leads: Lead[];
  techs: Tech[];
  weekDates: string[];
  editId: string | null;
  pick: TsPick;
  onSetPick: (p: TsPick) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onSetField: (id: string, field: keyof TimeEntry, val: string | number) => void;
  onCloseEdit: () => void;
}

/** The week's entries grouped by day, each day tallied in paid hours. */
export function TsEntriesBlock({
  entries,
  jobs,
  leads,
  techs,
  weekDates,
  editId,
  pick,
  onSetPick,
  onEdit,
  onDelete,
  onSetField,
  onCloseEdit,
}: TsEntriesBlockProps) {
  const es = tsSortEntries(entries);
  if (!es.length) return <div className="empty-att">No entries this week.</div>;
  const byDay = new Map<string, TimeEntry[]>();
  es.forEach((e) => {
    const arr = byDay.get(e.date) ?? [];
    arr.push(e);
    byDay.set(e.date, arr);
  });
  const days = weekDates.filter((d) => byDay.has(d));
  return (
    <>
      {days.map((d) => {
        const dayEntries = byDay.get(d) ?? [];
        const dd = new Date(d + "T12:00:00");
        const dp = tsMoney(dayEntries.reduce((s, e) => s + tsPaid(e), 0));
        return (
          <div className="ts-day" key={d}>
            <div className="ts-dhdr">
              <span>{dd.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</span>
              <span className="num">{dp.toFixed(2)} h</span>
            </div>
            {dayEntries.map((e) => (
              <TsEntryRow
                key={e.id}
                entry={e}
                jobs={jobs}
                leads={leads}
                techs={techs}
                weekDates={weekDates}
                editing={editId === e.id}
                pick={pick}
                onSetPick={onSetPick}
                onEdit={() => onEdit(e.id)}
                onDelete={() => onDelete(e.id)}
                onSetField={(field, val) => onSetField(e.id, field, val)}
                onCloseEdit={onCloseEdit}
              />
            ))}
          </div>
        );
      })}
    </>
  );
}
