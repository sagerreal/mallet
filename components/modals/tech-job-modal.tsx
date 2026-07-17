/**
 * components/modals/tech-job-modal.tsx
 * Faithful port of the prototype's techJobHtml (lines 4563-4634) — the TECH /
 * crew's field view of a job, opened from My Day. Same job data as the office
 * job-modal, DIFFERENT rendering: timer-first, no status pill, tappable address,
 * on-site step buttons, price-on-site.
 *
 * The hero is fieldTimer (prototype 4785) — a big field clock the tech starts /
 * pauses / stops. Here the elapsed is LOCAL component state (ticks every 1s while
 * running) so the clock is live while the modal is open.
 *
 * Field-view chunks now ported (WorkOrderSec / FoundWorkSec / interactive
 * ChecklistSec):
 *   - work order fold (install scope, workOrderBlock 4649) → WorkOrderSec (5a)
 *   - found-work / add-ons (aoSection 3826)                → FoundWorkSec (5b)
 *   - interactive "Before you leave" capture (verifySection 4876) → ChecklistSec (5c)
 *   - tech GBB + on-glass signature (openTechQuote / tq)   → TechQuoteModal
 *     (opened via the Pricing section's "Price it on site →")
 *
 * The on-site close-out / collect HERO (techDoneBlock, prototype 5698-5760) now
 * renders INLINE via DoneBlock when the job is done — replacing the slim
 * "✓ Done · Reopen" line (a small Reopen affordance is kept beside it).
 */

"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  useActiveModal,
  useOpenModal,
  useCloseModal,
  useAppStore,
} from "@/lib/store/app-store";
import { useMe } from "@/features/identity/hooks";
import { MODAL } from "@/lib/store/modal-ids";
import { fmt$ } from "@/lib/format";
import { todayISO } from "@/lib/clock";
import type {
  Job,
  Visit,
  Lead,
  Invoice,
  Addon,
  VerifyAns,
  ChecklistItem,
} from "@/lib/store/types";

// ---- helpers ported 1:1 from the prototype --------------------------------

interface SvcMeta {
  word: string;
  c: string;
}

// prototype SVC_META (line 3991) — the service word + its color.
const SVC_META: Record<string, SvcMeta> = {
  estimate: { word: "Estimate", c: "var(--amber)" },
  service: { word: "Job", c: "#9C5B34" },
  install: { word: "Job", c: "#4A639E" },
};

function svcMeta(key: string): SvcMeta {
  return SVC_META[key] ?? SVC_META.service!;
}


function jobTotal(j: Job): number {
  return (j.lines ?? []).reduce((s, l) => s + (l.q ?? 1) * (l.r ?? 0), 0);
}

/** invPaid — sum of payment amounts (prototype invPaid). */
function invPaid(i: Invoice): number {
  return (i.payments ?? []).reduce((s, p) => s + (p.amt ?? 0), 0);
}

/** invDue — total − deposit − payments, floored at 0 (prototype invDue). */
function invDue(i: Invoice): number {
  return Math.max(0, (i.total ?? 0) - (i.depPaid ?? 0) - invPaid(i));
}

/** priced → "install" (blue), unpriced job → "service" (brown), estimate → estimate (prototype jobMode, 4002). */
function jobMode(j: Job): string {
  if (j.svc === "estimate") return "estimate";
  const priced = (j.lines ?? []).some((l) => (l.q ?? 1) * (l.r ?? 0) > 0);
  return priced ? "install" : "service";
}

/** A visit is PLACED once it has a day + crew + start — the tech only sees these (prototype vPlaced). */
function vPlaced(v: Visit): boolean {
  return !!(v.date && v.techId != null && v.start != null);
}

/** The repair has an agreed price — a service-call fee alone doesn't count (prototype `quoted`, 4567). */
function jobQuoted(j: Job): boolean {
  return (j.lines ?? []).some((l) => (l.q ?? 1) * (l.r ?? 0) > 0);
}

/** Customer name (prototype custName, 3582) — the linked lead's name, else the job title. */
function custNameOf(j: Job, lead: Lead | undefined): string {
  if (lead) return lead.name;
  const m = (j.title ?? "").split("—");
  return m.length > 1 ? (m[1] ?? "").trim() : j.title || "Customer";
}

/** Day label (prototype colLabel, 3558) — "Today" / "Wed 3" / "Not scheduled". */
function colLabel(iso: string | null): string {
  if (!iso) return "Not scheduled";
  const d = new Date(iso + "T12:00:00");
  if (isNaN(d.getTime())) return "Not scheduled";
  if (iso === todayISO()) return "Today";
  return d.toLocaleDateString(undefined, { weekday: "short" }) + " " + d.getDate();
}

/** Hours→"2h 30m" / "1h" (prototype hmLabel, 3810). */
function hmLabel(h: number): string {
  const hh = +h || 0;
  let H = Math.floor(hh);
  let M = Math.round((hh - H) * 60);
  if (M === 60) {
    H++;
    M = 0;
  }
  return M ? `${H}h ${M}m` : `${H}h`;
}

/** Seconds→"H:MM:SS" / "M:SS" (prototype clockLabel, 4769). */
function clockLabel(h: number): string {
  const s = Math.round((+h || 0) * 3600);
  const H = Math.floor(s / 3600);
  const M = Math.floor((s % 3600) / 60);
  const S = s % 60;
  return H
    ? `${H}:${String(M).padStart(2, "0")}:${String(S).padStart(2, "0")}`
    : `${M}:${String(S).padStart(2, "0")}`;
}

/** Arrival time from a fractional hour start (prototype tvRow, 4577). */
function startTimeStr(start: number): string {
  const hr = Math.floor(start);
  const mn = Math.round((start - hr) * 60);
  let h12 = hr % 12;
  if (!h12) h12 = 12;
  return `${h12}:${String(mn).padStart(2, "0")} ${hr < 12 ? "AM" : "PM"}`;
}

function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2);
}

