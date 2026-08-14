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
import { useGroupLabel } from "@/components/ui/input";
import { custName, liveJobs, techById } from "./jobs-helpers";
import {
  TS_KINDS,
  TS_KIND_KEYS,
  TS_TIME_OFF_KEYS,
  TS_TIME_OFF_MINUTES,
  TS_TIME_OFF_DEFAULT_MINUTES,
  tsIsTimeOffKind,
  tsMinutesLabel,
  MAX_JOB_SUGGESTIONS,
} from "./timesheet-constants";
import { SelectMenu } from "@/components/ui/select-menu";
import {
  tsJob,
  tsLabel,
  tsTimeLabel,
  tsSortEntries,
  tsMoney,
  tsPaid,
  tsJobHours,
  tsHours,
  tsTimeOpts,
  tsTechWeekJobIds,
  tsDayLabel,
  tsDayShort,
  tsIsUnfinished,
  tsIsImplausible,
  tsUnrecordedDays,
} from "./timesheet-derive";

// Which sub-picker is open inside the row editor ('job'|'start'|'end'|none).
export type TsPick = "job" | "start" | "end" | null;

interface TsKindSegProps {
  entry: TimeEntry;
  onPick: (kind: string) => void;
}

/**
 * What kind of time this row records: the four CLOCKED kinds, then time off.
 *
 * Time off is one choice rather than four more buttons, because eight in a row stops being a
 * segmented control and starts being a wall (Hick's law — and it would wrap on a narrow office
 * window). Choosing it reveals which kind, which is the only question left.
 *
 * The office needs this at all because "Techs can edit their own times" defaults OFF: on most
 * accounts this picker is the ONLY place in the product where a holiday can be recorded.
 */
