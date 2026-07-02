"use client";

/**
 * Jobs page — pixel-faithful port of the prototype's vJobs / vSchedule / vOpsHome / vTimesheets.
 * Reads live data from the Zustand store (jobs / techs / leads) so job-modal mutations
 * reflect reactively. All interactive actions not yet wired are console-logged stubs.
 */

import { useState } from "react";
import { TODAY_ISO, dPlus } from "@/lib/prototype-sample";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { Job, Lead, Tech, Visit } from "@/lib/store/types";

// ---- helpers ported from prototype ----------------------------------------

const JST: Record<string, { l: string; c: string; bg: string }> = {
  unscheduled: { l: "Unscheduled", c: "var(--amber)", bg: "var(--amber-bg)" },
  scheduled: { l: "Scheduled", c: "var(--ink-2)", bg: "var(--paper)" },
  enroute: { l: "On the way", c: "var(--ink-2)", bg: "var(--paper)" },
  onsite: { l: "On site", c: "var(--green-700)", bg: "var(--green-50)" },
  done: { l: "Done", c: "var(--ink-3)", bg: "var(--paper)" },
};

interface SvcMeta { lbl: string; word: string; tag: string; edge: string; c: string; est?: boolean }

const SVC_META: Record<string, SvcMeta> = {
  estimate: { lbl: "Estimate", word: "Estimate", tag: "Est", edge: "var(--amber)", c: "var(--amber)", est: true },
  service: { lbl: "Price on site", word: "Job", tag: "Job", edge: "#9C5B34", c: "#9C5B34" },
  install: { lbl: "Priced", word: "Job", tag: "Job", edge: "#4A639E", c: "#4A639E" },
};

/** Always returns a valid SvcMeta — falls back to service */
function svcMeta(key: string): SvcMeta {
  return SVC_META[key] ?? (SVC_META.service as SvcMeta);
}

function jobTotal(j: Job): number {
  return (j.lines ?? []).reduce((s, l) => s + (l.q ?? 1) * (l.r ?? 0), 0);
}

function jobNextVisit(j: Job): Visit | null {
  const placed = (j.visits ?? []).filter((v) => v.date && v.techId != null && v.start != null);
  const future = placed.filter((v) => (v.date ?? "") >= TODAY_ISO);
  if (future.length) {
    return future.sort((a, b) =>
      (a.date ?? "") > (b.date ?? "") ? 1 : (a.date ?? "") < (b.date ?? "") ? -1 : (a.start ?? 0) - (b.start ?? 0)
    )[0] as Visit;
  }
  return placed.sort((a, b) => ((a.date ?? "") > (b.date ?? "") ? 1 : -1))[0] ?? null;
}

function custName(j: Job, leads: Lead[]): string {
  const lead = leads.find((l) => l.id === j.leadId);
  return lead?.name ?? (j as { cust?: string }).cust ?? "—";
}

function custPhone(j: Job, leads: Lead[]): string {
  return j.phone || leads.find((l) => l.id === j.leadId)?.phone || "";
}

function timeLabel(h: number): string {
  const hour = Math.floor(h);
  const min = Math.round((h - hour) * 60);
  const period = hour < 12 ? "a" : "p";
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return min > 0 ? `${displayHour}:${min.toString().padStart(2, "0")}${period}` : `${displayHour}${period}`;
}