/** The current visit the timer tracks (prototype curV, 4586). */
function currentVisit(visits: Visit[]): Visit | undefined {
  return (
    visits.find((v) => v.status === "onsite") ??
    visits.find((v) => v.status === "enroute") ??
    visits.find((v) => v.status === "scheduled") ??
    visits[0]
  );
}

// ---- header (prototype techJobHtml header, 4593-4597) ----------------------
// avatar + customer name + a row: service word (colored) + job title (when ≠ name).
// NO status pill — this is the tech's own view.

function TechHeader({ job, custName }: { job: Job; custName: string }) {
  const meta = svcMeta(jobMode(job));
  const showTitle = custName !== job.title;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 11 }}>
      <div
        className="avatar"
        style={{
          width: 42,
          height: 42,
          background: "var(--green-100)",
          color: "var(--green-900)",
          fontSize: 14,
        }}
      >
        {initialsOf(custName)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{ marginBottom: 3 }}>{custName}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: ".05em",
              color: meta.c,
            }}
          >
            {meta.word}
          </span>
          {showTitle && (
            <span style={{ fontWeight: 600, fontSize: 13.5, color: "var(--ink-2)" }}>
              {job.title}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- field timer (prototype fieldTimer, 4785) ------------------------------
// The big field clock — the hero when the job is NOT done. Running → red
// .tjclock.run + live elapsed + "● on the clock — tap to stop"; idle → the
// green .tjclock + "0:00" (or resume-so-far) + "Start timer" / "Resume timer".
//
// Elapsed is LOCAL state: a setInterval ticks every 1s while running and is
// cleared on pause / unmount. Start → running; Pause → keep elapsed, stop
// ticking; the elapsed persists while the modal is open.
// deferred: persist timer + log to timesheets (across close + payroll punch)

interface FieldTimerProps {
  visit: Visit;
}

function FieldTimer({ visit }: FieldTimerProps) {
  // baseSec: accumulated seconds from prior run segments (survives pause).
  const [baseSec, setBaseSec] = useState(0);
  const [running, setRunning] = useState(false);
  // startedAt: wall-clock ms when the current run segment began (null when paused).
  const startedAtRef = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Tick every 1s while running; clear on pause / unmount.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);

  // Clamped ≥ 0: a clock skew / stale ref can never render a negative elapsed.
  const liveSec = Math.max(
    0,
    baseSec + (running && startedAtRef.current != null ? (now - startedAtRef.current) / 1000 : 0),
  );
  const elapsedH = liveSec / 3600;

  function start() {
    startedAtRef.current = Date.now();
    setNow(Date.now());
    setRunning(true);
  }

  function pause() {
    // Capture BEFORE queuing state updates: the setBaseSec updater runs after
    // this function nulls the ref (React batches), so reading the ref lazily
    // inside the updater added `Date.now() - 0` (epoch seconds) per pause.
    const startedAt = startedAtRef.current;
    if (running && startedAt != null) {
      const segmentSec = Math.max(0, (Date.now() - startedAt) / 1000);
      setBaseSec((s) => s + segmentSec);
    }
    startedAtRef.current = null;
    setRunning(false);
  }

  function stop() {
    // deferred: persist timer + log to timesheets — for now Stop just parks the
    // clock (pause + keep elapsed) so it reads back when re-opened this session.
    pause();
  }

  if (running) {
    return (
      <button className="tjclock run" onClick={pause}>
        <span className="tjclock-time">{clockLabel(elapsedH)}</span>
        <span className="tjclock-lbl">● on the clock — tap to stop</span>
      </button>
    );
  }

  const hasElapsed = baseSec > 0;
  return (
    <div>
      <button className="tjclock" onClick={start}>
        <span className="tjclock-time">{hasElapsed ? clockLabel(elapsedH) : "0:00"}</span>
        <span className="tjclock-lbl">{hasElapsed ? "Resume timer" : "Start timer"}</span>
      </button>
      {hasElapsed && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn ghost" style={{ flex: 1 }} onClick={stop}>
            Stop
          </button>
        </div>
      )}
    </div>
  );
}

// ---- your visit(s) row (prototype tvRow, 4568-4585) ------------------------
// ARRIVE label + big "colLabel · H:MM AM" + ON SITE label + "~hmLabel", then
// full-width step buttons. On-my-way / Arrived are optional; Done is never gated.

interface VisitRowProps {
  visit: Visit;
  quoted: boolean;
  /** Tech role: the step/done buttons call v1.visits.setVisitStatus (ownerOrOffice) — hidden. */
  readOnly: boolean;
  onStatus: (status: string) => void;
}

function VisitRow({ visit, quoted, readOnly, onStatus }: VisitRowProps) {
  // guarded: only PLACED visits reach here, so date/start are non-null.
  const date = visit.date ?? "";
  const start = visit.start ?? 0;
  const stepP = !quoted;

  // On my way → / Arrived → (scheduled → enroute → onsite). Empty once on site.
  const step =
    visit.status === "scheduled" ? (
      <button
        className={`btn ${stepP ? "primary" : "ghost"}`}
        style={{ flex: 1 }}
        onClick={() => onStatus("enroute")}
      >
        On my way →
      </button>
    ) : visit.status === "enroute" ? (
      <button
        className={`btn ${stepP ? "primary" : "ghost"}`}
        style={{ flex: 1 }}
        onClick={() => onStatus("onsite")}
      >
        Arrived →
      </button>
    ) : null;

  // ✓ Mark done / ↩ Reopen.
  const doneB =
    visit.status === "done" ? (
      <button className="btn ghost" style={{ flex: 1 }} onClick={() => onStatus("scheduled")}>
        ↩ Reopen
      </button>
    ) : (
      <button
        className={`btn ${visit.status === "onsite" || quoted ? "primary" : "ghost"}`}
        style={{ flex: 1 }}
        onClick={() => onStatus("done")}
      >
        ✓ Mark done
      </button>
    );

  return (
    <div style={{ marginBottom: 2 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 13,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".05em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              marginBottom: 2,
            }}
          >
            Arrive
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.01em" }}>
            {colLabel(date)} · {startTimeStr(start)}
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".05em",
              textTransform: "uppercase",
              color: "var(--ink-3)",
              marginBottom: 2,
            }}
          >
            On site
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-.01em" }}>
            ~{hmLabel(visit.dur)}
          </div>
        </div>
      </div>
      {!readOnly && (
        <div style={{ display: "flex", gap: 8 }}>
          {step}
          {doneB}
        </div>
      )}
    </div>
  );
}

