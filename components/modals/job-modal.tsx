/**
 * components/modals/job-modal.tsx
 * Faithful port of the prototype's openJob office/owner body (lines 4699-4729)
 * plus its per-visit visitRow (4677-4698) and helpers jobPriceSummary (4513),
 * jobNoteFeed (6364), moneyPointer (6379).
 *
 * OFFICE/OWNER ONLY — the tech field view (techJobHtml, gated by
 * state.role==='tech') is a different Field-area surface and is NOT built here.
 *
 * LOCKED product rule: money lives in Finance. This modal shows the PRICE the
 * office set (line items + Total) and at most ONE anchored money pointer —
 * never cost / margin / profit / P&L.
 *
 * Deferred (surfaces not built yet):
 *   - the tech quote builder ("Build the price" / Edit) — a Field-area surface (tq)
 *   - the signed-agreement viewer (openSignedDoc)
 *   - smartPanel's ⏱ estimate line + split suggestion (need estJobHours →
 *     pricebook/DUR_RULES the store doesn't seed); the dispatch suggestion IS built
 *   - the checklist template picker / attached-checklist editor (need
 *     state.verifyOn + state.checklists — only "+ Add a checklist" is built)
 *   - the skills-gap per-visit banner (needs suggestTechFor / techHasSkill)
 *   - the invoice modal (opened from the money pointer — Money-area task)
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  useActiveModal,
  useCloseModal,
  useOpenModal,
  useAppStore,
} from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { Estimate, Job, Visit, Lead, Tech, Invoice } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";
import { todayISO } from "@/lib/clock";
import { DurField } from "./dur-field";

// ---- helpers ported 1:1 from the prototype --------------------------------

const JST: Record<string, { l: string; c: string; bg: string }> = {
  unscheduled: { l: "Unscheduled", c: "var(--amber)", bg: "var(--amber-bg)" },
  scheduled: { l: "Scheduled", c: "var(--ink-2)", bg: "var(--paper)" },
  enroute: { l: "On the way", c: "var(--ink-2)", bg: "var(--paper)" },
  onsite: { l: "On site", c: "var(--green-700)", bg: "var(--green-50)" },
  done: { l: "Done", c: "var(--ink-3)", bg: "var(--paper)" },
};

interface SvcMeta { edge: string }

const SVC_META: Record<string, SvcMeta> = {
  estimate: { edge: "var(--amber)" },
  service: { edge: "#9C5B34" },
  install: { edge: "#4A639E" },
};

function svcEdge(key: string): string {
  return (SVC_META[key] ?? SVC_META.service!).edge;
}


function jobTotal(j: Job): number {
  return (j.lines ?? []).reduce((s, l) => s + (l.q ?? 1) * (l.r ?? 0), 0);
}

/** priced → "install" (blue), unpriced job → "service" (brown), estimate → estimate */
function jobMode(j: Job): string {
  if (j.svc === "estimate") return "estimate";
  const priced = (j.lines ?? []).some((l) => (l.q ?? 1) * (l.r ?? 0) > 0);
  return priced ? "install" : "service";
}

/** A visit is PLACED once it has a day + crew + start (prototype vPlaced). */
function vPlaced(v: Visit): boolean {
  return !!(v.date && v.techId != null && v.start != null);
}

function stpillStyle(status: string): { color: string; background: string } {
  const s = JST[status] ?? JST.scheduled!;
  return { color: s.c, background: s.bg };
}

function stpillLabel(status: string): string {
  return (JST[status] ?? JST.scheduled!).l;
}

// ---- time helpers (prototype hToTime / timeToH) ----------------------------

function hToTime(h: number): string {
  let hr = Math.floor(h);
  let mn = Math.round((h - hr) * 60);
  if (mn === 60) {
    hr++;
    mn = 0;
  }
  return String(hr).padStart(2, "0") + ":" + String(mn).padStart(2, "0");
}

function timeToH(s: string): number {
  const p = (s || "").split(":");
  return (Number(p[0]) || 0) + (Number(p[1]) || 0) / 60;
}

function colLabel(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2);
}