function hmLabel(h: number): string {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  if (!hrs && mins) return `${mins}m`;
  if (!mins) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

function colLabel(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function fmt$(n: number): string {
  return "$" + n.toLocaleString("en-US");
}

function liveJobs(jobs: Job[]): Job[] {
  return jobs.filter((j) => !j.archived);
}

function jobsUnscheduled(jobs: Job[]): Job[] {
  return liveJobs(jobs).filter(
    (j) =>
      j.status !== "done" &&
      ((j.visits ?? []).length === 0 || (j.visits ?? []).some((v) => !(v.date && v.techId != null && v.start != null)))
  );
}

function visitsToday(jobs: Job[]): Array<{ j: Job; v: Visit }> {
  const out: Array<{ j: Job; v: Visit }> = [];
  liveJobs(jobs).forEach((j) =>
    (j.visits ?? []).forEach((v) => {
      if (v.date === TODAY_ISO) out.push({ j, v });
    })
  );
  return out;
}

function dayLoad(jobs: Job[], techId: number, iso: string): number {
  let total = 0;
  liveJobs(jobs).forEach((j) =>
    (j.visits ?? []).forEach((v) => {
      if (v.techId === techId && v.date === iso) total += v.dur ?? 0;
    })
  );
  return total;
}

function techById(techs: Tech[], id: number): Tech | undefined {
  return techs.find((t) => t.id === id);
}

function jobMode(j: Job): string {
  if (j.svc === "estimate") return "estimate";
  const priced = (j.lines ?? []).some((l) => (l.q ?? 1) * (l.r ?? 0) > 0);
  return priced ? "install" : "service";
}

// ---- sub-tab types ---------------------------------------------------------

type JobsSubTab = "jobs" | "schedule" | "today" | "timesheets";

const SUB_TABS: Array<{ id: JobsSubTab; label: string }> = [
  { id: "jobs", label: "Jobs" },
  { id: "schedule", label: "Schedule" },
  { id: "today", label: "Today" },
  { id: "timesheets", label: "Timesheets" },
];

// ---- stubs -----------------------------------------------------------------

function stub(action: string, ...args: unknown[]) {
  // eslint-disable-next-line no-console
  console.log(`[stub] ${action}`, ...args);
}

// ============================================================================
// vJobs — jobs list panel
// ============================================================================

interface JobsListProps {
  onOpenJob: (id: number) => void;
  onOpenNewJob: () => void;
  onOpenSweep: () => void;
}

function JobsList({ onOpenJob, onOpenNewJob, onOpenSweep }: JobsListProps) {
  const jobs = useAppStore((s) => s.jobs);
  const leads = useAppStore((s) => s.leads);
  const techs = useAppStore((s) => s.techs);

  const [jobsQ, setJobsQ] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  const [jobFilters, setJobFilters] = useState({ status: "", type: "", crew: "" });
  const [jobSort, setJobSort] = useState<{ col: string | null; dir: number }>({ col: null, dir: 1 });
  const [visibleCols, setVisibleCols] = useState(["customer", "job", "next", "crew", "status", "amount"]);

  const colDefs: Record<string, { l: string; right?: boolean }> = {
    customer: { l: "Customer" },
    job: { l: "Job" },
    type: { l: "Type" },
    next: { l: "Next visit" },
    crew: { l: "Crew" },
    status: { l: "Status" },
    address: { l: "Address" },
    phone: { l: "Phone" },
    amount: { l: "Amount", right: true },
  };

  const all = liveJobs(jobs);
  const q = jobsQ.toLowerCase();
  const { status: fStatus, type: fType, crew: fCrew } = jobFilters;
  const activeF = [fStatus, fType, fCrew].filter(Boolean).length;

  let rows = all.filter((j) => {
    if (q && !(custName(j, leads) + " " + (j.title ?? "") + " " + (j.addr ?? "") + " " + custPhone(j, leads)).toLowerCase().includes(q))
      return false;
    if (fStatus && j.status !== fStatus) return false;
    if (fType && jobMode(j) !== fType) return false;
    if (fCrew && !(j.visits ?? []).some((v) => String(v.techId) === fCrew)) return false;
    return true;
  });

  if (jobSort.col === "customer") rows = [...rows].sort((a, b) => custName(a, leads).localeCompare(custName(b, leads)) * jobSort.dir);
  else if (jobSort.col === "amount") rows = [...rows].sort((a, b) => (jobTotal(a) - jobTotal(b)) * jobSort.dir);
  else if (jobSort.col === "next") {
    rows = [...rows].sort((a, b) => {
      const ka = (() => { const nv = jobNextVisit(a); return nv ? (nv.date ?? "") + String(nv.start ?? 0).padStart(6, "0") : "~"; })();
      const kb = (() => { const nv = jobNextVisit(b); return nv ? (nv.date ?? "") + String(nv.start ?? 0).padStart(6, "0") : "~"; })();
      return ka < kb ? -jobSort.dir : ka > kb ? jobSort.dir : 0;
    });
  } else {
    rows = [...rows].sort((a, b) => (a.status === "unscheduled" ? -1 : 0) - (b.status === "unscheduled" ? -1 : 0));
  }

  function toggleCol(k: string) {
    setVisibleCols((prev) => {
      if (prev.includes(k)) return prev.filter((c) => c !== k);
      const order = Object.keys(colDefs);
      return order.filter((c) => prev.includes(c) || c === k);
    });
  }

  function sortBy(col: string) {
    setJobSort((prev) => ({ col, dir: prev.col === col ? prev.dir * -1 : 1 }));
  }

  function arrow(col: string) {
    if (jobSort.col !== col) return "";
    return jobSort.dir === 1 ? " ▲" : " ▼";
  }

  const statuses = [...new Set(all.map((j) => j.status))];
  const sortable = ["customer", "next", "amount"];

  function renderCell(j: Job, c: string): React.ReactNode {
    const nv = jobNextVisit(j);
    switch (c) {
      case "customer":
        return <b>{custName(j, leads)}</b>;
      case "job": {
        const multi = (j.visits ?? []).length > 1;
        return (
          <>
            {j.title}
            {multi && (
              <span className="pill" style={{ background: "var(--purple-bg)", color: "var(--purple)", marginLeft: 6 }}>
                {j.visits.length} visits
              </span>
            )}
          </>
        );
      }
      case "type": {
        const m = svcMeta(jobMode(j));
        return (
          <span style={{ fontSize: "10.5px", fontWeight: 800, textTransform: "uppercase", letterSpacing: ".04em", color: m.c }}>
            {m.lbl}
          </span>
        );
      }
      case "next":
        return nv ? `${colLabel(nv.date ?? "")} ${timeLabel(nv.start ?? 0)}` : <span className="muted">—</span>;
      case "crew": {
        const tc = nv && nv.techId != null ? techById(techs, nv.techId) : null;
        return tc ? (
          <span className="javatar" style={{ background: tc.color }}>
            {tc.initials}
          </span>
        ) : (
          <span className="muted">—</span>
        );
      }
      case "status": {
        const s = JST[j.status] ?? { l: j.status, c: "var(--ink-2)", bg: "var(--paper)" };
        return (
          <span className="stpill" style={{ color: s.c, background: s.bg }}>
            {s.l}
          </span>
        );
      }
      case "address":
        return j.addr || leads.find((l) => l.id === j.leadId)?.address || <span className="muted">—</span>;
      case "phone":
        return custPhone(j, leads) || <span className="muted">—</span>;
      case "amount":
        return fmt$(jobTotal(j));
      default:
        return null;
    }
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h1>Jobs</h1>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn ghost" onClick={() => stub("openStandards")}>
            Checklist templates
          </button>
          <button className="btn ghost" onClick={onOpenSweep}>
            Clean up
          </button>
          <button className="btn primary" onClick={onOpenNewJob}>
            + New job
          </button>
        </div>
      </div>
      <div className="sub">Every job, sold → done.</div>

      <div className="toolbar">
        <input
          type="text"
          id="jbQ"
          placeholder="Search customer, job, address, phone…"
          value={jobsQ}
          onChange={(e) => setJobsQ(e.target.value)}
        />
        <button
          className={`btn ${filtersOpen || activeF ? "" : "ghost"}`}
          onClick={() => setFiltersOpen((v) => !v)}
        >
          Filters
          {activeF > 0 && (
            <span className="pill amber" style={{ marginLeft: 2 }}>
              {activeF}
            </span>
          )}
        </button>
        <button className="btn ghost" onClick={() => setColsOpen((v) => !v)}>
          Columns ▾
        </button>
        <span className="muted" style={{ marginLeft: "auto" }}>
          {rows.length} of {all.length}
        </span>
      </div>

      {colsOpen && (
        <div className="fpanel" style={{ gap: 8 }}>
          {Object.entries(colDefs).map(([k, d]) => (
            <label key={k} className="colchk">
              <input type="checkbox" checked={visibleCols.includes(k)} onChange={() => toggleCol(k)} />
              {d.l}
            </label>
          ))}
        </div>
      )}

      {filtersOpen && (
        <div className="fpanel">
          <div className="field">
            <label>Status</label>
            <select value={fStatus} onChange={(e) => setJobFilters((p) => ({ ...p, status: e.target.value }))}>
              <option value="">Any</option>
              {statuses.map((st) => (
                <option key={st} value={st}>
                  {JST[st]?.l ?? st}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Type</label>
            <select value={fType} onChange={(e) => setJobFilters((p) => ({ ...p, type: e.target.value }))}>
              <option value="">Any</option>
              {(["estimate", "service", "install"] as const).map((t) => (
                <option key={t} value={t}>
                  {svcMeta(t).lbl}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Crew</label>
            <select value={fCrew} onChange={(e) => setJobFilters((p) => ({ ...p, crew: e.target.value }))}>
              <option value="">Any</option>
              {techs.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span
              className="linklike"
              onClick={() => {
                setJobFilters({ status: "", type: "", crew: "" });
                setJobsQ("");
              }}
            >
              Clear all
            </span>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: "6px 14px" }}>
        <table>
          <thead>
            <tr>
              {visibleCols.map((c) => {
                const def = colDefs[c];
                if (!def) return null;
                const so = sortable.includes(c);
                return (
                  <th
                    key={c}
                    className={so ? "sortable" : ""}
                    style={def.right ? { textAlign: "right" } : undefined}
                    onClick={so ? () => sortBy(c) : undefined}
                  >
                    {def.l}
                    {so ? arrow(c) : ""}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length > 0 ? (
              rows.map((j) => (
                <tr key={j.id} className="clickable" onClick={() => onOpenJob(j.id)}>
                  {visibleCols.map((c) => {
                    const def = colDefs[c];
                    if (!def) return null;
                    return (
                      <td key={c} style={def.right ? { textAlign: "right", fontWeight: 700 } : undefined}>
                        {renderCell(j, c)}
                      </td>
                    );
                  })}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={visibleCols.length}>
                  <div className="empty-att">
                    {all.length ? (
                      <>
                        Nothing matches —{" "}
                        <span
                          className="linklike"
                          onClick={() => {
                            setJobFilters({ status: "", type: "", crew: "" });
                            setJobsQ("");
                          }}
                        >
                          clear the filters
                        </span>
                      </>
                    ) : (
                      <>
                        No jobs yet —{" "}
                        <span className="linklike" onClick={onOpenNewJob}>
                          create one
                        </span>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ============================================================================
// vSchedule — schedule panel (Day + Week views)
// ============================================================================

type SchedView = "day" | "week";

function SchedulePanel() {
  const openModal = useOpenModal();
  const jobs = useAppStore((s) => s.jobs);
  const leads = useAppStore((s) => s.leads);
  const techs = useAppStore((s) => s.techs);

  const [schedView, setSchedView] = useState<SchedView>("day");
  const [schedDay, setSchedDay] = useState(TODAY_ISO);
  const [weekStart, setWeekStart] = useState(TODAY_ISO);

  function weekDates(): string[] {
    const out: string[] = [];
    for (let i = 0; i < 7; i++) out.push(dPlus(i));
    return out;
  }

  const WPX = 78;
  const CAP = 8;

  function DayView() {
    const iso = schedDay;
    const bh = { o: 8, c: 17 }; // default business hours
    let START = bh.o;
    let END = bh.c;

    // expand window to include all visits
    jobs.forEach((j) =>
      (j.visits ?? []).forEach((v) => {
        if (v.date === iso && v.start != null) {
          START = Math.min(START, Math.floor(v.start));
          END = Math.max(END, Math.ceil(v.start + (v.dur ?? 1)));
        }
      })
    );
    START = Math.max(0, Math.min(START, 11));
    END = Math.min(24, Math.max(END, START + 2));

    const hours: number[] = [];
    for (let h = START; h < END; h++) hours.push(h);
    const laneW = (END - START) * WPX;

    return (
      <div className="gv-scroll">
        {/* header row */}
        <div className="gv-row gv-head">
          <div className="gv-name">
            <span className="muted" style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em" }}>
              Crew
            </span>
          </div>
          <div className="gv-lane" style={{ width: laneW, height: 24, position: "relative" }}>
            {hours.concat([END]).map((h) => (
              <div key={h} className="gv-hh" style={{ left: (h - START) * WPX }}>
                {timeLabel(h)}
              </div>
            ))}
          </div>
        </div>

        {/* crew rows */}
        {techs.map((tc) => {
          const vis = liveJobs(jobs)
            .flatMap((j) => (j.visits ?? []).filter((v) => v.techId === tc.id && v.date === iso).map((v) => ({ j, v })))
            .sort((a, b) => (a.v.start ?? 0) - (b.v.start ?? 0));

          const load = dayLoad(jobs, tc.id, iso);

          return (
            <div key={tc.id} className="gv-row">
              <div className="gv-name">
                <span className="javatar" style={{ background: "var(--green-100)", color: "var(--ink-2)" }}>
                  {tc.initials}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="gv-nm">{tc.name.split(" ")[0]}</div>
                  <div className={`cellload${load > CAP ? " over" : load > CAP * 0.8 ? " full" : ""}`} style={{ textAlign: "left" }}>
                    {load ? `${hmLabel(load)} / ${CAP}h` : "free"}
                  </div>
                </div>
              </div>
              <div className="gv-lane" style={{ width: laneW, height: 58, position: "relative" }}>
                {/* drop cells */}
                {hours.map((h) => (
                  <div
                    key={h}
                    className="gv-cell"
                    style={{ left: (h - START) * WPX, width: WPX, position: "absolute", top: 0, bottom: 0 }}
                    onClick={() => stub("cellTap", tc.id, iso, h)}
                  />
                ))}
                {/* visit blocks */}
                {vis.map(({ j, v }) => {
                  const vStart = v.start ?? 0;
                  const left = Math.max(0, (vStart - START) * WPX);
                  const w = Math.max(38, (v.dur ?? 1) * WPX - 4);
                  const mode = jobMode(j);
                  const m = svcMeta(mode);
                  return (
                    <div
                      key={v.id}
                      className={`gv-block${m.est ? " est" : ""}`}
                      style={{ left, width: w, opacity: v.status === "done" ? 0.55 : 1 }}
                      onClick={(e) => { e.stopPropagation(); openModal(MODAL.JOB, { jobId: j.id }); }}
                      title={`${custName(j, leads)} — ${j.title} · ${timeLabel(vStart)}–${timeLabel(vStart + (v.dur ?? 0))}`}
                    >
                      <div className="gv-bt" style={{ color: m.c }}>
                        {m.word ?? m.tag}
                        {v.status === "done" ? " ✓" : ""}
                      </div>
                      <div className="gv-bn">{custName(j, leads)}</div>
                      <div className="gv-btm">
                        {timeLabel(vStart)}–{timeLabel(vStart + (v.dur ?? 0))}
                      </div>
                      <div className="gv-resize" onMouseDown={() => stub("blockResizeStart", v.id)} title="Drag to change the hours" />
                      <button
                        className="gv-addv"
                        onClick={(e) => { e.stopPropagation(); stub("visitCloneArm", j.id, v.id); }}
                        title="Add another visit — same job, another day"
                      >
                        +
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function WeekView() {
    const days = weekDates();

    return (
      <div
        className="wk-overview"
        style={{ display: "grid", gridTemplateColumns: `repeat(${days.length}, minmax(0,1fr))`, gap: 8 }}
      >
        {days.map((iso) => {
          const entries = liveJobs(jobs)
            .flatMap((j) =>
              (j.visits ?? [])
                .filter((v) => v.date === iso)
                .map((v) => ({ j, v, techId: v.techId }))
            )
            .sort((a, b) => (a.v.start ?? 0) - (b.v.start ?? 0));

          const totalLoad = techs.reduce((s, tc) => s + dayLoad(jobs, tc.id, iso), 0);
          const dayCap = CAP * techs.length;

          const body =
            entries.length === 0 ? (
              <div className="wk-empty">—</div>
            ) : (
              entries.map(({ j, v, techId }) => {
                const vStart = v.start ?? 0;
                const mode = jobMode(j);
                const m = svcMeta(mode);
                const tc = techId != null ? techById(techs, techId) : undefined;
                return (
                  <div
                    key={v.id}
                    className={`wk-item${m.est ? " est" : ""}`}
                    style={{ opacity: v.status === "done" ? 0.55 : 1 }}
                    onClick={(e) => { e.stopPropagation(); openModal(MODAL.JOB, { jobId: j.id }); }}
                  >
                    <div className="wk-bt" style={{ color: m.c }}>
                      {m.word ?? m.lbl}
                    </div>
                    <div className="wk-nm">{custName(j, leads)}</div>
                    <div className="wk-tm">
                      {timeLabel(vStart)}–{timeLabel(vStart + (v.dur ?? 0))}
                      {tc ? ` · ${tc.name.split(" ")[0]}` : ""}
                    </div>
                  </div>
                );
              })
            );

          return (
            <div key={iso} className="wk-col">
              <div
                className={`wk-head${iso === TODAY_ISO ? " today" : ""}`}
                onClick={() => { setSchedView("day"); setSchedDay(iso); }}
                title="Open this day to place by crew + hour"
              >
                {colLabel(iso)}
                <span className={`cellload${totalLoad > dayCap ? " over" : totalLoad > dayCap * 0.8 ? " full" : ""}`}>
                  {totalLoad ? hmLabel(totalLoad) : ""}
                </span>
              </div>
              <div className="wk-body">{body}</div>
            </div>
          );
        })}
      </div>
    );
  }

  const uns = jobsUnscheduled(jobs);
  const day = schedView === "day";

  const toggle = (
    <div style={{ display: "inline-flex", border: "1.5px solid var(--line)", borderRadius: 9, overflow: "hidden" }}>
      <button
        className={`btn sm ${day ? "primary" : "ghost"}`}
        style={{ border: "none", borderRadius: 0 }}
        onClick={() => setSchedView("day")}
      >
        Day
      </button>
      <button
        className={`btn sm ${!day ? "primary" : "ghost"}`}
        style={{ border: "none", borderRadius: 0 }}
        onClick={() => setSchedView("week")}
      >
        Week
      </button>
    </div>
  );

  function addDaysLocal(iso: string, n: number): string {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  const nav = day ? (
    <>
      <button className="btn sm ghost" onClick={() => setSchedDay((d) => addDaysLocal(d, -1))}>
        ‹ Prev
      </button>
      <b style={{ fontSize: 13 }}>
        {schedDay === TODAY_ISO ? "Today" : colLabel(schedDay)} ·{" "}
        {new Date(schedDay + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </b>
      <button className="btn sm ghost" onClick={() => setSchedDay((d) => addDaysLocal(d, 1))}>
        Next ›
      </button>
      {schedDay !== TODAY_ISO && (
        <span className="linklike" onClick={() => setSchedDay(TODAY_ISO)}>
          jump to today
        </span>
      )}
    </>
  ) : (
    <>
      <button className="btn sm ghost" onClick={() => setWeekStart((w) => addDaysLocal(w, -7))}>
        ‹ Prev
      </button>
      <b style={{ fontSize: 13 }}>{weekStart === TODAY_ISO ? "This week" : `Week of ${colLabel(weekStart)}`}</b>
      <button className="btn sm ghost" onClick={() => setWeekStart((w) => addDaysLocal(w, 7))}>
        Next ›
      </button>
      {weekStart !== TODAY_ISO && (
        <span className="linklike" onClick={() => setWeekStart(TODAY_ISO)}>
          jump to today
        </span>
      )}
    </>
  );

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h1>Schedule</h1>
        <button className="btn" onClick={() => openModal(MODAL.NEW_JOB)}>
          + New job
        </button>
      </div>

      {/* To-schedule tray */}
      {uns.length > 0 ? (
        <div className="rail" style={{ marginBottom: 14 }}>
          <b style={{ fontSize: 13 }}>
            To schedule <span className="muted" style={{ fontWeight: 600 }}>· {uns.length}</span>
          </b>
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 8 }}>
            {uns.map((j) => {
              const mode = jobMode(j);
              const m = svcMeta(mode);
              const totalHrs = (j.visits ?? []).filter((v) => !(v.date && v.techId != null)).reduce((s, v) => s + (v.dur ?? 0), 0) || 2;
              return (
                <div key={j.id} className="railjob place" title="Drag onto the board, or tap Schedule then a slot">
                  <button className="rail-addv" onClick={(e) => { e.stopPropagation(); stub("visitAddTray", j.id); }} title="Add another visit">
                    +
                  </button>
                  <b style={{ fontSize: "13.5px" }}>{custName(j, leads)}</b>
                  <div className="muted" style={{ fontSize: "11.5px", margin: "2px 0 10px" }}>{j.title}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: m.c }}>
                      {m.lbl}
                    </span>
                    <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{hmLabel(totalHrs)}</span>
                  </div>
                  <div style={{ display: "flex", gap: 7 }}>
                    <button className="btn primary sm" style={{ flex: 1, justifyContent: "center" }} onClick={(e) => { e.stopPropagation(); stub("toPlaceArm", j.id); }}>
                      Schedule
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rail" style={{ background: "var(--green-50)", borderColor: "#DDD7C9", marginBottom: 14 }}>
          <b style={{ fontSize: 13 }}>Everything sold is scheduled.</b>
        </div>
      )}

      <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--ink-3)", margin: "2px 0 8px" }}>
        On the board
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
        {toggle}
        <span style={{ width: 6 }} />
        {nav}
      </div>

      {day ? <DayView /> : <WeekView />}
    </>
  );
}

// ============================================================================
// vOpsHome — today's run panel
// ============================================================================

function TodayPanel() {
  const openModal = useOpenModal();
  const jobs = useAppStore((s) => s.jobs);
  const leads = useAppStore((s) => s.leads);
  const techs = useAppStore((s) => s.techs);

  const tv = visitsToday(jobs);
  const done = tv.filter(({ v }) => v.status === "done");
  const live = tv.filter(({ v }) => v.status === "enroute" || v.status === "onsite");
  const uns = jobsUnscheduled(jobs);

  const byTech = techs.map((tc) => ({
    tc,
    vs: liveJobs(jobs)
      .flatMap((j) => (j.visits ?? []).filter((v) => v.techId === tc.id && v.date === TODAY_ISO).map((v) => ({ j, v })))
      .sort((a, b) => (a.v.start ?? 0) - (b.v.start ?? 0)),
  })).filter(({ vs }) => vs.length > 0);

  return (
    <>
      <h1>Today's run</h1>
      <div className="sub">Rivera Plumbing — today's work.</div>

      <div className="ops-grid">
        <div className="kpi" onClick={() => stub("go", "ops-schedule")}>
          <div className="lbl">Visits today</div>
          <div className="val">{tv.length}</div>
          <div className="hint">{live.length} in progress</div>
        </div>
        <div
          className={`kpi${uns.length ? "" : ""}`}
          style={uns.length ? { borderColor: "var(--manila-line)", background: "var(--manila)" } : undefined}
          onClick={() => stub("go", "ops-schedule")}
        >
          <div className="lbl">Need scheduling</div>
          <div className="val" style={uns.length ? { color: "var(--amber)" } : undefined}>
            {uns.length}
          </div>
          <div className="hint">sold, no slot yet</div>
        </div>
        <div className="kpi">
          <div className="lbl">Done today</div>
          <div className="val">{done.length}</div>
          <div className="hint">of {tv.length}</div>
        </div>
        <div className="kpi">
          <div className="lbl">Crew working</div>
          <div className="val">{byTech.length}</div>
          <div className="hint">of {techs.length}</div>
        </div>
      </div>

      {uns.length > 0 && (
        <div className="rail" style={{ marginBottom: 14 }}>
          <b style={{ fontSize: 13 }}>
            ⚠ {uns.length} sold job{uns.length === 1 ? "" : "s"} still need a slot
          </b>{" "}
          — the hole every other tool leaves open.{" "}
          <span className="linklike" onClick={() => stub("go", "ops-schedule")}>
            Open the schedule →
          </span>
          <div style={{ marginTop: 8 }}>
            {uns.map((j) => (
              <span
                key={j.id}
                className="pill"
                style={{ background: "#fff", border: "1px solid var(--line)", marginRight: 6, cursor: "pointer" }}
                onClick={() => openModal(MODAL.JOB, { jobId: j.id })}
              >
                {custName(j, leads)} · {j.title}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <h3>The day, by crew</h3>
        {byTech.length > 0 ? (
          byTech.map(({ tc, vs }) => (
            <div key={tc.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
              <span className="javatar" style={{ background: tc.color, width: 30, height: 30, fontSize: 11 }}>
                {tc.initials}
              </span>
              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 13 }}>{tc.name}</b>
                {vs.map(({ j, v }) => {
                  const s = JST[v.status] ?? { l: v.status, c: "var(--ink-2)", bg: "var(--paper)" };
                  const mode = jobMode(j);
                  const m = svcMeta(mode);
                  return (
                    <div key={v.id} style={{ display: "flex", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--line-2)", alignItems: "center" }}>
                      <span className="agtime">{timeLabel(v.start ?? 0)}</span>
                      <div style={{ flex: 1 }}>
                        <b style={{ fontWeight: 600, fontSize: 13 }}>{custName(j, leads)}</b>
                        <div className="muted" style={{ fontSize: 12 }}>{j.title}</div>
                      </div>
                      <span className="stpill" style={{ color: s.c, background: s.bg }}>
                        {s.l}
                      </span>
                      <button className="btn sm" onClick={() => openModal(MODAL.JOB, { jobId: j.id })}>
                        Open
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        ) : (
          <div className="empty-att">
            Nothing scheduled today. Win a quote in Customer and it lands in "Need scheduling".
          </div>
        )}
      </div>
    </>
  );
}

// ============================================================================
// vTimesheets — timesheets panel
// ============================================================================

function TimesheetsPanel() {
  const techs = useAppStore((s) => s.techs);
  const [selectedTechId, setSelectedTechId] = useState<number>(techs[0]?.id ?? 1);

  // week label using TODAY_ISO as the week start reference
  function weekLabel(): string {
    const start = new Date(TODAY_ISO + "T12:00:00");
    const end = new Date(TODAY_ISO + "T12:00:00");
    end.setDate(end.getDate() + 6);
    const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `${fmt(start)} – ${fmt(end)}`;
  }

  const anyEntries = false; // no timeEntries in sample state; matches prototype's empty state

  return (
    <>
      <h1>Timesheets</h1>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0", flexWrap: "wrap" }}>
        <button className="btn sm" onClick={() => stub("tsWeekNav", -1)}>
          ‹ Prev
        </button>
        <b style={{ fontWeight: 700 }}>{weekLabel()}</b>
        <button className="btn sm" onClick={() => stub("tsWeekNav", 1)}>
          Next ›
        </button>
      </div>

      {anyEntries ? null : (
        <div className="empty-att" style={{ marginTop: 14 }}>
          No time logged this week — crew clock in from My day.
        </div>
      )}

      {/* Crew chips — shown even with no entries so you can select a tech */}
      <div className="ts-chips" style={{ marginTop: 16 }}>
        {techs.map((t) => (
          <button
            key={t.id}
            className={`ts-chip${t.id === selectedTechId ? " sel" : ""}`}
            onClick={() => setSelectedTechId(t.id)}
          >
            <span
              className="javatar"
              style={{ background: t.color, width: 22, height: 22, fontSize: 9 }}
            >
              {t.initials}
            </span>
            <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.2 }}>
              <b style={{ fontSize: 12.5, color: "var(--ink)" }}>{t.name.split(" ")[0]}</b>
              <span className="muted" style={{ fontSize: 10.5 }}>—</span>
            </span>
          </button>
        ))}
      </div>

      {/* Selected tech timesheet card */}
      {(() => {
        const tc = techs.find((t) => t.id === selectedTechId);
        if (!tc) return null;
        return (
          <div className="card" style={{ marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
              <b style={{ fontWeight: 700, fontSize: 15 }}>
                {tc.name} · this week
              </b>
              <span className="muted" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
                0.00 h
              </span>
              <span style={{ flex: 1 }} />
              <button className="btn sm" onClick={() => stub("tsAddEntry", tc.id)}>
                + Add entry
              </button>
              <button className="btn sm primary" onClick={() => stub("tsApproveTech", tc.id)}>
                Approve
              </button>
            </div>
            <div className="empty-att" style={{ paddingTop: 12 }}>
              No entries yet — crew clocks in from My day.
            </div>
          </div>
        );
      })()}
    </>
  );
}

// ============================================================================
// Main page
// ============================================================================

export default function JobsPage() {
  const openModal = useOpenModal();
  const jobs = useAppStore((s) => s.jobs);
  const [activeTab, setActiveTab] = useState<JobsSubTab>("jobs");

  const unscheduledCount = jobsUnscheduled(jobs).length;

  function handleOpenJob(id: number) {
    openModal(MODAL.JOB, { jobId: id });
  }

  function handleOpenNewJob() {
    openModal(MODAL.NEW_JOB);
  }

  function handleOpenSweep() {
    openModal(MODAL.JOB_SWEEP);
  }

  return (
    <div>
      {/* In-content sub-tab strip */}
      <div
        style={{
          display: "flex",
          gap: 2,
          marginBottom: 22,
          borderBottom: "1px solid var(--line)",
          paddingBottom: 0,
        }}
      >
        {SUB_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: "none",
              border: "none",
              padding: "8px 14px",
              fontFamily: "inherit",
              fontSize: 13.5,
              fontWeight: activeTab === tab.id ? 700 : 500,
              color: activeTab === tab.id ? "var(--ink)" : "var(--ink-2)",
              cursor: "pointer",
              borderBottom: activeTab === tab.id ? "2.5px solid var(--ink)" : "2.5px solid transparent",
              marginBottom: -1,
              borderRadius: 0,
            }}
          >
            {tab.label}
            {tab.id === "schedule" && unscheduledCount > 0 && (
              <span className="cnt" style={{ marginLeft: 6 }}>
                {unscheduledCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Panel */}
      {activeTab === "jobs" && <JobsList onOpenJob={handleOpenJob} onOpenNewJob={handleOpenNewJob} onOpenSweep={handleOpenSweep} />}
      {activeTab === "schedule" && <SchedulePanel />}
      {activeTab === "today" && <TodayPanel />}
      {activeTab === "timesheets" && <TimesheetsPanel />}
    </div>
  );
}