// ---- pricing / scope section (prototype techJobHtml price branch, 4615-4621)

interface PricingSecProps {
  job: Job;
  quoted: boolean;
  onPriceOnSite: () => void;
}

function PricingSec({ job, quoted, onPriceOnSite }: PricingSecProps) {
  const mode = jobMode(job);
  const heading = mode === "estimate" ? "Scope it" : "Pricing";

  return (
    <div className="fsec">
      <div className="fsec-h">
        <span>{heading}</span>
      </div>
      {mode === "estimate" ? (
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>
          ✦ Scoping visit{" "}
          <span className="muted" style={{ fontWeight: 500 }}>
            — the office builds the quote
          </span>
        </div>
      ) : quoted ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <b style={{ fontSize: 14 }}>✓ Priced — {fmt$(jobTotal(job))}</b>
          <button className="btn sm ghost" onClick={onPriceOnSite}>
            re-price
          </button>
        </div>
      ) : (
        <button
          className="btn primary"
          style={{ width: "100%", fontSize: 14.5, padding: 12 }}
          onClick={onPriceOnSite}
        >
          Price it on site →
        </button>
      )}
    </div>
  );
}

// ---- work order (prototype workOrderBlock, 4649-4669) ----------------------
// A read-only "office-sold" scope handoff, install jobs only, not done, with
// scope lines. Our JobLine has no `fee`, so scope = every non-empty `d` line.
// The sold $ shows ONLY when techSeesPrice (the crew usually gets scope, no $).

const SCOPE_HEAD: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: ".05em",
};

interface WorkOrderSecProps {
  job: Job;
  seesPrice: boolean;
}

// Custom comparators for memoized sections — compare only the job fields each
// section actually reads. A checklist tap changes job.verify: WorkOrderSec,
// FoundWorkSec, and NoteFeed read none of those fields, so they skip the re-render.

export function workOrderPropsEqual(a: WorkOrderSecProps, b: WorkOrderSecProps): boolean {
  return (
    a.seesPrice === b.seesPrice &&
    a.job.lines === b.job.lines &&
    a.job.photos === b.job.photos &&
    a.job.title === b.job.title &&
    a.job.special === b.job.special &&
    a.job.prep === b.job.prep
  );
}