// ---- invoice helpers (prototype invPaid / invDue) --------------------------

function invPaid(i: Invoice): number {
  return (i.payments ?? []).reduce((s, p) => s + (p.amt ?? 0), 0);
}

function invDue(i: Invoice): number {
  return Math.max(0, (i.total ?? 0) - (i.depPaid ?? 0) - invPaid(i));
}

// ---- minute-precise Length field: extracted to ./dur-field (draft-input
// rewrite — commit on blur/Enter instead of per-keystroke clamping) ----------

// ---- visit row (prototype visitRow, lines 4677-4698) -----------------------

interface VisitRowProps {
  job: Job;
  visit: Visit;
  techs: Tech[];
  conflict: boolean;
  onUpdate: (patch: Partial<Visit>) => void;
  onRemove: () => void;
  onGoToSchedule: () => void;
}

function VisitRow({ job, visit, techs, conflict, onUpdate, onRemove, onGoToSchedule }: VisitRowProps) {
  // UNPLACED — dashed row with a "Not placed" pill, Length, and where-to-next hint.
  if (!vPlaced(visit)) {
    return (
      <div
        style={{
          border: "1px dashed var(--line)",
          borderRadius: 11,
          padding: 11,
          marginBottom: 8,
          display: "flex",
          gap: 12,
          alignItems: "flex-end",
          flexWrap: "wrap",
        }}
      >
        <span className="pill amber" style={{ alignSelf: "center" }}>
          Not placed
        </span>
        <DurField dur={visit.dur} onChange={(dur) => onUpdate({ dur })} />
        <span
          className="muted"
          style={{ fontSize: 11.5, flex: 1, minWidth: 140, alignSelf: "center" }}
        >
          Set the hours, then place it on the Schedule board for the crew, day &amp; time.
        </span>
        <button
          type="button"
          className="linklike"
          style={{ fontSize: 11.5, alignSelf: "center" }}
          onClick={onGoToSchedule}
        >
          Open the Schedule board →
        </button>
        <span
          className="linklike"
          style={{ color: "var(--red)", fontSize: 12, alignSelf: "center" }}
          onClick={onRemove}
        >
          remove
        </span>
      </div>
    );
  }

  const techFirst =
    techs.find((t) => t.id === visit.techId)?.name.split(" ")[0] ?? "this crew";

  // PLACED — bordered row (red border on conflict) with Day / Crew / Start / Length.
  return (
    <div
      style={{
        border: `1px solid ${conflict ? "var(--red)" : "var(--line)"}`,
        borderRadius: 11,
        padding: 11,
        marginBottom: 8,
      }}
    >
      <div className="row2" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Day</label>
          <input
            type="date"
            value={visit.date ?? ""}
            min={todayISO()}
            onChange={(e) => onUpdate({ date: e.target.value })}
          />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Crew</label>
          <select
            value={visit.techId ?? ""}
            onChange={(e) => onUpdate({ techId: e.target.value || null })}
          >
            {techs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        className="row2"
        style={{ gridTemplateColumns: "1fr auto", gap: 10, marginTop: 8, alignItems: "end" }}
      >
        <div className="field" style={{ margin: 0 }}>
          <label>Start</label>
          <input
            type="time"
            value={hToTime(visit.start ?? 0)}
            step={60}
            onChange={(e) => onUpdate({ start: timeToH(e.target.value) })}
          />
        </div>
        <DurField dur={visit.dur} onChange={(dur) => onUpdate({ dur })} />
      </div>

      {conflict && (
        <div className="banner" style={{ marginTop: 8 }}>
          ⚠ Overlaps another visit for {techFirst} on{" "}
          {visit.date ? colLabel(visit.date) : "that day"} — <b>Mallet flagged the clash</b> — nudge the time.
        </div>
      )}

      {/* deferred: smartPanel skills-gap per-visit banner (suggestTechFor / techHasSkill) */}

      <div
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          marginTop: 9,
          flexWrap: "wrap",
        }}
      >
        <span className="stpill" style={stpillStyle(visit.status)}>
          {stpillLabel(visit.status)}
        </span>
        <span style={{ marginLeft: "auto" }}>
          <span
            className="linklike"
            style={{ color: "var(--red)", fontSize: 12 }}
            onClick={onRemove}
          >
            remove visit
          </span>
        </span>
      </div>
    </div>
  );
}

