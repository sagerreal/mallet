/**
 * components/modals/evisit-modal.tsx
 * Faithful port of the prototype's openEvisit OFFICE/owner branch (lines
 * 4945-4970) — the SCHEDULING view an office/owner gets when clicking an
 * estimate visit on the board. Consistent with the office job modal's Schedule
 * section, NOT the tech's on-site scoping flow (timer / what-you-found /
 * send-to-office), which is gated by state.role==='tech' and is a different
 * Field-area surface (NOT built here).
 *
 * The office view is READ-through-to-quote: schedule the visit (day / crew /
 * start / length), read what the tech captured on site, jump to the customer,
 * or remove the visit. The office builds the quote after — no pricing here.
 *
 * Deferred (surfaces not built yet):
 *   - Call sheet / Text thread (opened via MODAL.CALL / MODAL.THREAD) exist as
 *     their own modals — wired the same way the job modal wires them.
 */

"use client";

import {
  useActiveModal,
  useCloseModal,
  useOpenModal,
  usePushModal,
  useAppStore,
} from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { Lead, Visit, Tech, Job } from "@/lib/store/types";
import { hasPhone } from "@/lib/phone";
import { todayISO } from "@/lib/clock";
import { Field } from "@/components/ui/input";

// ---- helpers ported 1:1 from the prototype --------------------------------

const JST: Record<string, { l: string; c: string; bg: string }> = {
  unscheduled: { l: "Unscheduled", c: "var(--amber)", bg: "var(--amber-bg)" },
  scheduled: { l: "Scheduled", c: "var(--ink-2)", bg: "var(--paper)" },
  enroute: { l: "On the way", c: "var(--ink-2)", bg: "var(--paper)" },
  onsite: { l: "On site", c: "var(--green-700)", bg: "var(--green-50)" },
  done: { l: "Done", c: "var(--ink-3)", bg: "var(--paper)" },
};

// SVC_META.estimate.c — the estimate accent (prototype line 3991).
const ESTIMATE_ACCENT = "var(--amber)";

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

/** A visit is PLACED once it has a day + crew + start (prototype: v.date && v.techId!=null && v.start!=null). */
function vPlaced(v: Visit): boolean {
  return !!(v.date && v.techId != null && v.start != null);
}

/** Overlap test (prototype overlaps): a.start < b.start+b.dur && b.start < a.start+a.dur. */
function overlaps(a: Visit, b: Visit): boolean {
  return (
    (a.start ?? 0) < (b.start ?? 0) + b.dur &&
    (b.start ?? 0) < (a.start ?? 0) + a.dur
  );
}

/**
 * visitConflict — same crew, same day, overlapping time across EVERY live visit
 * (job visits + estimate visits), excluding this one (prototype 3570 + allVisits).
 */
function visitConflict(v: Visit, allVisits: Visit[]): boolean {
  if (!vPlaced(v)) return false;
  return allVisits.some(
    (o) =>
      o.id !== v.id &&
      o.techId === v.techId &&
      o.date === v.date &&
      overlaps(o, v)
  );
}

// ---- immutable evisit field-setter (prototype eviSet, line 4012) -----------

type EviField = "date" | "techId" | "start" | "dur";

/** Map eviSet's per-field rules to an immutable Visit patch. Unplaced → null. */
function eviPatch(field: EviField, raw: string): Partial<Visit> {
  if (field === "date") return { date: raw || null };
  if (field === "techId") return { techId: raw || null };
  if (field === "start") return { start: raw ? timeToH(raw) : null };
  // dur — clamp to a 0.25h floor, snapped to the minute (prototype eviSet).
  return { dur: Math.max(0.25, Math.round((Number(raw) || 0.25) * 60) / 60) };
}

// ---- scheduling fields (prototype `sched`, lines 4948-4950) -----------------

interface SchedFieldsProps {
  visit: Visit;
  techs: Tech[];
  placed: boolean;
  conflict: boolean;
  techFirstName: string;
  onSet: (field: EviField, raw: string) => void;
}