// WorkOrderSec uses a custom comparator so a checklist tap (job.verify change)
// does NOT re-render it — it only reads lines/photos/title/special/prep.
function WorkOrderSecFn({ job, seesPrice }: WorkOrderSecProps) {
  const scope = (job.lines ?? []).filter((l) => (l.d ?? "").trim());
  const photoN = (job.photos ?? []).length;

  return (
    <div className="fsec">
      <div className="fsec-h">
        <span>Work order</span>
        <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 600 }}>office-sold</span>
      </div>
      <div style={{ fontWeight: 700, fontSize: 15 }}>{job.title}</div>

      {scope.length ? (
        <>
          <div className="muted" style={{ ...SCOPE_HEAD, margin: "13px 0 5px" }}>
            Scope — what was sold
          </div>
          {scope.map((x, i) => (
            <div
              key={i}
              style={{ fontSize: 13.5, padding: "3px 0", display: "flex", gap: 8, alignItems: "baseline" }}
            >
              <span style={{ color: "var(--green-700)" }}>✓</span>
              <span style={{ flex: 1 }}>
                {x.d}
                {(x.q ?? 1) > 1 ? <span className="muted"> × {x.q}</span> : null}
              </span>
              {/* x.r === null = server-redacted (techSeesPrice off) — show nothing, never $0. */}
              {seesPrice && x.r != null && (
                <span className="muted fig" style={{ fontSize: 12 }}>
                  {fmt$((x.q ?? 1) * x.r)}
                </span>
              )}
            </div>
          ))}
        </>
      ) : null}

      {job.special ? (
        <div
          style={{
            marginTop: 11,
            background: "#FFFBEF",
            border: "1px solid var(--manila-line)",
            borderRadius: 9,
            padding: "9px 11px",
          }}
        >
          <b style={{ fontSize: 12, color: "#b45309" }}>★ Homeowner&rsquo;s requests</b>
          <div style={{ fontSize: 12.5, marginTop: 2 }}>{job.special}</div>
        </div>
      ) : null}

      {job.prep ? (
        <div style={{ fontSize: 12.5, marginTop: 9 }}>
          <b>Bring:</b> {job.prep}
        </div>
      ) : null}

      {photoN ? (
        <div style={{ marginTop: 11 }}>
          <span className="muted" style={SCOPE_HEAD}>
            Site photos · {photoN}
          </span>
          <div style={{ display: "flex", gap: 6, marginTop: 5 }}>
            {Array.from({ length: Math.min(photoN, 4) }).map((_, i) => (
              <div
                key={i}
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 8,
                  background: "var(--green-100)",
                  border: "1px solid var(--manila-line)",
                }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
const WorkOrderSec = memo(WorkOrderSecFn, workOrderPropsEqual);

// ---- found work / add-ons (prototype aoSection, 3826-3837) -----------------
// One .stage-row per addon: bold desc + ($r when techSeesPrice) + a status
// stpill; proposed rows get "✓ Customer OK'd" / "✕". Below, an add-form with a
// desc input + (price input when techSeesPrice) + Add. LOCAL controlled inputs.

const AO_INPUT: React.CSSProperties = {
  border: "1.5px solid var(--line)",
  borderRadius: 8,
  padding: "7px 9px",
  fontFamily: "inherit",
  fontSize: 13,
};

interface AddonStatusPillProps {
  status: Addon["status"];
}

function AddonStatusPill({ status }: AddonStatusPillProps) {
  if (status === "approved") {
    return (
      <span className="stpill" style={{ color: "var(--green-700)", background: "var(--green-50)" }}>
        approved
      </span>
    );
  }
  if (status === "declined") {
    return (
      <span className="stpill" style={{ color: "var(--ink-3)", background: "var(--paper)" }}>
        declined
      </span>
    );
  }
  return (
    <span className="stpill" style={{ color: "var(--amber)", background: "var(--amber-bg)" }}>
      awaiting OK
    </span>
  );
}

interface FoundWorkSecProps {
  job: Job;
  seesPrice: boolean;
  /** Tech role: add + status controls call ownerOrOffice endpoints — list stays read-only. */
  readOnly: boolean;
  addAddon: (jobId: string, draft: { d: string; r: number }) => Addon | null;
  setAddonStatus: (jobId: string, addonId: number, status: Addon["status"]) => void;
}

// FoundWorkSec uses a custom comparator so a checklist tap (job.verify change)
// does NOT re-render it — it only reads job.addons and job.id.
export function foundWorkPropsEqual(a: FoundWorkSecProps, b: FoundWorkSecProps): boolean {
  return (
    a.seesPrice === b.seesPrice &&
    a.readOnly === b.readOnly &&
    a.addAddon === b.addAddon &&
    a.setAddonStatus === b.setAddonStatus &&
    a.job.id === b.job.id &&
    a.job.addons === b.job.addons
  );
}

function FoundWorkSecFn({ job, seesPrice, readOnly, addAddon, setAddonStatus }: FoundWorkSecProps) {
  const [desc, setDesc] = useState("");
  const [price, setPrice] = useState("");

  const addons = job.addons ?? [];
  const awaiting = addons.filter((a) => a.status === "proposed").length;

  // Read-only with nothing to read = nothing to render (no dead empty section).
  if (readOnly && addons.length === 0) return null;

  function submit() {
    const d = desc.trim();
    if (!d) return;
    addAddon(job.id, { d, r: +price || 0 });
    setDesc("");
    setPrice("");
  }

  return (
    <div className="fsec">
      <div className="fsec-h">
        <span>Found work / add-ons</span>
        <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 600 }}>
          {addons.length}
          {awaiting ? ` · ${awaiting} awaiting OK` : ""}
        </span>
      </div>

      {addons.map((a) => (
        <div key={a.id} className="stage-row">
          <div style={{ flex: 1 }}>
            <b style={{ fontWeight: 600 }}>{a.d}</b>
            {/* a.r === null = server-redacted (techSeesPrice off) — show nothing, never $0. */}
            {seesPrice && a.r != null && <span className="muted"> · {fmt$(a.r)}</span>}
          </div>
          <AddonStatusPill status={a.status} />
          {!readOnly && a.status === "proposed" && (
            <>
              <button
                className="btn sm primary"
                onClick={() => setAddonStatus(job.id, a.id, "approved")}
              >
                ✓ Customer OK&rsquo;d
              </button>
              <button className="btn sm ghost" onClick={() => setAddonStatus(job.id, a.id, "declined")}>
                ✕
              </button>
            </>
          )}
        </div>
      ))}

      {!readOnly && (
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            placeholder="extra work found…"
            style={{ flex: 2, minWidth: 140, ...AO_INPUT }}
          />
          {seesPrice && (
            <input
              type="number"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              placeholder="price $"
              style={{ flex: "0 0 92px", ...AO_INPUT }}
            />
          )}
          <button className="btn sm primary" onClick={submit}>
            Add
          </button>
        </div>
      )}
    </div>
  );
}
const FoundWorkSec = memo(FoundWorkSecFn, foundWorkPropsEqual);

// ---- attached checklist, INTERACTIVE (prototype verifySection, 4876-4897) --
// The field "Before you leave" capture. Derives jobVerifyState(job) in the body
// (never inside a selector): each item pairs the checklist item with its answer;
// gaps = required + unanswered. Progress bar fills done/total (amber if gaps).
// One row, one primary action: tap to pass / Photo to capture. N/A + declined
// live behind a ⋯ kebab that expands in place (LOCAL expandedId state).

interface VerifyRow {
  it: ChecklistItem;
  a: VerifyAns | undefined;
}

interface VerifyState {
  items: VerifyRow[];
  gaps: VerifyRow[];
  done: number;
  total: number;
}

/** jobVerifyState (prototype 4826) — derive in the component body, not a selector. */
function jobVerifyState(job: Job): VerifyState | null {
  const cl = job.checklist;
  if (!cl) return null;
  const ans = job.verify?.ans ?? {};
  const items: VerifyRow[] = (cl.items ?? [])
    .filter((it) => (it.text ?? "").trim())
    .map((it) => ({ it, a: ans[it.id] }));
  if (!items.length) return null;
  const gaps = items.filter((x) => !x.a && x.it.required);
  return { items, gaps, done: items.filter((x) => x.a).length, total: items.length };
}

const OVERRIDE_REASONS = ["N/A", "Customer declined"] as const;

const VROW_BASE: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 11,
  padding: "10px 0",
  borderTop: "1px solid var(--line)",
  fontSize: 13.5,
};

interface ChecklistItemRowProps {
  jobId: string;
  row: VerifyRow;
  expanded: boolean;
  onCheck: () => void;
  onPhoto: () => void;
  onOverride: (reason: string) => void;
  onUndo: () => void;
  onToggleExpand: () => void;
}

// One verify row — answered (✓/⊘ + how + undo), or unanswered (tappable / Photo
// + ⋯ override). Ported 1:1 from verifySection's `row(x)`.
function ChecklistItemRow({
  row,
  expanded,
  onCheck,
  onPhoto,
  onOverride,
  onUndo,
  onToggleExpand,
}: ChecklistItemRowProps) {
  const { it, a } = row;

  if (a) {
    const ov = a.st === "override";
    const how = ov ? a.reason ?? "" : a.via === "photo" ? "photo" : "done";
    return (
      <div style={VROW_BASE}>
        <span
          style={{
            width: 16,
            flex: "none",
            textAlign: "center",
            fontWeight: 700,
            color: ov ? "var(--ink-3)" : "var(--green-700)",
          }}
        >
          {ov ? "⊘" : "✓"}
        </span>
        <span style={{ flex: 1, minWidth: 0, color: "var(--ink-2)" }}>{it.text}</span>
        <span className="muted" style={{ fontSize: 11.5, flex: "none" }}>
          {how}
        </span>
        <span
          className="linklike"
          style={{ fontSize: 11, flex: "none", color: "var(--ink-3)" }}
          onClick={onUndo}
        >
          undo
        </span>
      </div>
    );
  }

  const glyph = (
    <span
      style={{
        width: 16,
        flex: "none",
        textAlign: "center",
        fontWeight: 700,
        color: it.required ? "var(--amber)" : "var(--ink-3)",
      }}
    >
      ○
    </span>
  );

  const label = (
    <span style={{ flex: 1, minWidth: 0 }}>
      {it.text}
      {!it.required && (
        <span className="muted" style={{ fontSize: 11.5 }}>
          {" "}
          · optional
        </span>
      )}
    </span>
  );

  const ctrl =
    it.type === "photo" ? (
      <button
        className="btn sm ghost"
        style={{ flex: "none", padding: "5px 14px" }}
        onClick={(e) => {
          e.stopPropagation();
          onPhoto();
        }}
      >
        Photo
      </button>
    ) : null;

  const kebab = (
    <span
      className="linklike"
      style={{ flex: "none", color: "var(--ink-3)", fontSize: 17, lineHeight: 1, padding: "0 5px", fontWeight: 800 }}
      title="N/A or customer declined"
      onClick={(e) => {
        e.stopPropagation();
        onToggleExpand();
      }}
    >
      ⋯
    </span>
  );

  const expRow = expanded ? (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 0 11px 27px" }}>
      {OVERRIDE_REASONS.map((r) => (
        <button
          key={r}
          className="chip"
          style={{ padding: "3px 11px", fontSize: 11.5 }}
          onClick={() => onOverride(r)}
        >
          {r}
        </button>
      ))}
    </div>
  ) : null;

  // photo items keep the whole row un-tappable (the Photo button captures);
  // check items make the whole row a tap target.
  return (
    <>
      {it.type === "photo" ? (
        <div style={VROW_BASE}>
          {glyph}
          {label}
          {ctrl}
          {kebab}
        </div>
      ) : (
        <div style={{ ...VROW_BASE, cursor: "pointer" }} onClick={onCheck}>
          {glyph}
          {label}
          {ctrl}
          {kebab}
        </div>
      )}
      {expRow}
    </>
  );
}

interface ChecklistSecProps {
  job: Job;
  checkItem: (jobId: string, itemId: string) => void;
  overrideItem: (jobId: string, itemId: string, reason: string) => void;
  uncheckItem: (jobId: string, itemId: string) => void;
  addPhoto: (jobId: string) => void;
}

const ChecklistSec = memo(function ChecklistSec({ job, checkItem, overrideItem, uncheckItem, addPhoto }: ChecklistSecProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const vs = jobVerifyState(job);
  if (!vs) return null;

  const pct = Math.round((vs.done / vs.total) * 100);
  const barColor = vs.gaps.length ? "var(--amber)" : "var(--green-700)";

  return (
    <div className="fsec">
      <div className="fsec-h">
        <span>Before you leave</span>
        {job.checklist?.name ? (
          <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 600 }}>
            {job.checklist.name}
          </span>
        ) : null}
      </div>
      <div
        style={{ height: 4, borderRadius: 2, background: "var(--line)", overflow: "hidden", margin: "0 0 4px" }}
      >
        <div style={{ height: "100%", width: `${pct}%`, background: barColor }} />
      </div>
      {vs.items.map((row) => (
        <ChecklistItemRow
          key={row.it.id}
          jobId={job.id}
          row={row}
          expanded={expandedId === row.it.id}
          onCheck={() => checkItem(job.id, row.it.id)}
          onPhoto={() => addPhoto(job.id)}
          onOverride={(reason) => {
            overrideItem(job.id, row.it.id, reason);
            setExpandedId(null);
          }}
          onUndo={() => uncheckItem(job.id, row.it.id)}
          onToggleExpand={() => setExpandedId((cur) => (cur === row.it.id ? null : row.it.id))}
        />
      ))}
    </div>
  );
});