// ---- price summary (prototype jobPriceSummary, line 4513) ------------------
// PRICE ONLY — line items + Total. Never cost / margin / profit (LOCKED rule).

interface PriceSummaryProps {
  job: Job;
  onBuildPrice: () => void;
  onViewQuote: (estId: string) => void;
}

/**
 * Derive a display total for the quote pointer row.
 * Uses cachedTotal when lines are empty (list-hydrated estimate), otherwise sums lines.
 * Exported for unit testing.
 */
export function estDisplayTotal(est: Estimate): number | null {
  if (est.lines.length > 0) {
    return est.lines.reduce((sum, l) => sum + (l.q ?? 1) * (l.r ?? 0), 0);
  }
  return est.cachedTotal ?? null;
}

export function PriceSummary({ job, onBuildPrice, onViewQuote }: PriceSummaryProps) {
  const estimates = useAppStore((s) => s.estimates);

  if (jobMode(job) === "estimate") return null;
  const hasLines = (job.lines ?? []).length > 0;

  // When this job was created from an accepted quote and has no lines of its own,
  // show a pointer to the source quote instead of the "Build the price" prompt.
  // LOCKED rule: money lives in Finance, not here — this is a read-only pointer only.
  if (!hasLines && job.sourceEstimateId) {
    const est = estimates.find((e) => e.id === job.sourceEstimateId);
    const total = est ? estDisplayTotal(est) : null;
    const label =
      est && total !== null
        ? `Priced from quote ${est.num} — ${fmt$(total)}`
        : "Priced from its quote";
    return (
      <div style={{ margin: "14px 0 0", display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 13 }}>{label}</span>
        {est && (
          <span
            className="linklike"
            style={{ fontSize: 12 }}
            onClick={() => onViewQuote(est.id)}
          >
            View the quote →
          </span>
        )}
      </div>
    );
  }

  if (!hasLines) {
    return (
      <div style={{ margin: "14px 0 0" }}>
        <span
          className="linklike"
          style={{ fontSize: 13, fontWeight: 700 }}
          onClick={onBuildPrice}
        >
          ✦ Build the price →
        </span>{" "}
        <span className="muted" style={{ fontSize: 11.5 }}>
          or price it later
        </span>
      </div>
    );
  }

  return (
    <div className="card" style={{ margin: "14px 0 0", background: "var(--paper)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ fontSize: 13, margin: 0 }}>Price</h3>
        <span className="linklike" style={{ fontSize: 12 }} onClick={onBuildPrice}>
          Edit
        </span>
      </div>
      {(job.lines ?? []).map((x, i) => (
        <div
          key={i}
          style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}
        >
          <span>
            {x.d}
            {(x.q ?? 1) > 1 ? ` ×${x.q}` : ""}
          </span>
          <b className="fig">{fmt$((x.q ?? 1) * (x.r ?? 0))}</b>
        </div>
      ))}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontWeight: 800,
          fontSize: 15,
          borderTop: "1px solid var(--line)",
          marginTop: 5,
          paddingTop: 5,
        }}
      >
        <span>Total</span>
        <span className="fig">{fmt$(jobTotal(job))}</span>
      </div>
    </div>
  );
}

// ---- note feed (prototype jobNoteFeed, line 6364) --------------------------
// The job's living record: office note + job notes + found-work + completion,
// through the shared .nfeed chip rows. Read-only here (add-note composer lives
// in the Field-area tech surface); renders nothing when there's nothing to show.

