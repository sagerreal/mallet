"use client";

/**
 * Jobs page — pixel-faithful port of the prototype's vJobs / vSchedule / vOpsHome / vTimesheets.
 * Reads live data from the Zustand store (jobs / techs / leads) so job-modal mutations
 * reflect reactively. All interactive actions not yet wired are console-logged stubs.
 */

import { useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { TODAY_ISO, dPlus } from "@/lib/prototype-sample";
import { useAppStore, useOpenModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { Job, Lead, Tech, TimeEntry, Visit } from "@/lib/store/types";

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

// A job visit or an estimate visit (evisit) held for board placement.
type Held = { kind: "job" | "evisit"; ownerId: number; visitId: number };

interface BoardItem { kind: "job" | "evisit"; ownerId: number; name: string; mode: string; v: Visit }

/** All placed visits (job + estimate) for one crew on one day, time-sorted. */
function boardItemsFor(jobs: Job[], leads: Lead[], techId: number, iso: string): BoardItem[] {
  const items: BoardItem[] = [];
  liveJobs(jobs).forEach((j) =>
    (j.visits ?? []).forEach((v) => {
      if (v.techId === techId && v.date === iso)
        items.push({ kind: "job", ownerId: j.id, name: custName(j, leads), mode: jobMode(j), v });
    })
  );
  leads.forEach((l) => {
    if (l.archived) return;
    (l.evisits ?? []).forEach((v) => {
      if (v.techId === techId && v.date === iso)
        items.push({ kind: "evisit", ownerId: l.id, name: l.name, mode: "estimate", v });
    });
  });
  return items.sort((a, b) => (a.v.start ?? 0) - (b.v.start ?? 0));
}

/** Estimate visits awaiting a slot (prototype unplacedEvisits). */
function unplacedEvisits(leads: Lead[]): Array<{ l: Lead; v: Visit }> {
  const out: Array<{ l: Lead; v: Visit }> = [];
  leads.forEach((l) => {
    if (l.archived) return;
    (l.evisits ?? []).forEach((v) => {
      if (v.status !== "done" && !(v.date && v.techId != null && v.start != null)) out.push({ l, v });
    });
  });
  return out;
}

// ---- sub-tab types ---------------------------------------------------------

type JobsSubTab = "jobs" | "schedule" | "today" | "timesheets";

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
  onOpenStandards: () => void;
}

function JobsList({ onOpenJob, onOpenNewJob, onOpenSweep, onOpenStandards }: JobsListProps) {
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
          <button className="btn ghost" onClick={onOpenStandards}>
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

  const placeVisit = useAppStore((s) => s.placeVisit);
  const placeEvisit = useAppStore((s) => s.placeEvisit);
  const addVisit = useAppStore((s) => s.addVisit);
  const updateVisit = useAppStore((s) => s.updateVisit);

  const [schedView, setSchedView] = useState<SchedView>("day");
  const [schedDay, setSchedDay] = useState(TODAY_ISO);
  const [weekStart, setWeekStart] = useState(TODAY_ISO);
  // A job visit or an estimate visit (evisit) held for placement on the board.
  const [placing, setPlacing] = useState<Held | null>(null);
  const [drag, setDrag] = useState<Held | null>(null);

  function weekDates(): string[] {
    const out: string[] = [];
    for (let i = 0; i < 7; i++) out.push(dPlus(i));
    return out;
  }

  const WPX = 78;
  const CAP = 8;

  function firstUnplaced(j: Job): Visit | undefined {
    return (j.visits ?? []).find((v) => !(v.date && v.techId != null && v.start != null));
  }
  function place(held: Held, techId: number, iso: string, hour: number) {
    if (held.kind === "job") placeVisit(held.ownerId, held.visitId, { techId, date: iso, start: hour });
    else placeEvisit(held.ownerId, held.visitId, { techId, date: iso, start: hour });
  }
  // Tap "Schedule": arm the job's first unplaced visit (creating one if needed).
  function armJob(j: Job) {
    const v = firstUnplaced(j) ?? addVisit(j.id);
    if (!v) return;
    setPlacing((p) => (p && p.kind === "job" && p.visitId === v.id ? null : { kind: "job", ownerId: j.id, visitId: v.id }));
  }
  // Tap "Schedule" on an estimate-visit tray card.
  function armEvisit(leadId: number, visitId: number) {
    setPlacing((p) => (p && p.kind === "evisit" && p.visitId === visitId ? null : { kind: "evisit", ownerId: leadId, visitId }));
  }
  // Tap a board cell while armed → place the held item there (crew + day + start).
  function cellTap(techId: number, iso: string, hour: number) {
    if (!placing) return;
    place(placing, techId, iso, hour);
    setPlacing(null);
  }
  // Drop a dragged card/block on a board cell.
  function cellDrop(techId: number, iso: string, hour: number) {
    if (!drag) return;
    place(drag, techId, iso, hour);
    setDrag(null);
  }
  // "+" on a placed block: clone the visit (carry the hours) and arm it.
  function cloneArm(jobId: number, dur: number) {
    const nv = addVisit(jobId, dur);
    if (nv) setPlacing({ kind: "job", ownerId: jobId, visitId: nv.id });
  }
  // Drag the block's right edge to change its hours (Google-Calendar gesture).
  function resizeStart(e: React.MouseEvent, jobId: number, v: Visit) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startDur = v.dur ?? 1;
    function move(ev: MouseEvent) {
      const nd = Math.max(0.25, Math.round((startDur + (ev.clientX - startX) / WPX) * 4) / 4);
      updateVisit(jobId, v.id, { dur: nd });
    }
    function up() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  const armedName = (() => {
    if (!placing) return "";
    if (placing.kind === "job") {
      const j = jobs.find((x) => x.id === placing.ownerId);
      return j ? custName(j, leads) : "";
    }
    return leads.find((l) => l.id === placing.ownerId)?.name ?? "";
  })();

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
          const items = boardItemsFor(jobs, leads, tc.id, iso);
          const load = items.reduce((s, it) => s + (it.v.dur ?? 0), 0);

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
                    className={`gv-cell${placing || drag ? " drop" : ""}`}
                    style={{ left: (h - START) * WPX, width: WPX, position: "absolute", top: 0, bottom: 0 }}
                    onClick={() => cellTap(tc.id, iso, h)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => cellDrop(tc.id, iso, h)}
                  />
                ))}
                {/* visit blocks (jobs + estimate visits) */}
                {items.map(({ kind, ownerId, name, mode, v }) => {
                  const vStart = v.start ?? 0;
                  const left = Math.max(0, (vStart - START) * WPX);
                  const w = Math.max(38, (v.dur ?? 1) * WPX - 4);
                  const m = svcMeta(mode);
                  const openIt = () =>
                    kind === "job"
                      ? openModal(MODAL.JOB, { jobId: ownerId })
                      : openModal(MODAL.EVISIT, { leadId: ownerId, visitId: v.id });
                  return (
                    <div
                      key={`${kind}-${v.id}`}
                      className={`gv-block${m.est ? " est" : ""}`}
                      style={{ left, width: w, opacity: v.status === "done" ? 0.55 : 1 }}
                      draggable
                      onDragStart={() => setDrag({ kind, ownerId, visitId: v.id })}
                      onDragEnd={() => setDrag(null)}
                      onClick={(e) => { e.stopPropagation(); openIt(); }}
                      title={`${name} · ${timeLabel(vStart)}–${timeLabel(vStart + (v.dur ?? 0))}`}
                    >
                      <div className="gv-bt" style={{ color: m.c }}>
                        {m.word ?? m.tag}
                        {v.status === "done" ? " ✓" : ""}
                      </div>
                      <div className="gv-bn">{name}</div>
                      <div className="gv-btm">
                        {timeLabel(vStart)}–{timeLabel(vStart + (v.dur ?? 0))}
                      </div>
                      {kind === "job" && (
                        <>
                          <div className="gv-resize" onMouseDown={(e) => resizeStart(e, ownerId, v)} title="Drag to change the hours" />
                          <button
                            className="gv-addv"
                            onClick={(e) => { e.stopPropagation(); cloneArm(ownerId, v.dur ?? 2); }}
                            title="Add another visit — same job, another day"
                          >
                            +
                          </button>
                        </>
                      )}
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
          const entries = techs
            .flatMap((tc) => boardItemsFor(jobs, leads, tc.id, iso))
            .sort((a, b) => (a.v.start ?? 0) - (b.v.start ?? 0));

          const totalLoad = entries.reduce((s, it) => s + (it.v.dur ?? 0), 0);
          const dayCap = CAP * techs.length;

          const body =
            entries.length === 0 ? (
              <div className="wk-empty">—</div>
            ) : (
              entries.map(({ kind, ownerId, name, mode, v }) => {
                const vStart = v.start ?? 0;
                const m = svcMeta(mode);
                const tc = v.techId != null ? techById(techs, v.techId) : undefined;
                return (
                  <div
                    key={`${kind}-${v.id}`}
                    className={`wk-item${m.est ? " est" : ""}`}
                    style={{ opacity: v.status === "done" ? 0.55 : 1 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (kind === "job") openModal(MODAL.JOB, { jobId: ownerId });
                      else openModal(MODAL.EVISIT, { leadId: ownerId, visitId: v.id });
                    }}
                  >
                    <div className="wk-bt" style={{ color: m.c }}>
                      {m.word ?? m.lbl}
                    </div>
                    <div className="wk-nm">{name}</div>
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

  type TrayCard = { kind: "job"; j: Job } | { kind: "evisit"; l: Lead; v: Visit };
  const trayCards: TrayCard[] = [
    ...jobsUnscheduled(jobs).map((j) => ({ kind: "job" as const, j })),
    ...unplacedEvisits(leads).map(({ l, v }) => ({ kind: "evisit" as const, l, v })),
  ];
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
      {trayCards.length > 0 ? (
        <div className="rail" style={{ marginBottom: 14 }}>
          <b style={{ fontSize: 13 }}>
            To schedule <span className="muted" style={{ fontWeight: 600 }}>· {trayCards.length}</span>
          </b>
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 8 }}>
            {trayCards.map((card) => {
              const isJob = card.kind === "job";
              const name = isJob ? custName(card.j, leads) : card.l.name;
              const title = isJob ? card.j.title : card.l.job || "Estimate visit";
              const mode = isJob ? jobMode(card.j) : "estimate";
              const m = svcMeta(mode);
              const hrs = isJob
                ? (card.j.visits ?? []).filter((v) => !(v.date && v.techId != null)).reduce((s, v) => s + (v.dur ?? 0), 0) || 2
                : card.v.dur ?? 2;
              const armed = isJob
                ? placing?.kind === "job" && placing.ownerId === card.j.id
                : placing?.kind === "evisit" && placing.visitId === card.v.id;
              const key = isJob ? `job-${card.j.id}` : `ev-${card.v.id}`;
              function onSchedule() {
                if (isJob) armJob(card.j);
                else armEvisit(card.l.id, card.v.id);
              }
              function onDragStart() {
                if (isJob) {
                  const v = firstUnplaced(card.j) ?? addVisit(card.j.id);
                  if (v) setDrag({ kind: "job", ownerId: card.j.id, visitId: v.id });
                } else {
                  setDrag({ kind: "evisit", ownerId: card.l.id, visitId: card.v.id });
                }
              }
              return (
                <div
                  key={key}
                  className={`railjob place${armed ? " arm" : ""}`}
                  title="Drag onto the board, or tap Schedule then a slot"
                  draggable
                  onDragStart={onDragStart}
                  onDragEnd={() => setDrag(null)}
                >
                  {isJob && (
                    <button className="rail-addv" onClick={(e) => { e.stopPropagation(); addVisit(card.j.id, 2); }} title="Add another visit">
                      +
                    </button>
                  )}
                  <b style={{ fontSize: "13.5px" }}>{name}</b>
                  <div className="muted" style={{ fontSize: "11.5px", margin: "2px 0 10px" }}>{title}</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: m.c }}>
                      {m.lbl}
                    </span>
                    <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{hmLabel(hrs)}</span>
                  </div>
                  <div style={{ display: "flex", gap: 7 }}>
                    <button
                      className={`btn sm${armed ? " arm" : " primary"}`}
                      style={{ flex: 1, justifyContent: "center" }}
                      onClick={(e) => { e.stopPropagation(); onSchedule(); }}
                    >
                      {armed ? "Cancel" : "Schedule"}
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

      {placing && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            background: "var(--ink)",
            color: "#fff",
            borderRadius: 9,
            padding: "11px 14px",
            marginBottom: 11,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <span>
            Tap a crew &amp; time on the board to place <b>{armedName}</b>
          </span>
          <span
            className="linklike"
            style={{ color: "#fff", textDecoration: "underline", flex: "none" }}
            onClick={() => setPlacing(null)}
          >
            Cancel
          </span>
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

function TodayPanel({ onGoSchedule }: { onGoSchedule: () => void }) {
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
        <div className="kpi" onClick={() => onGoSchedule()}>
          <div className="lbl">Visits today</div>
          <div className="val">{tv.length}</div>
          <div className="hint">{live.length} in progress</div>
        </div>
        <div
          className={`kpi${uns.length ? "" : ""}`}
          style={uns.length ? { borderColor: "var(--manila-line)", background: "var(--manila)" } : undefined}
          onClick={() => onGoSchedule()}
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
          <span className="linklike" onClick={() => onGoSchedule()}>
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

// Kind labels — mirror prototype TS_KINDS (order matters for the segment).
const TS_KINDS: Record<string, string> = {
  job: "Job",
  travel: "Travel",
  break: "Break",
  shop: "Shop",
};
const TS_KIND_KEYS = ["job", "travel", "break", "shop"] as const;

/** 'HH:MM' → decimal hours (mirrors prototype timeToH). */
function timeToH(s: string): number {
  const p = (s || "").split(":");
  return (Number(p[0]) || 0) + (Number(p[1]) || 0) / 60;
}

/** decimal hours → 'HH:MM' (mirrors prototype hToTime). */
function hToTime(h: number): string {
  let hr = Math.floor(h);
  let mn = Math.round((h - hr) * 60);
  if (mn === 60) {
    hr++;
    mn = 0;
  }
  return String(hr).padStart(2, "0") + ":" + String(mn).padStart(2, "0");
}

/** ISO date + n days (mirrors prototype addDays). */
function tsAddDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `iso` (mirrors prototype tsWeekStart). */
function tsWeekStart(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  return tsAddDays(iso, -dow);
}

/** The 7 ISO dates of the week starting `mon` (Mon..Sun). */
function tsWeekDates(mon: string): string[] {
  return Array.from({ length: 7 }, (_, i) => tsAddDays(mon, i));
}

/** Rounds money/hours to 2 dp (mirrors prototype tsMoney). */
function tsMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Worked hours for one entry (mirrors prototype tsHours). */
function tsHours(e: TimeEntry): number {
  if (!e || !e.end) return 0;
  const d = timeToH(e.end) - timeToH(e.start);
  return d > 0 ? Math.round(d * 100) / 100 : 0;
}

/** Paid hours — unpaid break excluded (mirrors prototype tsPaid). */
function tsPaid(e: TimeEntry): number {
  return e.kind === "break" ? 0 : tsHours(e);
}

/** This tech's entries for the given week (mirrors prototype tsWeekEntries). */
function tsWeekEntries(entries: TimeEntry[], techId: number, weekDates: string[]): TimeEntry[] {
  return entries.filter((e) => e.techId === techId && weekDates.includes(e.date));
}

/** Time-sorted copy (mirrors prototype tsSortEntries). */
function tsSortEntries(es: TimeEntry[]): TimeEntry[] {
  return es
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : timeToH(a.start) - timeToH(b.start)));
}

interface TsRollup {
  paid: number;
  reg: number;
  ot: number;
  approved: boolean;
  count: number;
}

/** Weekly rollup — HOURS only, payroll computes pay (mirrors prototype tsRollup). */
function tsRollup(entries: TimeEntry[], techId: number, weekDates: string[]): TsRollup {
  const es = tsWeekEntries(entries, techId, weekDates);
  const paid = tsMoney(es.reduce((s, e) => s + tsPaid(e), 0));
  const reg = Math.min(paid, 40);
  const ot = tsMoney(Math.max(0, paid - 40));
  const approved = es.length > 0 && es.every((e) => e.status === "approved");
  return { paid, reg, ot, approved, count: es.length };
}

function tsJob(e: TimeEntry, jobs: Job[]): Job | undefined {
  return e.jobId ? jobs.find((j) => j.id === e.jobId) : undefined;
}

/** Row label — job title · customer, or the fixed label for non-job kinds. */
function tsLabel(e: TimeEntry, jobs: Job[], leads: Lead[]): string {
  if (e.kind === "job") {
    const j = tsJob(e, jobs);
    if (!j) return "Job";
    const cn = custName(j, leads);
    return cn && cn !== "—" ? `${j.title} · ${cn}` : j.title;
  }
  const map: Record<string, string> = {
    travel: "Travel between jobs",
    break: "Lunch / break",
    shop: "Shop · load-out & restock",
  };
  return map[e.kind] ?? TS_KINDS[e.kind] ?? e.kind;
}

/** 12h time label from decimal hours (mirrors prototype tsT12). */
function tsT12(h: number): string {
  if (h == null || Number.isNaN(h)) return "";
  let hr = Math.floor(h);
  let mn = Math.round((h - hr) * 60);
  if (mn === 60) {
    hr++;
    mn = 0;
  }
  const ap = hr % 24 < 12 ? "am" : "pm";
  let d = hr % 12;
  if (d === 0) d = 12;
  return `${d}:${String(mn).padStart(2, "0")}${ap}`;
}

/** 12h label from an 'HH:MM' string (mirrors prototype tsTimeLabel). */
function tsTimeLabel(str: string | null): string {
  return str ? tsT12(timeToH(str)) : "";
}

interface TsTimeOpt { h: number; t: string; label: string }
/** 6:00am–8:00pm at 15-min steps (mirrors prototype tsTimeOpts). */
function tsTimeOpts(): TsTimeOpt[] {
  const out: TsTimeOpt[] = [];
  for (let h = 6; h <= 20.0001; h = Math.round((h + 0.25) * 100) / 100) {
    out.push({ h, t: hToTime(h), label: tsT12(h) });
  }
  return out;
}

/** Job ids this tech is scheduled on this week (mirrors tsTechWeekJobIds). */
function tsTechWeekJobIds(jobs: Job[], techId: number, weekDates: string[]): Set<number> {
  const ids = new Set<number>();
  jobs.forEach((j) => {
    if (j.archived) return;
    (j.visits ?? []).forEach((v) => {
      if (v.techId === techId && v.date != null && weekDates.includes(v.date)) ids.add(j.id);
    });
  });
  return ids;
}

// ---- inline pickers (in-flow, no floating popover — matches prototype) -----

interface TsKindSegProps { entry: TimeEntry; onPick: (kind: string) => void }
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
  onPick: (jobId: number) => void;
}
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
  const open_ = liveJobs(jobs);
  const scoped = open_.filter((j) => wk.has(j.id) && matches(j));
  const rest = open_.filter((j) => !wk.has(j.id)).slice(0, 60).filter(matches);
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

// Which sub-picker is open inside the row editor ('kind'|'job'|'start'|'end').
type TsPick = "job" | "start" | "end" | null;

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

interface TsEntriesBlockProps {
  entries: TimeEntry[];
  jobs: Job[];
  leads: Lead[];
  techs: Tech[];
  weekDates: string[];
  editId: number | null;
  pick: TsPick;
  onSetPick: (p: TsPick) => void;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
  onSetField: (id: number, field: keyof TimeEntry, val: string | number) => void;
  onCloseEdit: () => void;
}
function TsEntriesBlock({
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

// Fields the office is allowed to edit (mirrors prototype tsSetField whitelist).
const TS_EDITABLE: ReadonlySet<string> = new Set(["kind", "jobId", "techId", "date", "start", "end", "note"]);

function TimesheetsPanel() {
  const techs = useAppStore((s) => s.techs);
  const jobs = useAppStore((s) => s.jobs);
  const leads = useAppStore((s) => s.leads);
  const timeEntries = useAppStore((s) => s.timeEntries);
  const addTimeEntry = useAppStore((s) => s.addTimeEntry);
  const updateTimeEntry = useAppStore((s) => s.updateTimeEntry);
  const deleteTimeEntry = useAppStore((s) => s.deleteTimeEntry);
  const approveTechWeek = useAppStore((s) => s.approveTechWeek);

  // Week nav — local weekStart state, normalized to the Monday of TODAY's week.
  const [weekStart, setWeekStart] = useState<string>(() => tsWeekStart(TODAY_ISO));
  const [selectedTechId, setSelectedTechId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [pick, setPick] = useState<TsPick>(null);
  const [crewQ, setCrewQ] = useState("");

  const weekDates = tsWeekDates(weekStart);
  const wkEnd = tsAddDays(weekStart, 6);
  const thisWeek = tsWeekStart(TODAY_ISO);
  const dl = (iso: string) =>
    new Date(iso + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const totals = techs.map((t) => tsRollup(timeEntries, t.id, weekDates));
  const anyEntries = totals.some((r) => r.count > 0);
  const totPaid = tsMoney(totals.reduce((s, r) => s + r.paid, 0));
  const totOt = tsMoney(totals.reduce((s, r) => s + r.ot, 0));

  // Selected tech: sticky choice if it still has a chip, else first-with-entries or first crew.
  const selId =
    selectedTechId != null && techs.some((t) => t.id === selectedTechId)
      ? selectedTechId
      : (techs.find((t, i) => (totals[i]?.count ?? 0) > 0) ?? techs[0])?.id ?? null;

  function weekNav(delta: number) {
    setWeekStart((w) => tsWeekStart(tsAddDays(w, delta * 7)));
    setEditId(null);
    setPick(null);
  }

  function handleSelect(id: number) {
    setSelectedTechId(id);
    setEditId(null);
    setPick(null);
  }

  function handleEdit(id: number) {
    const e = timeEntries.find((x) => x.id === id);
    if (!e || e.status === "approved" || e.running) return;
    setEditId((cur) => (cur === id ? null : id));
    setPick(null);
  }

  function handleCloseEdit() {
    setEditId(null);
    setPick(null);
  }

  function handleSetField(id: number, field: keyof TimeEntry, val: string | number) {
    if (!TS_EDITABLE.has(String(field))) return;
    const e = timeEntries.find((x) => x.id === id);
    if (!e || e.status === "approved") return;
    if (field === "techId" || field === "jobId") {
      const num = Number(val) || null;
      updateTimeEntry(id, { [field]: num } as Partial<TimeEntry>);
      return;
    }
    updateTimeEntry(id, { [field]: val } as Partial<TimeEntry>);
  }

  function handleAdd(techId: number) {
    // Anchor a fresh draft on today if today is in view, else the week's Monday.
    const day = weekDates.includes(TODAY_ISO) ? TODAY_ISO : weekStart;
    addTimeEntry(techId, day);
    setSelectedTechId(techId);
  }

  const selTech = selId != null ? techById(techs, selId) : undefined;
  const crewFilter = crewQ.toLowerCase().trim();

  return (
    <>
      <h1>Timesheets</h1>
      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0", flexWrap: "wrap" }}>
        <button className="btn sm" onClick={() => weekNav(-1)}>
          ‹ Prev
        </button>
        <b style={{ fontWeight: 700 }}>
          {dl(weekStart)} – {dl(wkEnd)}
        </b>
        <button className="btn sm" onClick={() => weekNav(1)}>
          Next ›
        </button>
        {weekStart !== thisWeek && (
          <button
            className="btn sm ghost"
            onClick={() => {
              setWeekStart(thisWeek);
              setEditId(null);
              setPick(null);
            }}
          >
            This week
          </button>
        )}
        {anyEntries && (
          <>
            <span style={{ flex: 1 }} />
            <span className="muted" style={{ fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
              {totPaid.toFixed(2)} paid h{totOt ? ` · ${totOt.toFixed(2)} OT` : ""}
            </span>
          </>
        )}
      </div>

      {(
        <>
          {techs.length > 6 && (
            <input
              className="ts-tfilter"
              placeholder="Filter crew…"
              value={crewQ}
              onChange={(e) => setCrewQ(e.target.value)}
            />
          )}
          <div className="ts-chips">
            {techs.map((t, i) => {
              const r = totals[i];
              const sel = t.id === selId;
              if (crewFilter && !t.name.toLowerCase().includes(crewFilter)) return null;
              return (
                <button
                  key={t.id}
                  className={`ts-chip${sel ? " sel" : ""}`}
                  onClick={() => handleSelect(t.id)}
                >
                  <span
                    className="javatar"
                    style={{ background: t.color, width: 22, height: 22, fontSize: 9 }}
                  >
                    {t.initials}
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.2 }}>
                    <b style={{ fontSize: 12.5, color: "var(--ink)" }}>{t.name.split(" ")[0]}</b>
                    <span className="muted" style={{ fontSize: 10.5 }}>
                      {r && r.count
                        ? `${r.paid.toFixed(1)}h${r.approved ? " · ✓" : " · draft"}`
                        : "—"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {selTech &&
            (() => {
              const r = tsRollup(timeEntries, selTech.id, weekDates);
              const locked = r.approved;
              const es = tsWeekEntries(timeEntries, selTech.id, weekDates);
              return (
                <div className="card" style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                    <b style={{ fontWeight: 700, fontSize: 15 }}>{selTech.name} · this week</b>
                    <span className="muted" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
                      {r.paid.toFixed(2)} h{r.ot ? ` · ${r.ot.toFixed(2)} OT` : ""}
                    </span>
                    <span style={{ flex: 1 }} />
                    {locked ? (
                      <>
                        <span
                          className="pill"
                          style={{
                            background: "var(--green-50)",
                            color: "var(--green-700)",
                            border: "1px solid var(--green-100)",
                          }}
                        >
                          ✓ Approved
                        </span>
                        <button
                          className="btn sm ghost"
                          onClick={() => {
                            // Reopen: draft every approved entry this week for this tech.
                            es.forEach((e) => {
                              if (e.status === "approved") updateTimeEntry(e.id, { status: "draft" });
                            });
                          }}
                        >
                          Reopen
                        </button>
                      </>
                    ) : (
                      <>
                        <button className="btn sm" onClick={() => handleAdd(selTech.id)}>
                          + Add entry
                        </button>
                        <button className="btn sm primary" onClick={() => approveTechWeek(selTech.id, weekDates)}>
                          Approve
                        </button>
                      </>
                    )}
                  </div>
                  <TsEntriesBlock
                    entries={es}
                    jobs={jobs}
                    leads={leads}
                    techs={techs}
                    weekDates={weekDates}
                    editId={editId}
                    pick={pick}
                    onSetPick={setPick}
                    onEdit={handleEdit}
                    onDelete={deleteTimeEntry}
                    onSetField={handleSetField}
                    onCloseEdit={handleCloseEdit}
                  />
                </div>
              );
            })()}
        </>
      )}
    </>
  );
}

// ============================================================================
// Main page
// ============================================================================

const JOBS_TABS: readonly JobsSubTab[] = ["jobs", "schedule", "today", "timesheets"];

export default function JobsPage() {
  const openModal = useOpenModal();
  const router = useRouter();
  const searchParams = useSearchParams();
  // The sub-view is driven by the sidebar nav (?tab=…), not an in-content strip.
  const tabParam = searchParams.get("tab");
  const activeTab: JobsSubTab = JOBS_TABS.includes(tabParam as JobsSubTab)
    ? (tabParam as JobsSubTab)
    : "jobs";

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
      {activeTab === "jobs" && <JobsList onOpenJob={handleOpenJob} onOpenNewJob={handleOpenNewJob} onOpenSweep={handleOpenSweep} onOpenStandards={() => openModal(MODAL.STANDARDS)} />}
      {activeTab === "schedule" && <SchedulePanel />}
      {activeTab === "today" && <TodayPanel onGoSchedule={() => router.push("/jobs?tab=schedule")} />}
      {activeTab === "timesheets" && <TimesheetsPanel />}
    </div>
  );
}