// ---- notes feed (reuses the job-modal NoteFeed pattern, prototype jobNoteFeed)
// Renders job.acts through the shared .nfeed chip rows. Renders nothing when
// there's nothing to show. bare — no card wrapper (the .fsec carries the label).

interface NoteEntry {
  key: string;
  chipCls: string;
  label: string;
  who: string;
  when: string;
  text: string;
}

function jobNoteEntries(job: Job): NoteEntry[] {
  const E: NoteEntry[] = [];

  if ((job.notes ?? "").trim()) {
    E.push({
      key: "office",
      chipCls: "gray",
      label: "Office",
      who: "Office",
      when: "before the job",
      text: job.notes.trim(),
    });
  }

  // Job.acts is typed loosely (unknown[]); read the seeded note shape off a
  // narrow view and skip anything without text.
  const acts = (job.acts as Array<{ by?: string; who?: string; when?: string; t?: string }>) ?? [];
  acts.forEach((n, i) => {
    if (!(n.t ?? "").trim()) return;
    const isTech = n.by === "tech";
    E.push({
      key: `act-${i}`,
      chipCls: "blue",
      label: isTech ? "Field" : "Office",
      who: n.who ?? (isTech ? "Crew" : "Office"),
      when: n.when ?? "",
      text: (n.t ?? "").trim(),
    });
  });

  return E;
}

const NOTE_SAVE_FAILED_COPY = "Couldn't save the note — try again.";