interface NoteEntry {
  key: string;
  chipCls: string;
  label: string;
  who: string;
  when: string;
  text: string;
  cust: boolean;
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
      cust: false,
    });
  }

  // Job type carries only `acts: unknown[]`; jobNotes / addons / completion are
  // extended sample fields the store's seeded Job doesn't type. Read them off a
  // loose view so a richer seed renders faithfully, and skip when absent.
  const rich = job as Job & {
    jobNotes?: Array<{ by?: string; who?: string; when?: string; t?: string }>;
    completion?: string;
  };
  const addons = (job.addons as Array<{ d?: string; status?: string; when?: string }>) ?? [];

  (rich.jobNotes ?? []).forEach((n, i) => {
    const isTech = n.by === "tech";
    E.push({
      key: `note-${i}`,
      chipCls: "blue",
      label: isTech ? "Field" : "Office",
      who: n.who ?? (isTech ? "Crew" : "Office"),
      when: n.when ?? "",
      text: n.t ?? "",
      cust: false,
    });
  });

  addons.forEach((a, i) => {
    const st =
      a.status === "proposed"
        ? " — awaiting OK"
        : a.status === "approved"
          ? " — OK’d"
          : a.status === "declined"
            ? " — declined"
            : "";
    E.push({
      key: `addon-${i}`,
      chipCls: "amber",
      label: "Found work",
      who: "Tech",
      when: a.when ?? "",
      text: `${a.d ?? ""}${st}`,
      cust: false,
    });
  });

  if ((rich.completion ?? "").trim()) {
    E.push({
      key: "completion",
      chipCls: "green",
      label: "Completed",
      who: "Tech",
      when: "",
      text: (rich.completion ?? "").trim(),
      cust: true,
    });
  }

  return E;
}