function SchedFields({
  visit,
  techs,
  placed,
  conflict,
  techFirstName,
  onSet,
}: SchedFieldsProps) {
  return (
    <div>
      <div className="row2" style={{ gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
        <Field label="Day" style={{ margin: "0" }}>
          <input
            type="date"
            value={visit.date ?? ""}
            min={todayISO()}
            onChange={(e) => onSet("date", e.target.value)}
          />
        </Field>
        <Field label="Crew" style={{ margin: "0" }}>
          <select
            value={visit.techId ?? ""}
            onChange={(e) => onSet("techId", e.target.value)}
          >
            {/* Unplaced placeholder — a bare "—" reads as broken data (register
                rule), so the empty option names the move instead. */}
            {!placed && <option value="">Choose crew</option>}
            {techs.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div
        className="row2"
        style={{ gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)", marginTop: "var(--space-2)" }}
      >
        <Field label="Start" style={{ margin: "0" }}>
          <input
            type="time"
            value={visit.start != null ? hToTime(visit.start) : ""}
            step={60}
            onChange={(e) => onSet("start", e.target.value)}
          />
        </Field>
        <Field label="Length (h)" style={{ margin: "0" }}>
          <input
            type="number"
            inputMode="decimal"
            min={0.25}
            step={0.25}
            value={visit.dur || 1}
            onChange={(e) => onSet("dur", e.target.value)}
          />
        </Field>
      </div>

      {!placed ? (
        <div className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>
          Set a crew, day &amp; time — or drag it onto the board.
        </div>
      ) : conflict ? (
        <div className="banner" style={{ marginTop: "var(--space-2)" }}>
          ⚠ Overlaps another visit for {techFirstName} — nudge the time.
        </div>
      ) : null}
    </div>
  );
}

// ---- read-only scope preview (prototype `scopePrev`, lines 4951-4953) -------

function ScopePreview({ visit }: { visit: Visit }) {
  const photoCount = (visit.photos ?? []).length;
  const hasScope = !!visit.scopeNotes || photoCount > 0;

  // Nothing captured yet → the office builds the quote after the tech scopes.
  if (!hasScope) {
    return (
      <div className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-4)" }}>
        The tech scopes this on site → you build the quote after.
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: "var(--space-4)", background: "var(--paper)" }}>
      <h3 style={{ fontSize: "var(--type-base)" }}>What the tech captured</h3>
      {visit.scopeNotes && (
        <div style={{ fontSize: "var(--type-base)", marginTop: "var(--space-2)" }}>{visit.scopeNotes}</div>
      )}
      {photoCount > 0 && (
        <div className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>
          {photoCount} photo{photoCount === 1 ? "" : "s"} attached
        </div>
      )}
    </div>
  );
}

// ---- the modal body --------------------------------------------------------

/** Collect every live visit (job visits + estimate visits) for conflict checks. */
function collectAllVisits(leads: Lead[], jobs: Job[]): Visit[] {
  const out: Visit[] = [];
  jobs.forEach((j) => {
    if (!j.archived) (j.visits ?? []).forEach((v) => out.push(v));
  });
  leads.forEach((l) => {
    if (!l.archived && !l.trash)
      (l.evisits ?? []).forEach((v) => out.push(v));
  });
  return out;
}

export function EvisitModalContent() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const openModal = useOpenModal();
  const pushModal = usePushModal();

  const leads = useAppStore((s) => s.leads);
  const jobs = useAppStore((s) => s.jobs);
  const techs = useAppStore((s) => s.techs);
  const updateLead = useAppStore((s) => s.updateLead);

  const leadId = activeModal?.params?.leadId as string | undefined;
  const visitId = activeModal?.params?.visitId as string | undefined;

  const lead = leads.find((l) => l.id === leadId);
  const visit = lead?.evisits?.find((v) => v.id === visitId);
  if (!lead || !visit) return null;

  const placed = vPlaced(visit);
  const allVisits = collectAllVisits(leads, jobs);
  const conflict = visitConflict(visit, allVisits);
  const tech = techs.find((t) => t.id === visit.techId);
  const techFirstName = tech ? (tech.name.split(" ")[0] ?? "this crew") : "this crew";
  const status = JST[visit.status] ?? JST.scheduled!;

  // Immutable eviSet: replace only THIS evisit inside the lead's evisits array.
  function setField(field: EviField, raw: string) {
    const patch = eviPatch(field, raw);
    const nextEvisits = (lead!.evisits ?? []).map((v) =>
      v.id === visit!.id ? { ...v, ...patch } : v
    );
    updateLead(lead!.id, { evisits: nextEvisits });
  }

  function removeVisit() {
    const nextEvisits = (lead!.evisits ?? []).filter((v) => v.id !== visit!.id);
    updateLead(lead!.id, { evisits: nextEvisits });
    close();
  }

  function seeCustomer() {
    close();
    openModal(MODAL.LEAD, { leadId: lead!.id });
  }

  return (
    <>
      {/* 1. Sticky sheet header — name over one meta line (Estimate-visit label ·
          status · conflict · See customer). The avatar was decoration duplicating
          the name; the sheet grammar drops it, same as the lead sheet did. */}
      <div className="sheet-head">
        <h2>{lead.name}</h2>
        <div className="sheet-meta">
          <span
            style={{
              fontSize: "var(--type-xs)",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: ".05em",
              color: ESTIMATE_ACCENT,
            }}
          >
            Estimate visit
          </span>
          <span className="stpill" style={stpillStyle(visit.status)}>
            {stpillLabel(visit.status)}
          </span>
          {conflict && <span className="pill red">⚠ double-booked</span>}
          <span className="linklike" style={{ fontSize: "var(--type-sm)" }} onClick={seeCustomer}>
            See customer →
          </span>
        </div>
      </div>

      {/* 2. Call / Text + phone — Call/Text stay TAPPABLE; the call sheet /
          thread each prompt to add a number in-flow when none is on file. */}
      <div style={{ margin: "var(--space-3) 0" }}>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <button
            className="btn"
            onClick={() => pushModal(MODAL.CALL, { leadId: lead.id })}
          >
            Call
          </button>
          <button
            className="btn"
            onClick={() => pushModal(MODAL.THREAD, { leadId: lead.id })}
          >
            Text
          </button>
          {hasPhone(lead) && (
            <span className="muted" style={{ fontSize: "var(--type-sm)", alignSelf: "center" }}>
              {lead.phone}
            </span>
          )}
        </div>
      </div>

      {/* 3. Job · address */}
      <div className="muted" style={{ fontSize: "var(--type-base)", marginBottom: "var(--space-3)" }}>
        {lead.job || "Estimate visit"}
        {lead.address ? " · " + lead.address : ""}
      </div>

      {/* 4. Schedule */}
      <h3 style={{ fontSize: "var(--type-md)", fontWeight: 800, margin: "var(--space-2xs) 0 var(--space-2)" }}>Schedule</h3>
      <SchedFields
        visit={visit}
        techs={techs}
        placed={placed}
        conflict={conflict}
        techFirstName={techFirstName}
        onSet={setField}
      />

      {/* 5. What the tech captured (read-only) */}
      <ScopePreview visit={visit} />

      {/* 6. Sticky foot — ONE filled primary (Done, the terminal confirm). Remove
          visit is destructive, so it stays a quiet red ghost beside it, never the
          primary slot. */}
      <div className="sheet-foot" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
        <button className="btn ghost" style={{ color: "var(--red)", minHeight: 44 }} onClick={removeVisit}>
          Remove visit
        </button>
        <button className="sheet-pri" onClick={close}>
          Done
        </button>
      </div>
    </>
  );
}