interface NoteFeedProps {
  job: Job;
  /**
   * Office-only + not-done gate for the composer: notes persist via
   * v1.jobs.update (ownerOrOffice — a tech write would FORBIDDEN + roll back)
   * and the server refuses edits on a complete job. Tech-writable notes
   * (v1.field.addNote + a real activity feed for job.acts) is a Phase-2
   * follow-up.
   */
  canCompose: boolean;
  updateJob: (id: string, patch: Partial<Job>) => Promise<{ ok: boolean }>;
}

// NoteFeed uses a custom comparator so a checklist tap (job.verify change)
// does NOT re-render it — it only reads job.notes, job.acts, and job.id.
export function noteFeedPropsEqual(a: NoteFeedProps, b: NoteFeedProps): boolean {
  return (
    a.canCompose === b.canCompose &&
    a.updateJob === b.updateJob &&
    a.job.id === b.job.id &&
    a.job.notes === b.job.notes &&
    a.job.acts === b.job.acts
  );
}

function NoteFeedFn({ job, canCompose, updateJob }: NoteFeedProps) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const entries = jobNoteEntries(job);

  async function addNote() {
    const t = text.trim();
    if (!t || saving) return;
    // Append one stamped line ("[Jul 13] …") to the job's notes blob; the
    // feed's .ntext renders white-space:pre-line so each line reads separately.
    const stamp = new Date(todayISO() + "T12:00:00").toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    const existing = (job.notes ?? "").trim();
    const next = existing ? `${existing}\n[${stamp}] ${t}` : `[${stamp}] ${t}`;
    setSaving(true);
    setError("");
    const { ok } = await updateJob(job.id, { notes: next });
    setSaving(false);
    if (!ok) {
      setError(NOTE_SAVE_FAILED_COPY);
      return;
    }
    setText("");
  }

  return (
    <div className="fsec">
      <div className="fsec-h">
        <span>Notes</span>
      </div>
      {entries.length > 0 ? (
        <div className="nfeed">
          {entries.map((n) => (
            <div className="nrow" key={n.key}>
              <div className="nmeta">
                <span className={`pill ${n.chipCls}`}>{n.label}</span>
                <span className="nwho">
                  {n.who ? `${n.who} · ` : ""}
                  {n.when || ""}
                </span>
              </div>
              <div className="ntext">{n.text}</div>
            </div>
          ))}
        </div>
      ) : !canCompose ? (
        // Zero entries and no composer — never a bare labeled header.
        <div className="muted" style={{ fontSize: 12.5 }}>
          No notes yet.
        </div>
      ) : null}
      {canCompose && (
        <>
          <div style={{ display: "flex", gap: 8, marginTop: entries.length > 0 ? 8 : 0 }}>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addNote();
              }}
              placeholder="add a note…"
              aria-label="Add a note"
              style={{ flex: 1, minWidth: 140, ...AO_INPUT }}
            />
            <button
              className="btn sm primary"
              aria-label="Add note"
              disabled={saving}
              onClick={() => void addNote()}
            >
              Add
            </button>
          </div>
          {error && (
            <div style={{ color: "var(--red)", fontSize: 12, marginTop: 6 }}>{error}</div>
          )}
        </>
      )}
    </div>
  );
}
const NoteFeed = memo(NoteFeedFn, noteFeedPropsEqual);

// ---- on-site close-out HERO (prototype techDoneBlock, 5698-5760) -----------
// The "job done → get paid on site" block, shown when the job is done. Branches
// on the invoice / due / card-on-file (mirrors the prototype's non-install path;
// the install-specific split is deferred). "Take payment" opens the CLOSE_OUT
// modal; charge-on-file records straight through recordPayment; send-to-office
// flags invRequested. A small Reopen affordance sits above the card.

interface DoneBlockProps {
  job: Job;
  lead: Lead | undefined;
  invoice: Invoice | undefined;
  onOpenCloseOut: () => void;
  onOpenInvoice: (invoiceId: string) => void;
  onChargeOnFile: () => void;
  onSendToOffice: () => void;
  onReopen: () => void;
}

// DoneBlock uses a custom comparator — it only reads job.invRequested and job.lines
// (via jobTotal), neither of which changes on a checklist tap.
export function doneBlockPropsEqual(a: DoneBlockProps, b: DoneBlockProps): boolean {
  return (
    a.onOpenCloseOut === b.onOpenCloseOut &&
    a.onOpenInvoice === b.onOpenInvoice &&
    a.onChargeOnFile === b.onChargeOnFile &&
    a.onSendToOffice === b.onSendToOffice &&
    a.onReopen === b.onReopen &&
    a.lead === b.lead &&
    a.invoice === b.invoice &&
    a.job.invRequested === b.job.invRequested &&
    a.job.lines === b.job.lines
  );
}