function NoteFeed({ job }: { job: Job }) {
  const entries = jobNoteEntries(job);
  if (entries.length === 0) return null;

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h3 style={{ fontSize: 13 }}>Notes</h3>
      <div className="nfeed">
        {entries.map((n) => (
          <div className="nrow" key={n.key}>
            <div className="nmeta">
              <span className={`pill ${n.chipCls}`}>{n.label}</span>
              <span className="nwho">
                {n.who ? `${n.who} · ` : ""}
                {n.when || ""}
                {n.cust ? " · " : ""}
                {n.cust ? <b>customer sees</b> : ""}
              </span>
            </div>
            <div className="ntext">{n.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---- smartPanel (prototype smartPanel, line 3880) --------------------------
// Skill-gap / dispatch suggestion surface. The prototype gates three hints
// behind state.opsAI flags: an estimated-hours line, a "split into N visits"
// suggestion, and a "best fit crew" dispatch suggestion. The store carries no
// opsAI flags and no pricebook/DUR_RULES, so:
//   - deferred: the ⏱ estimate line and the split suggestion both need
//     estJobHours(job), which reads the pricebook the store doesn't seed —
//     render nothing for those two hints (degrade gracefully).
//   - the dispatch suggestion is the hint that uses real store data
//     (Tech.skills + this-day crew load), so it's replicated faithfully.
// The .smartwrap / .smartsug markup + classes are kept exactly.

const SKILL_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/hvac|furnace|condenser|mini.?split|heat pump|tune.?up|\bac\b|a\/c/i, "EPA 608 (HVAC)"],
  [/panel|service upgrade|outlet|fixture|electrical|switch/i, "Electrical"],
  [/backflow/i, "Backflow"],
  [/\bgas\b/i, "Gas"],
  [/drain|sewer|camera|jet|main line/i, "Drain / sewer"],
  [/repipe|water heater|faucet|toilet|plumb/i, "Journeyman Plumber"],
];

/** The cert a job's title + line items imply (prototype jobNeededSkill, 3869). */
function jobNeededSkill(job: Job): string | null {
  const t = (job.title || "") + " " + (job.lines ?? []).map((l) => l.d).join(" ");
  for (const [re, sk] of SKILL_RULES) if (re.test(t)) return sk;
  return null;
}

/** Does a crew hold the needed cert, incl. the master→journeyman rollups (3870). */
function techHasSkill(tc: Tech | undefined, sk: string | null): boolean {
  if (!sk) return true;
  if (!tc) return false;
  const has = tc.skills ?? [];
  if (has.includes(sk)) return true;
  if (sk === "Journeyman Plumber" && has.includes("Master Plumber")) return true;
  if (sk === "Electrical" && (has.includes("Master Electrician") || has.includes("Journeyman Electrician")))
    return true;
  return false;
}

/** Booked hours for a crew on a day, across all this job's placed visits (dayLoad, 3874). */
function jobDayLoad(job: Job, techId: string, iso: string): number {
  return (job.visits ?? [])
    .filter((v) => v.techId === techId && v.date === iso)
    .reduce((s, v) => s + v.dur, 0);
}

// ---- job checklist block (prototype jobChecklistBlock, line 4859) ----------
// Opt-in, office-attached checklist the crew runs before they leave. The
// prototype gates the whole block behind state.verifyOn and its template
// picker reads state.checklists — neither is in the store. So we render the
// faithful "+ Add a checklist" entry point (exact markup + copy + .linklike);
// the actual template attach / picker card is deferred (no template data yet).

function JobChecklistBlock({ job }: { job: Job }) {
  const checklists = useAppStore((s) => s.checklists);
  const updateJob = useAppStore((s) => s.updateJob);
  const [picking, setPicking] = useState(false);
  const templates = checklists.filter((c) => c.stage === "job");

  // Already attached → show it (+ Remove).
  if (job.checklist) {
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h3 style={{ margin: 0, fontSize: 13 }}>Before you leave</h3>
          <span
            className="linklike"
            style={{ fontSize: 12 }}
            onClick={() => updateJob(job.id, { checklist: undefined })}
          >
            Remove
          </span>
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 6 }}>{job.checklist.name}</div>
        {job.checklist.items.map((it) => (
          <div key={it.id} className="stage-row" style={{ gap: 8, padding: "4px 0" }}>
            <span style={{ color: it.required ? "var(--amber)" : "var(--ink-3)" }}>
              {it.type === "photo" ? "📷" : "○"}
            </span>
            <span style={{ flex: 1, fontSize: 13 }}>{it.text}</span>
            {it.required && <span className="muted" style={{ fontSize: 11 }}>required</span>}
          </div>
        ))}
      </div>
    );
  }

  // Picking a template.
  if (picking) {
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ margin: "0 0 6px", fontSize: 13 }}>Attach a checklist</h3>
        {templates.length ? (
          templates.map((c) => (
            <div
              key={c.id}
              className="stage-row clickable"
              style={{ cursor: "pointer" }}
              onClick={() => {
                updateJob(job.id, { checklist: { name: c.name, items: c.items } });
                setPicking(false);
              }}
            >
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{c.name}</span>
              <span className="muted" style={{ fontSize: 12 }}>{c.items.length} items</span>
            </div>
          ))
        ) : (
          <div className="muted" style={{ fontSize: 12 }}>
            No templates yet — add one in Checklist templates.
          </div>
        )}
        <span className="linklike" style={{ fontSize: 12 }} onClick={() => setPicking(false)}>
          Cancel
        </span>
      </div>
    );
  }

  // Entry point.
  return (
    <div style={{ marginTop: 16 }}>
      <span
        className="linklike"
        style={{ fontSize: 13, fontWeight: 700 }}
        onClick={() => setPicking(true)}
      >
        + Add a checklist
      </span>{" "}
      <span className="muted" style={{ fontSize: 11.5 }}>
        — the crew runs it before they leave (optional, per job)
      </span>
    </div>
  );
}

// ---- money pointer (prototype moneyPointer, line 6379) ---------------------
// ONE anchored pointer — never the P&L. Opens the invoice if one exists,
// otherwise a "Bill it in Money →" nudge once the work is done.

interface MoneyPointerProps {
  job: Job;
  invoice: Invoice | undefined;
  onGoToMoney: () => void;
  onOpenInvoice: (invoiceId: string) => void;
}