function TsKindSeg({ entry, onPick }: TsKindSegProps) {
  const isOff = tsIsTimeOffKind(entry.kind);
  return (
    // A block wrapper, so the second control lands UNDER the first. Two inline-flex segments side by
    // side ran the time-off kinds off the edge of the editor and clipped "Holiday".
    <div className="ts-segstack">
      <div className="ts-seg">
        {/* A legacy travel row keeps its own option so the control shows what it IS and the office
            can move it onto a job. Nothing else is offered travel. */}
        {(entry.kind === "travel" ? ([...TS_KIND_KEYS, "travel"] as const) : TS_KIND_KEYS).map((k) => (
          <button
            key={k}
            className={entry.kind === k ? "on" : ""}
            aria-pressed={entry.kind === k}
            onClick={() => onPick(k)}
          >
            {TS_KINDS[k]}
          </button>
        ))}
        <button
          className={isOff ? "on" : ""}
          aria-pressed={isOff}
          // Lands on PTO, the commonest, so one tap records the ordinary case.
          onClick={() => onPick(isOff ? entry.kind : "pto")}
        >
          Time off
        </button>
      </div>
      {isOff ? (
        <div className="ts-seg ts-seg-sub">
          {TS_TIME_OFF_KEYS.map((k) => (
            <button
              key={k}
              className={entry.kind === k ? "on" : ""}
              aria-pressed={entry.kind === k}
              onClick={() => onPick(k)}
            >
              {TS_KINDS[k]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * How long the day off was — half-hour steps, because that is how time off is taken and paid.
 *
 * A LENGTH, not a span: there are no punch times to a day off, and inventing 8:00–16:00 for one
 * would put times in the record that nobody stood behind.
 */
function TsLengthPicker({ entry, onPick }: { entry: TimeEntry; onPick: (minutes: number) => void }) {
  const current = entry.minutes ?? TS_TIME_OFF_DEFAULT_MINUTES;
  return (
    <SelectMenu
      value={String(current)}
      // No aria-label: the editor row is a composite widget whose own label names it ("How long"),
      // the same way the Day, Type and Time rows work. Naming the control too says it twice.
      options={TS_TIME_OFF_MINUTES.map((m) => ({ value: String(m), label: tsMinutesLabel(m) }))}
      onChange={(v) => onPick(Number(v))}
    />
  );
}

interface TsDaySegProps {
  entry: TimeEntry;
  weekDates: string[];
  onPick: (date: string) => void;
}

/**
 * Which day this entry belongs to.
 *
 * Without it an entry could only ever live on the day it was created, so recording Wednesday's
 * hours on Friday was impossible — the one thing manual entry exists for. The store and the
 * server already moved an entry between days; only the control was missing.
 *
 * Constrained to the week on screen: moving an entry outside it would drop it out of view, which
 * reads as deleted. Another week is reached with the week arrows, and the entry can be moved again
 * from there.
 */
function TsDaySeg({ entry, weekDates, onPick }: TsDaySegProps) {
  return (
    <div className="ts-seg ts-dayseg">
      {weekDates.map((d) => (
        <button
          key={d}
          type="button"
          className={entry.date === d ? "on" : ""}
          aria-pressed={entry.date === d}
          onClick={() => onPick(d)}
        >
          {tsDayShort(d)}
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
            enterKeyHint="search"
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
  const cur = val
    ? tsTimeLabel(val)
    : field === "end" && entry.running
      ? "Still running"
      : "Set time";
  // An out time before the in time is not a shift, and the domain rejects it — so it is never
  // offered. Otherwise stopping a run that began at 3pm by picking 9am would fail with a generic
  // "couldn't update" toast, which tells the office nothing about what it did wrong.
  const opts =
    field === "end" ? tsTimeOpts().filter((o) => o.h > timeToH(entry.start ?? "00:00")) : tsTimeOpts();
  return (
    <>
      {/* No aria-label: the trigger's own text is the current time, which is the most
          useful thing to announce, and an aria-label would replace it. The enclosing
          row is a group named "Time" and the visible In/Out caption sits alongside. */}
      <button
        type="button"
        className={`ts-trig ${val ? "" : "empty"}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="cv">{cur}</span>
        <span style={{ color: "var(--ink-3)" }}>▾</span>
      </button>
      {open && (
        <div className="ts-list ts-timelist">
          {opts.length === 0 && (
            <div className="grp">No later time in the day — correct the in time first</div>
          )}
          {opts.map((o) => (
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

/** The expanded editor beneath a row: day, type, job (if job kind), in/out times. */
function TsEditor({ entry, jobs, leads, techs, weekDates, pick, onSetPick, onSetField, onClose }: TsEditorProps) {
  const dayGroup = useGroupLabel();
  const kindGroup = useGroupLabel();
  const jobGroup = useGroupLabel();
  const timeGroup = useGroupLabel();
  return (
    <div className="ts-editor">
      {entry.running && (
        <p className="muted" style={{ fontSize: "var(--type-sm)", margin: 0 }}>
          Still on the clock. Set an out time to stop it — this week can&rsquo;t be approved until
          every entry has one.
        </p>
      )}
      {/* Day first: it is what the entry is ABOUT, and the thing most likely to need changing on
          a row typed in after the fact. */}
      {/* Each row labels a composite widget, not one control, so the row itself is
          the group and the label names it from inside — aria-labelledby may point at
          a descendant, which keeps the markup exactly as it was. */}
      <div className="ts-erow" {...dayGroup.groupProps}>
        <label {...dayGroup.labelProps}>Day</label>
        <TsDaySeg
          entry={entry}
          weekDates={weekDates}
          onPick={(date) => {
            onSetPick(null);
            onSetField("date", date);
          }}
        />
      </div>
      <div className="ts-erow" {...kindGroup.groupProps}>
        <label {...kindGroup.labelProps}>Type</label>
        <TsKindSeg
          entry={entry}
          onPick={(kind) => {
            onSetPick(null);
            onSetField("kind", kind);
          }}
        />
      </div>
      {entry.kind === "job" && (
        <div className="ts-erow" {...jobGroup.groupProps}>
          <label {...jobGroup.labelProps}>Job</label>
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
      {tsIsTimeOffKind(entry.kind) ? (
        <div className="ts-erow" {...timeGroup.groupProps}>
          <label {...timeGroup.labelProps}>How long</label>
          <div className="ts-lenwrap">
            <TsLengthPicker entry={entry} onPick={(m) => onSetField("minutes", m)} />
          </div>
        </div>
      ) : (
      <div className="ts-erow" {...timeGroup.groupProps}>
        <label {...timeGroup.labelProps}>Time</label>
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
      )}
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
  onStop: () => void;
  onDelete: () => void;
  onSetField: (field: keyof TimeEntry, val: string | number) => void;
  onCloseEdit: () => void;
}

/**
 * The row's controls. A running entry used to be inert here — no edit, no delete, no way to end it —
 * so a technician who forgot to clock out could not be fixed by anyone. Stop opens the row's
 * out-time picker: the office sets the real end time, nobody invents one. Approved rows carry no
 * controls at all, because approved means locked.
 */
function TsRowActions({
  entry,
  onEdit,
  onStop,
  onDelete,
}: Pick<TsEntryRowProps, "entry" | "onEdit" | "onStop" | "onDelete">) {
  if (entry.status === "approved") {
    return (
      <span className="ts-eact">
        <span className="muted">✓</span>
      </span>
    );
  }
  // Every action here MUST stop propagation: the whole row now opens the editor, so without this a
  // click on Stop or Delete would also toggle the editor — two things happening from one tap, one of
  // them unasked for.
  const only = (handler: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    handler();
  };

  return (
    <span className={`ts-eact${entry.running ? " live" : ""}`}>
      {entry.running ? (
        <button className="btn sm" onClick={only(onStop)}>
          Stop
        </button>
      ) : (
        <button className="ts-del" title="Edit" onClick={only(onEdit)}>
          ✎
        </button>
      )}
      <button className="ts-del" title="Delete entry" onClick={only(onDelete)}>
        ✕
      </button>
    </span>
  );
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
  onStop,
  onDelete,
  onSetField,
  onCloseEdit,
}: TsEntryRowProps) {
  const appr = entry.status === "approved";
  const isJob = entry.kind === "job";
  const hasJob = !!tsJob(entry, jobs);
  const isOff = tsIsTimeOffKind(entry.kind);
  // A day off has no punch times, so the time column says what it IS rather than rendering "—–—".
  const timeStr = isOff
    ? "paid time off"
    : entry.running
      ? `${tsTimeLabel(entry.start)}– running`
      : entry.end
        ? `${tsTimeLabel(entry.start)}–${tsTimeLabel(entry.end)}`
        : tsTimeLabel(entry.start);
  const lbl = isJob ? (hasJob ? tsLabel(entry, jobs, leads) : "— no job —") : tsLabel(entry, jobs, leads);
  // Mirrors the panel's own rule for opening the editor: an APPROVED row is locked (reopen first).
  // A running row is editable here — stopping one is exactly what the office needs to do.
  const canOpen = !appr;
  return (
    <>
      {/*
        The WHOLE ROW opens the editor, not just the pencil. A 14px icon is a far smaller target
        than the row it sits on (Fitts's Law), and the row is what a person reaches for — the pencil
        stays as the explicit affordance, so the intent is still visible.

        House .rowopen pattern: the container keeps the MOUSE handler and takes no role/tabIndex,
        while a focusable child button carries keyboard access. A clickable div wrapping buttons
        would be a nested-interactive a11y violation, and axe is an enforcing gate here.
      */}
      <div
        className={`ts-e ${appr ? "appr" : ""}${editing ? " editing" : ""}${canOpen ? " rowclick" : ""}`}
        onClick={canOpen ? onEdit : undefined}
      >
        <span className={`ts-kind ${isJob ? "job" : ""}`}>{TS_KINDS[entry.kind]}</span>
        {canOpen ? (
          <button
            type="button"
            className={`ts-elabel rowopen ${!isJob || !hasJob ? "muted" : ""}`}
            aria-label={`Edit ${TS_KINDS[entry.kind]} entry, ${timeStr}`}
            aria-expanded={editing}
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
          >
            {lbl}
          </button>
        ) : (
          <span className={`ts-elabel ${!isJob || !hasJob ? "muted" : ""}`}>{lbl}</span>
        )}
        <span className="ts-etime">{timeStr}</span>
        <span className="ts-ehrs">
          {entry.running ? "··" : tsHours(entry).toFixed(2)}
          {entry.kind === "break" && <span className="upd">unpaid</span>}
          {/* A finished row too long to be a measurement — most often a break left running, which
              silently short-pays the tech for the whole afternoon and which nothing else in the
              system objects to. Flagged, never auto-corrected. */}
          {tsIsImplausible(entry) && (
            <span className="upd" title="This looks too long to be right — check it before approving">
              check
            </span>
          )}
        </span>
        <TsRowActions entry={entry} onEdit={onEdit} onStop={onStop} onDelete={onDelete} />
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
  /** Whose week this is — needed to spot scheduled days with no entries at all. */
  techId: string;
  jobs: Job[];
  leads: Lead[];
  techs: Tech[];
  weekDates: string[];
  editId: string | null;
  pick: TsPick;
  onSetPick: (p: TsPick) => void;
  onEdit: (id: string) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
  onSetField: (id: string, field: keyof TimeEntry, val: string | number) => void;
  onCloseEdit: () => void;
}

interface TsDayGroupProps extends Omit<TsEntriesBlockProps, "entries" | "techId"> {
  date: string;
  dayEntries: TimeEntry[];
}

/** One day: its header tally, then its rows — or the fact that nothing was recorded. */
function TsDayGroup({
  date,
  dayEntries,
  jobs,
  leads,
  techs,
  weekDates,
  editId,
  pick,
  onSetPick,
  onEdit,
  onStop,
  onDelete,
  onSetField,
  onCloseEdit,
}: TsDayGroupProps) {
  const paid = tsMoney(dayEntries.reduce((s, e) => s + tsPaid(e), 0));
  // The two figures this screen exists to keep apart: what the day PAYS, and how much of it any
  // job can be charged for. They are read by different systems — the total goes to payroll, the job
  // share feeds costing — and a day where they diverge is a day nobody attributed.
  const onJobs = tsJobHours(dayEntries);
  const unfinished = dayEntries.some((e) => e.status !== "approved" && tsIsUnfinished(e));
  return (
    <div className="ts-day">
      <div className="ts-dhdr">
        <span>{tsDayLabel(date, "long")}</span>
        <span className="num">
          {paid.toFixed(2)} h
          <span className="ts-onjobs">
            {onJobs > 0 ? `${onJobs.toFixed(2)} on jobs` : "none on jobs"}
          </span>
          {/* Say WHY this day's total is short, on the day itself — the refusal above names the
              same days, and this is where the office has to act. */}
          {unfinished && (
            <span style={{ color: "var(--amber)", marginLeft: "var(--space-2)" }}>
              needs an end time
            </span>
          )}
        </span>
      </div>
      {dayEntries.length === 0 ? (
        <div className="ts-e">
          <span className="ts-elabel muted">No hours recorded</span>
        </div>
      ) : (
        dayEntries.map((e) => (
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
            onStop={() => onStop(e.id)}
            onDelete={() => onDelete(e.id)}
            onSetField={(field, val) => onSetField(e.id, field, val)}
            onCloseEdit={onCloseEdit}
          />
        ))
      )}
    </div>
  );
}

/** The week's entries grouped by day, each day tallied in paid hours. */
export function TsEntriesBlock({ entries, techId, ...rest }: TsEntriesBlockProps) {
  const byDay = new Map<string, TimeEntry[]>();
  tsSortEntries(entries).forEach((e) => {
    byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  });

  // A scheduled day with nothing recorded gets a day of its own. Rendering only the days that have
  // rows would hide it completely, and a missing day looks exactly like a day off.
  const unrecorded = new Set(tsUnrecordedDays(rest.jobs, techId, rest.weekDates, entries));
  const days = rest.weekDates.filter((d) => byDay.has(d) || unrecorded.has(d));
  if (days.length === 0) return <div className="empty-att">No entries this week.</div>;

  return (
    <>
      {days.map((d) => (
        <TsDayGroup key={d} date={d} dayEntries={byDay.get(d) ?? []} {...rest} />
      ))}
    </>
  );
}