function DoneBlockFn({
  job,
  lead,
  invoice,
  onOpenCloseOut,
  onOpenInvoice,
  onChargeOnFile,
  onSendToOffice,
  onReopen,
}: DoneBlockProps) {
  // a draft invoice may already exist (opened pay then backed out) — that must
  // NOT remove the send-to-office option; due is read off it when present.
  const due = invoice ? invDue(invoice) : jobTotal(job);
  const card = lead?.card ?? null;

  const reopen = (
    <div style={{ display: "flex", justifyContent: "flex-end", margin: "14px 0 0" }}>
      <button className="btn sm ghost" onClick={onReopen}>
        ↩ Reopen
      </button>
    </div>
  );

  // Paid — a priced invoice fully settled.
  if (invoice && (invoice.total ?? 0) > 0 && invDue(invoice) <= 0) {
    return (
      <>
        {reopen}
        <div className="tjpaid ok">
          <div className="tjpaid-top">
            <b>✓ Paid · {fmt$(invoice.total ?? 0)}</b>
          </div>
          <div className="tjpaid-sub">
            <span className="linklike" onClick={() => onOpenInvoice(invoice.id)}>
              receipt &amp; invoice
            </span>
          </div>
        </div>
      </>
    );
  }

  // Handed to the office to bill.
  if (job.invRequested) {
    return (
      <>
        {reopen}
        <div className="tjpaid ok">
          <div className="tjpaid-top">
            <b>✓ Sent to the office</b>
          </div>
          <div className="tjpaid-sub">
            The office texts the customer a pay link ·{" "}
            <span className="linklike" onClick={onOpenCloseOut}>
              take payment instead
            </span>
          </div>
        </div>
      </>
    );
  }

  // Due + card on file — charge it, take another way, or hand to the office.
  if (due > 0 && card) {
    return (
      <>
        {reopen}
        <div className="tjpaid">
          <div className="tjpaid-top">
            <b>✓ Job done</b>
            <span className="tjpaid-amt fig">{fmt$(due)}</span>
          </div>
          <button className="tjpaid-btn" onClick={onChargeOnFile}>
            Charge {fmt$(due)} to {card.brand} ···· {card.last4}
          </button>
          <button className="tjpaid-btn2" onClick={onOpenCloseOut}>
            Take payment another way →
          </button>
          <button className="tjpaid-btn2" onClick={onSendToOffice}>
            Send to the office to bill
          </button>
        </div>
      </>
    );
  }

  // Due, no card — take payment, or hand to the office.
  if (due > 0) {
    return (
      <>
        {reopen}
        <div className="tjpaid">
          <div className="tjpaid-top">
            <b>✓ Job done</b>
            <span className="tjpaid-amt fig">{fmt$(due)}</span>
          </div>
          <button className="tjpaid-btn" onClick={onOpenCloseOut}>
            Take payment →
          </button>
          <button className="tjpaid-btn2" onClick={onSendToOffice}>
            Send to the office to bill
          </button>
        </div>
      </>
    );
  }

  // No price yet — the office invoices it (opening close-out can set a bill).
  return (
    <>
      {reopen}
      <div className="tjpaid">
        <div className="tjpaid-top">
          <b>✓ Job done</b>
        </div>
        <div className="tjpaid-sub" style={{ marginBottom: 8 }}>
          No price set — the office invoices it.
        </div>
        <button className="tjpaid-btn" onClick={onSendToOffice}>
          Send to the office to bill
        </button>
        <button className="tjpaid-btn2" onClick={onOpenCloseOut}>
          Set a bill &amp; take payment →
        </button>
      </div>
    </>
  );
}
const DoneBlock = memo(DoneBlockFn, doneBlockPropsEqual);

// ---- the modal body --------------------------------------------------------