function MoneyPointer({ job, invoice, onGoToMoney, onOpenInvoice }: MoneyPointerProps) {
  if (invoice && (invoice.total ?? 0) > 0) {
    const due = invDue(invoice);
    return (
      <div className="jmoney">
        <span>{due > 0 ? `${invoice.num} — ${fmt$(due)} due` : `✓ ${invoice.num} paid in full`}</span>
        <span className="linklike" onClick={() => onOpenInvoice(invoice.id)}>
          open invoice →
        </span>
      </div>
    );
  }

  if (job.status === "done") {
    return (
      <div className="jmoney">
        <span>✓ Work done — not billed yet</span>
        <span className="linklike" onClick={onGoToMoney}>
          Bill it in Money →
        </span>
      </div>
    );
  }

  return null;
}

// ---- type chips (prototype openJob §Type, lines 4712-4715) -----------------

interface TypeFieldProps {
  job: Job;
  onSetSvc: (svc: string) => void;
}

const TYPE_CHIPS: ReadonlyArray<{ t: string; lbl: string; sub: string }> = [
  ["estimate", "Estimate", "scope on site, the office quotes after"],
  ["service", "Job", "do the work — priced ahead or priced on site"],
].map(([t, lbl, sub]) => ({ t: t as string, lbl: lbl as string, sub: sub as string }));

