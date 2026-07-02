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
 * Deferred chunks (faithful placeholders / comments below, each a later task):
 *   - work order fold (install scope, workOrderBlock)      // deferred: work order (install scope)
 *   - found-work / add-ons (aoSection)                     // deferred: found-work add-ons
 *   - interactive "Before you leave" capture (verifySection) — attached checklist
 *     renders READ-ONLY when present                       // deferred: interactive checklist capture
 *   - on-site close-out / collect (techDoneBlock)          // deferred: on-site close-out / collect
 *   - tech GBB + on-glass signature (openTechQuote / tq)   // deferred: tech GBB + on-glass signature
 */

"use client";

import { useEffect, useRef, useState } from "react";
import {
  useActiveModal,
  useOpenModal,
  useAppStore,
} from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { Job, Visit, Lead } from "@/lib/store/types";

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

function fmt$(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function jobTotal(j: Job): number {
  return (j.lines ?? []).reduce((s, l) => s + (l.q ?? 1) * (l.r ?? 0), 0);
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

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
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

  const liveSec =
    baseSec + (running && startedAtRef.current != null ? (now - startedAtRef.current) / 1000 : 0);
  const elapsedH = liveSec / 3600;

  function start() {
    startedAtRef.current = Date.now();
    setNow(Date.now());
    setRunning(true);
  }

  function pause() {
    if (running && startedAtRef.current != null) {
      setBaseSec((s) => s + (Date.now() - startedAtRef.current!) / 1000);
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
  onStatus: (status: string) => void;
}

function VisitRow({ visit, quoted, onStatus }: VisitRowProps) {
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
      <div style={{ display: "flex", gap: 8 }}>
        {step}
        {doneB}
      </div>
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

// ---- attached checklist, READ-ONLY (prototype verifySection, deferred capture)
// Renders when the job carries an office-attached checklist, mirroring the
// job-modal attached view (○ / 📷 + text + "required"). Interactive capture
// (tap to pass / photo / override) is the field-verify surface.
// deferred: interactive checklist capture

function ChecklistSec({ job }: { job: Job }) {
  const cl = job.checklist;
  if (!cl) return null;
  const items = (cl.items ?? []).filter((it) => (it.text ?? "").trim());
  if (!items.length) return null;

  return (
    <div className="fsec">
      <div className="fsec-h">
        <span>Before you leave</span>
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>
        {cl.name}
      </div>
      {items.map((it) => (
        <div key={it.id} className="stage-row" style={{ gap: 8, padding: "4px 0" }}>
          <span style={{ color: it.required ? "var(--amber)" : "var(--ink-3)" }}>
            {it.type === "photo" ? "📷" : "○"}
          </span>
          <span style={{ flex: 1, fontSize: 13 }}>{it.text}</span>
          {it.required && (
            <span className="muted" style={{ fontSize: 11 }}>
              required
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

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

function NoteFeed({ job }: { job: Job }) {
  const entries = jobNoteEntries(job);

  return (
    <div className="fsec">
      <div className="fsec-h">
        <span>Notes</span>
      </div>
      {entries.length === 0 ? null : (
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
      )}
    </div>
  );
}

// ---- the modal body --------------------------------------------------------

export function TechJobModalContent() {
  const activeModal = useActiveModal();
  const openModal = useOpenModal();

  const jobs = useAppStore((s) => s.jobs);
  const leads = useAppStore((s) => s.leads);
  const setVisitStatus = useAppStore((s) => s.setVisitStatus);

  const jobId = activeModal?.params?.jobId as number | undefined;
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return null;

  const lead: Lead | undefined = leads.find((l) => l.id === job.leadId);
  const custName = custNameOf(job, lead);
  const addr = job.addr || lead?.address || "";
  const quoted = jobQuoted(job);
  const done = job.status === "done";

  // The tech only sees PLACED visits — never "Invalid Date" rows in the field.
  const placed = (job.visits ?? []).filter(vPlaced);
  const curVisit = currentVisit(placed);

  function onVisitStatus(visitId: number, status: string) {
    if (!job) return;
    setVisitStatus(job.id, visitId, status);
    // deferred: on-site close-out / collect (techDoneBlock payment flow on Done)
  }

  function navigate() {
    // maps deep-link — open the address in the device's maps app.
    if (addr) window.open(`https://maps.google.com/?q=${encodeURIComponent(addr)}`, "_blank");
  }

  return (
    <div>
      {/* 1. Header — avatar + name + service word + title. NO status pill. */}
      <TechHeader job={job} custName={custName} />

      {/* 2. Call / Text (only when a lead is linked). */}
      <div style={{ display: "flex", gap: 8, marginBottom: 0, flexWrap: "wrap" }}>
        <button
          className="btn"
          onClick={() => {
            if (lead) openModal(MODAL.CALL, { leadId: lead.id });
          }}
        >
          Call
        </button>
        <button
          className="btn"
          onClick={() => {
            if (lead) openModal(MODAL.THREAD, { leadId: lead.id });
          }}
        >
          Text
        </button>
      </div>

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

      {/* 4. Field timer (hero when not done) — or the slim Done · Reopen line. */}
      {done ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            margin: "14px 0 2px",
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--green-700)" }}>✓ Done</span>
          <button
            className="btn sm ghost"
            onClick={() => {
              if (curVisit) onVisitStatus(curVisit.id, "scheduled");
            }}
          >
            ↩ Reopen
          </button>
        </div>
      ) : curVisit ? (
        <FieldTimer key={curVisit.id} visit={curVisit} />
      ) : null}

      {/* deferred: work order (install scope) — the sold-install handoff fold. */}

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
            <button
              className="btn sm ghost"
              onClick={() => {
                if (curVisit) onVisitStatus(curVisit.id, "scheduled");
              }}
            >
              ↩ Reopen
            </button>
          </div>
        ) : placed.length ? (
          placed.map((v) => (
            <VisitRow
              key={v.id}
              visit={v}
              quoted={quoted}
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
          onPriceOnSite={() => openModal(MODAL.PRICE_BUILDER, { jobId: job.id })}
        />
      )}

      {/* deferred: found-work add-ons (aoSection). */}

      {/* 7. Before you leave — attached checklist, READ-ONLY. */}
      <ChecklistSec job={job} />

      {/* 8. Notes feed. */}
      <NoteFeed job={job} />

      {/* deferred: tech GBB + on-glass signature (openTechQuote / tq builder). */}
    </div>
  );
}