export function TechJobModalContent() {
  const activeModal = useActiveModal();
  const openModal = useOpenModal();
  const close = useCloseModal();

  // Role gate: this modal is shared by owner/office (full controls) and techs.
  // Controls wired to ownerOrOffice endpoints (visit status, add-ons, payments,
  // send-to-office) would FORBIDDEN + silently roll back for a tech — they are
  // office-only. Fail closed: until the role loads, show the tech (reduced) view.
  const me = useMe();
  const isOffice = me.data?.role === "owner" || me.data?.role === "office";

  // Extract jobId before all store subscriptions so by-id selectors below can
  // capture it in their closure. useActiveModal is already narrow (scalar).
  const jobId = activeModal?.params?.jobId as string | undefined;

  // --- By-id selectors (narrow subscriptions) --------------------------------
  // reconcileJob replaces only the matched entry in jobs.map — untouched jobs
  // keep their object identity, so find(j => j.id === jobId) is referentially
  // stable across unrelated writes. Same pattern for lead and invoice.
  const job = useAppStore((s) => s.jobs.find((j) => j.id === jobId));
  const leadId = job?.leadId;
  const lead = useAppStore((s) => s.leads.find((l) => l.id === leadId));
  // The job's invoice links via invoice.jobId (NOT job.invoiceId).
  const invoice = useAppStore((s) => s.invoices.find((i) => i.jobId === jobId));

  // Store actions — stable function references (Zustand guarantees action
  // identity across renders; selecting them here avoids re-subscribing the
  // parent when only the job object changes).
  const setVisitStatus = useAppStore((s) => s.setVisitStatus);
  const updateJob = useAppStore((s) => s.updateJob);
  const recordPayment = useAppStore((s) => s.recordPayment);
  // Money in the tech view is gated by this permission toggle (a scalar — safe
  // to select directly; never derive an array in a selector).
  const seesPrice = useAppStore((s) => s.toggles.techSeesPrice);
  const addAddon = useAppStore((s) => s.addAddon);
  const setAddonStatus = useAppStore((s) => s.setAddonStatus);
  const checkVerifyItem = useAppStore((s) => s.checkVerifyItem);
  const overrideVerifyItem = useAppStore((s) => s.overrideVerifyItem);
  const uncheckVerifyItem = useAppStore((s) => s.uncheckVerifyItem);
  const addJobPhoto = useAppStore((s) => s.addJobPhoto);

  // Derived values computed after all hooks (never inside selectors to avoid
  // creating new object references on every store write).
  const custName = job ? custNameOf(job, lead) : "";
  const addr = (job?.addr || lead?.address || "") as string;
  const quoted = job ? jobQuoted(job) : false;
  const done = job?.status === "done";
  // The tech only sees PLACED visits — never "Invalid Date" rows in the field.
  const placed = (job?.visits ?? []).filter(vPlaced);
  const curVisit = currentVisit(placed);

  // --- useCallback-stabilized handlers for memoized child components ---------
  // These are referentially stable across re-renders when their captured
  // store-action dependencies don't change (store actions are stable by
  // Zustand's contract). jobId is a primitive string — stable once the modal is
  // open. curVisit.id can change, so the reopen handler captures curVisit.

  const onVisitStatus = useCallback(
    (visitId: string, status: string) => {
      if (!jobId) return;
      setVisitStatus(jobId, visitId, status);
    },
    [jobId, setVisitStatus],
  );

  const chargeOnFile = useCallback(() => {
    // charge the balance to the card on file — the "paid before they left" play.
    if (!invoice) return;
    const card = lead?.card;
    const dueNow = invDue(invoice);
    if (dueNow <= 0 || !card) return;
    recordPayment(invoice.id, { amt: dueNow, when: "Just now", method: "card", onFile: true });
  }, [invoice, lead, recordPayment]);

  const openCloseOut = useCallback(() => {
    if (!jobId) return;
    openModal(MODAL.CLOSE_OUT, { jobId });
  }, [jobId, openModal]);

  const openInvoiceModal = useCallback(
    (invoiceId: string) => openModal(MODAL.INVOICE, { invoiceId }),
    [openModal],
  );

  const sendToOffice = useCallback(() => {
    if (!jobId) return;
    updateJob(jobId, { invRequested: true });
    close();
  }, [jobId, updateJob, close]);

  const onReopen = useCallback(() => {
    if (curVisit) onVisitStatus(curVisit.id, "scheduled");
  }, [curVisit, onVisitStatus]);

  const navigate = useCallback(() => {
    // maps deep-link — open the address in the device's maps app.
    if (addr) window.open(`https://maps.google.com/?q=${encodeURIComponent(addr)}`, "_blank");
  }, [addr]);

  const onPriceOnSite = useCallback(() => {
    if (!jobId) return;
    openModal(MODAL.TECH_QUOTE, { jobId });
  }, [jobId, openModal]);

  // Early return AFTER all hooks (rules of hooks).
  if (!job) return null;

  return (
    <div>
      {/* 1. Header — avatar + name + service word + title. NO status pill. */}
      <TechHeader job={job} custName={custName} />

      {/* 2. Call / Text — office only. Techs don't see these at all (leads never
          hydrate under the field shell; the myDay summary carries no customer
          phone). For the office the buttons stay TAPPABLE: the call sheet / thread
          each prompt to add a number in-flow when none is on file. They disable
          only with NO linked customer (nobody to call). */}
      {isOffice && (
        <div style={{ marginBottom: 0 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn"
              disabled={!lead}
              title={!lead ? "No linked customer" : undefined}
              onClick={() => {
                if (lead) openModal(MODAL.CALL, { leadId: lead.id });
              }}
            >
              Call
            </button>
            <button
              className="btn"
              disabled={!lead}
              title={!lead ? "No linked customer" : undefined}
              onClick={() => {
                if (lead) openModal(MODAL.THREAD, { leadId: lead.id });
              }}
            >
              Text
            </button>
          </div>
        </div>
      )}

      {/* 3. Address — tappable Navigate row, or the muted no-address line. */}
      {addr ? (
        <button className="jaddr" onClick={navigate}>
          <svg
            viewBox="0 0 24 24"
            width="17"
            height="17"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <span style={{ flex: 1, minWidth: 0 }}>{addr}</span>
          <span className="nav">Navigate →</span>
        </button>
      ) : (
        <div className="muted" style={{ fontSize: 12.5, margin: "12px 0 4px" }}>
          No address on this job yet.
        </div>
      )}

      {/* 4. Field timer (hero when not done) — or the on-site close-out HERO.
          The close-out hero is office-only: charge-on-file / take-payment /
          send-to-office all write through ownerOrOffice endpoints. */}
      {done ? (
        isOffice ? (
          <DoneBlock
            job={job}
            lead={lead}
            invoice={invoice}
            onOpenCloseOut={openCloseOut}
            onOpenInvoice={openInvoiceModal}
            onChargeOnFile={chargeOnFile}
            onSendToOffice={sendToOffice}
            onReopen={onReopen}
          />
        ) : null
      ) : curVisit ? (
        <FieldTimer key={curVisit.id} visit={curVisit} />
      ) : null}

      {/* Work order (5a) — install job, not done, with scope lines (office-sold). */}
      {jobMode(job) === "install" &&
      !done &&
      (job.lines ?? []).some((l) => (l.d ?? "").trim()) ? (
        <WorkOrderSec job={job} seesPrice={seesPrice} />
      ) : null}

      {/* 5. Your visit(s). */}
      <div className="fsec">
        <div className="fsec-h">
          <span>Your visit{placed.length > 1 ? "s" : ""}</span>
          {done && (
            <span style={{ color: "var(--green-700)", fontWeight: 700 }}>✓ Done</span>
          )}
        </div>
        {done ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {curVisit
                ? `${colLabel(curVisit.date)} · ~${hmLabel(curVisit.dur)} on site`
                : "Completed"}
            </span>
            {/* Reopen writes visit status (ownerOrOffice) — office only. */}
            {isOffice && (
              <button
                className="btn sm ghost"
                onClick={() => {
                  if (curVisit) onVisitStatus(curVisit.id, "scheduled");
                }}
              >
                ↩ Reopen
              </button>
            )}
          </div>
        ) : placed.length ? (
          placed.map((v) => (
            <VisitRow
              key={v.id}
              visit={v}
              quoted={quoted}
              readOnly={!isOffice}
              onStatus={(status) => onVisitStatus(v.id, status)}
            />
          ))
        ) : (
          <div className="empty-att" style={{ marginBottom: 0 }}>
            Not scheduled yet — the office will set the time.
          </div>
        )}
      </div>

      {/* 6. Pricing / Scope (only when not done). */}
      {!done && (
        <PricingSec
          job={job}
          quoted={quoted}
          onPriceOnSite={onPriceOnSite}
        />
      )}

      {/* Found work / add-ons (5b) — read-only for techs (add + status are office writes). */}
      <FoundWorkSec
        job={job}
        seesPrice={seesPrice}
        readOnly={!isOffice}
        addAddon={addAddon}
        setAddonStatus={setAddonStatus}
      />

      {/* 7. Before you leave — attached checklist, INTERACTIVE (5c). */}
      <ChecklistSec
        job={job}
        checkItem={checkVerifyItem}
        overrideItem={overrideVerifyItem}
        uncheckItem={uncheckVerifyItem}
        addPhoto={addJobPhoto}
      />

      {/* 8. Notes feed — office composes while the job is open (same gate as
          Call/Text; the server refuses note edits once the job is complete). */}
      <NoteFeed job={job} canCompose={isOffice && !done} updateJob={updateJob} />
    </div>
  );
}