/** Always the two-chip toggle — one look for Type everywhere. */
function TypeField({ job, onSetSvc }: TypeFieldProps) {
  const isEst = job.svc === "estimate";

  return (
    <div className="field" style={{ marginTop: 12 }}>
      <label>Type</label>
      <div className="chips">
        {TYPE_CHIPS.map(({ t, lbl, sub }) => {
          const sel = (t === "estimate") === isEst;
          return (
            <button
              key={t}
              className={`chip ${sel ? "sel" : ""}`}
              onClick={() => onSetSvc(t)}
              title={sub}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: svcEdge(t),
                  marginRight: 6,
                  verticalAlign: "middle",
                }}
              />
              {lbl}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- the modal body --------------------------------------------------------

export function JobModalContent() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const openModal = useOpenModal();
  const router = useRouter();

  const jobs = useAppStore((s) => s.jobs);
  const leads = useAppStore((s) => s.leads);
  const techs = useAppStore((s) => s.techs);
  const invoices = useAppStore((s) => s.invoices);
  const updateJob = useAppStore((s) => s.updateJob);
  const setJobSvc = useAppStore((s) => s.setJobSvc);
  const addVisit = useAppStore((s) => s.addVisit);
  const updateVisit = useAppStore((s) => s.updateVisit);
  const removeVisit = useAppStore((s) => s.removeVisit);
  const deleteJob = useAppStore((s) => s.deleteJob);

  const [deleteArmed, setDeleteArmed] = useState(false);

  const jobId = activeModal?.params?.jobId as string | undefined;
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return null;

  const lead: Lead | undefined = leads.find((l) => l.id === job.leadId);
  const custName = lead?.name ?? job.title ?? "Customer";
  const phone = job.phone || lead?.phone || "";
  const invoice = invoices.find((i) => i.jobId === job.id);

  // Sort visits by day, then start (prototype openJob line 4674).
  const visits = [...(job.visits ?? [])].sort((a, b) => {
    const ad = a.date ?? "";
    const bd = b.date ?? "";
    if (ad < bd) return -1;
    if (ad > bd) return 1;
    return (a.start ?? 0) - (b.start ?? 0);
  });

  // Per-visit overlap check across THIS job's placed visits (visitConflict).
  function conflictsWith(v: Visit): boolean {
    if (!vPlaced(v)) return false;
    return visits.some(
      (o) =>
        o.id !== v.id &&
        vPlaced(o) &&
        o.techId === v.techId &&
        o.date === v.date &&
        (v.start ?? 0) < (o.start ?? 0) + o.dur &&
        (o.start ?? 0) < (v.start ?? 0) + v.dur
    );
  }

  function goToMoney() {
    close();
    router.push("/money");
  }

  function goToSchedule() {
    close();
    router.push("/jobs?tab=schedule");
  }

  function confirmDelete() {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    deleteJob(job!.id);
    close();
  }

  const status = JST[job.status] ?? JST.scheduled!;

  return (
    <div>
      {/* 1. Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
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
        <div style={{ flex: 1 }}>
          <h2 style={{ marginBottom: 2 }}>{custName}</h2>
          <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
            <span className="stpill" style={{ color: status.c, background: status.bg }}>
              {status.l}
            </span>
            {visits.length > 1 && (
              <span className="pill" style={{ background: "var(--purple-bg)", color: "var(--purple)" }}>
                {visits.length} visits
              </span>
            )}
            {lead && (
              <span
                className="linklike"
                style={{ fontSize: 12 }}
                onClick={() => {
                  close();
                  openModal(MODAL.LEAD, { leadId: lead.id });
                }}
              >
                See customer →
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 2. Call / Text + phone */}
      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
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
        {phone && (
          <span className="muted" style={{ fontSize: 11.5, alignSelf: "center" }}>
            {phone}
          </span>
        )}
      </div>

      {/* 3. Customer phone (only when there's no linked lead) */}
      {!lead && (
        <div className="field" style={{ margin: "0 0 10px" }}>
          <label>Customer phone</label>
          <input
            type="tel"
            defaultValue={job.phone || ""}
            placeholder="so you can call/text from the job"
            onBlur={(e) => updateJob(job.id, { phone: e.target.value.trim() })}
          />
        </div>
      )}

      {/* 4. Job title */}
      <div className="field" style={{ margin: 0 }}>
        <label>Job</label>
        <input
          type="text"
          defaultValue={job.title}
          onBlur={(e) => updateJob(job.id, { title: e.target.value.trim() })}
        />
      </div>

      {/* 5. Type */}
      <TypeField job={job} onSetSvc={(svc) => setJobSvc(job.id, svc)} />

      {/* 6. Service address */}
      <div className="field" style={{ marginTop: 12 }}>
        <label>Service address</label>
        <input
          type="text"
          defaultValue={job.addr || ""}
          placeholder={lead?.address || "add the address"}
          onBlur={(e) => updateJob(job.id, { addr: e.target.value.trim() })}
        />
      </div>

      {/* 7. Price summary — PRICE + Total only, never cost/margin/profit */}
      <PriceSummary
        job={job}
        onBuildPrice={() => openModal(MODAL.PRICE_BUILDER, { jobId: job.id })}
        onViewQuote={(estId) => { close(); openModal(MODAL.EST, { estId }); }}
      />

      {/* 8. View signed agreement — deferred (signed-doc viewer not built) */}

      {/* 9. Schedule */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          margin: "16px 0 8px",
        }}
      >
        <h3 style={{ fontSize: 14, fontWeight: 800 }}>Schedule</h3>
      </div>

      {visits.length ? (
        visits.map((v) => (
          <VisitRow
            key={v.id}
            job={job}
            visit={v}
            techs={techs}
            conflict={conflictsWith(v)}
            onUpdate={(patch) => updateVisit(job.id, v.id, patch)}
            onRemove={() => removeVisit(job.id, v.id)}
            onGoToSchedule={goToSchedule}
          />
        ))
      ) : (
        <div className="empty-att" style={{ marginBottom: 8 }}>
          Not scheduled yet.
        </div>
      )}

      <button className="btn sm" onClick={() => addVisit(job.id)}>
        {visits.length ? "+ Add a visit" : "+ Add a visit — set the length"}
      </button>

      {/* 11. Note feed */}
      <NoteFeed job={job} />

      {/* 12. Job checklist */}
      <JobChecklistBlock job={job} />

      {/* 13. Money pointer */}
      <MoneyPointer
        job={job}
        invoice={invoice}
        onGoToMoney={goToMoney}
        onOpenInvoice={(invId) => { close(); openModal(MODAL.INVOICE, { invoiceId: invId }); }}
      />

      {/* 14. Footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 18,
          borderTop: "1px solid var(--line)",
          paddingTop: 14,
        }}
      >
        <button
          className="btn sm ghost"
          style={{ color: "var(--red)", borderColor: deleteArmed ? "var(--red)" : undefined }}
          onClick={confirmDelete}
        >
          {deleteArmed ? "Yes, delete job" : "Delete job"}
        </button>
        <button className="btn primary" onClick={close}>
          Done
        </button>
      </div>
    </div>
  );
}
