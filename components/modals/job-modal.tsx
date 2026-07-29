/**
 * components/modals/job-modal.tsx
 * Faithful port of the prototype's openJob office/owner body (lines 4699-4729)
 * plus its per-visit visitRow (4677-4698) and helpers jobPriceSummary (4513),
 * jobNoteFeed (6364), moneyPointer (6379) — re-housed in the sheet grammar:
 * sticky .sheet-head (job title · status · customer · phone), Call/Text as a
 * .sheet-secrow, the label+value sections as SheetRow accordions (schedule and
 * checklist blocks kept intact inside theirs), and a sticky .sheet-foot with
 * Done as the one primary and Delete job quiet red beside it.
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
 *     pricebook/DUR_RULES the store doesn't seed)
 *   - (checklists: the template picker + in-flow create form now live in
 *     ./job-checklist-block.tsx; the attach persists via v1.jobs.update)
 *   - the invoice modal (opened from the money pointer — Money-area task)
 */

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  useActiveModal,
  useCloseModal,
  useOpenModal,
  usePushModal,
  useAppStore,
} from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { api } from "@/lib/trpc/client";
import { userMessage } from "@/lib/trpc/error-map";
import type { Estimate, Job, Visit, Lead, Tech, Invoice } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";
import { todayISO } from "@/lib/clock";
import { DurField } from "./dur-field";
import { SheetRow } from "./sheet-row";
import { JobChecklistBlock } from "./job-checklist-block";
import { JobMeasureBlock } from "./job-measure-block";
import { skillHintFor } from "./skill-hint";
import { meetsRequirement, missingCerts } from "@mallet/shared/dispatch/skill-gate";
import { dayLoad } from "@/features/jobs/jobs-helpers";
import { Field, FieldGroup } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";

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
  /** Cross-job day-load closure pre-bound to the visit's date. */
  loadOf: (techId: string) => number;
  onUpdate: (patch: Partial<Visit>) => void;
  onRemove: () => void;
  onGoToSchedule: () => void;
}

function VisitRow({ job, visit, techs, conflict, loadOf, onUpdate, onRemove, onGoToSchedule }: VisitRowProps) {
  // UNPLACED — dashed row with a "Not placed" pill, Length, and where-to-next hint.
  if (!vPlaced(visit)) {
    return (
      <div
        style={{
          border: "1px dashed var(--line)",
          borderRadius: "var(--radius)",
          padding: "var(--space-3)",
          marginBottom: "var(--space-2)",
          display: "flex",
          gap: "var(--space-3)",
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
          style={{ fontSize: "var(--type-sm)", flex: 1, minWidth: 140, alignSelf: "center" }}
        >
          Set the hours, then place it on the Schedule board for the crew, day &amp; time.
        </span>
        <button
          type="button"
          className="linklike"
          style={{ fontSize: "var(--type-sm)", alignSelf: "center" }}
          onClick={onGoToSchedule}
        >
          Open the Schedule board →
        </button>
        <span
          className="linklike"
          style={{ color: "var(--red)", fontSize: "var(--type-sm)", alignSelf: "center" }}
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
        borderRadius: "var(--radius)",
        padding: "var(--space-3)",
        marginBottom: "var(--space-2)",
      }}
    >
      <div className="row2" style={{ gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
        <Field label="Day" style={{ margin: "0" }}>
          <input
            type="date"
            value={visit.date ?? ""}
            min={todayISO()}
            onChange={(e) => onUpdate({ date: e.target.value })}
          />
        </Field>
        <Field label="Crew" style={{ margin: "0" }}>
          <SelectMenu
            value={visit.techId ?? ""}
            onChange={(v) => onUpdate({ techId: v || null })}
            options={(() => {
              // When a requirement exists: qualified techs first (roster order within each
              // group), unqualified get a "— missing {certs}" suffix. When no requirement:
              // roster order, no suffix. Unchanged from the <option> version — a tech who
              // cannot legally do the work must still be pickable, just visibly flagged.
              const req = job.requiredCerts ?? null;
              if (req == null || req.length === 0) {
                return techs.map((t) => ({ value: t.id, label: t.name }));
              }
              const qualified: Tech[] = [];
              const unqualified: Tech[] = [];
              for (const t of techs) {
                if (meetsRequirement(t.skills, req)) qualified.push(t);
                else unqualified.push(t);
              }
              return [
                ...qualified.map((t) => ({ value: t.id, label: t.name })),
                ...unqualified.map((t) => ({
                  value: t.id,
                  label: `${t.name} — missing ${missingCerts(t.skills, req).join(", ")}`,
                })),
              ];
            })()}
          />
        </Field>
      </div>

      <div
        className="row2"
        style={{ gridTemplateColumns: "1fr auto", gap: "var(--space-3)", marginTop: "var(--space-2)", alignItems: "end" }}
      >
        <Field label="Start" style={{ margin: "0" }}>
          <input
            type="time"
            value={hToTime(visit.start ?? 0)}
            step={60}
            onChange={(e) => onUpdate({ start: timeToH(e.target.value) })}
          />
        </Field>
        <DurField dur={visit.dur} onChange={(dur) => onUpdate({ dur })} />
      </div>

      {conflict && (
        <div className="banner" style={{ marginTop: "var(--space-2)" }}>
          ⚠ Overlaps another visit for {techFirst} on{" "}
          {visit.date ? colLabel(visit.date) : "that day"} — <b>Mallet flagged the clash</b> — nudge the time.
        </div>
      )}

      {/* Skill-gap banner — suggest-only, never blocks save or disables selects. */}
      {(() => {
        const hint = skillHintFor({
          required: job.requiredCerts ?? null,
          selectedTechId: visit.techId ?? null,
          techs: techs.map((t) => ({ id: t.id, skills: t.skills })),
          loadOf,
        });
        if (hint.state === "noRequirement" || hint.state === "selectedQualified") {
          return null;
        }
        const reqLabel = (job.requiredCerts ?? []).join(", ");
        if (hint.state === "selectedMissing" && hint.suggestedTechId != null) {
          const selected = techs.find((t) => t.id === visit.techId);
          const suggestedName =
            techs.find((t) => t.id === hint.suggestedTechId)?.name ?? "Another crew";
          const missingLabel = hint.missing.join(", ");
          // Nobody-assigned reads differently from an assigned-but-unqualified tech.
          const gap = selected
            ? `${selected.name} is missing ${missingLabel}.`
            : "nobody assigned yet.";
          return (
            <div className="banner" style={{ marginTop: "var(--space-2)" }}>
              ⚠ Needs {reqLabel} — {gap}{" "}
              <b>{suggestedName} is certified and lightest today.</b>
            </div>
          );
        }
        // noneQualified or selectedMissing with no suggestion
        const missingLabel =
          hint.missing.length > 0 ? hint.missing.join(", ") : reqLabel;
        return (
          <div className="banner" style={{ marginTop: "var(--space-2)" }}>
            ⚠ Needs {reqLabel} — no tech on the team holds {missingLabel}.
          </div>
        );
      })()}

      <div
        style={{
          display: "flex",
          gap: "var(--space-2)",
          alignItems: "center",
          marginTop: "var(--space-2)",
          flexWrap: "wrap",
        }}
      >
        <span className="stpill" style={stpillStyle(visit.status)}>
          {stpillLabel(visit.status)}
        </span>
        <span style={{ marginLeft: "auto" }}>
          <span
            className="linklike"
            style={{ color: "var(--red)", fontSize: "var(--type-sm)" }}
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
      <div style={{ margin: "var(--space-4) 0 0", display: "flex", alignItems: "baseline", gap: "var(--space-2)" }}>
        <span style={{ fontSize: "var(--type-base)" }}>{label}</span>
        {est && (
          <span
            className="linklike"
            style={{ fontSize: "var(--type-sm)" }}
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
      <div style={{ margin: "var(--space-4) 0 0" }}>
        <span
          className="linklike"
          style={{ fontSize: "var(--type-base)", fontWeight: 700 }}
          onClick={onBuildPrice}
        >
          ✦ Build the price →
        </span>{" "}
        <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
          or price it later
        </span>
      </div>
    );
  }

  return (
    <div className="card" style={{ margin: "var(--space-4) 0 0", background: "var(--paper)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h3 style={{ fontSize: "var(--type-base)", margin: "0" }}>Price</h3>
        <span className="linklike" style={{ fontSize: "var(--type-sm)" }} onClick={onBuildPrice}>
          Edit
        </span>
      </div>
      {(job.lines ?? []).map((x, i) => (
        <div
          key={i}
          style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--type-base)", padding: "var(--space-1) 0" }}
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
          fontSize: "var(--type-md)",
          borderTop: "1px solid var(--line)",
          marginTop: "var(--space-1)",
          paddingTop: "var(--space-1)",
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

/** Renders bare .nfeed rows — the Notes SheetRow above it carries the label. */
function NoteFeed({ job }: { job: Job }) {
  const entries = jobNoteEntries(job);
  if (entries.length === 0) return null;

  return (
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
  );
}

// ---- job checklist block — extracted to ./job-checklist-block (file-size cap).
// Template picker + in-flow create form + persisted attach live there now.

// ---- money pointer (prototype moneyPointer, line 6379) ---------------------
// ONE anchored pointer — never the P&L. Opens the invoice if one exists,
// otherwise a "Bill it in Money →" nudge once the work is done.

interface MoneyPointerProps {
  job: Job;
  invoice: Invoice | undefined;
  /** Creates the invoice and opens it. Null while the request is in flight. */
  onBill: () => void;
  billing: boolean;
  billError: string | null;
  onOpenInvoice: (invoiceId: string) => void;
}

function MoneyPointer({ job, invoice, onBill, billing, billError, onOpenInvoice }: MoneyPointerProps) {
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
    // BILLS IT, rather than pointing at where billing happens. This modal is opened FROM the Money
    // ledger's "ready to bill" rows, so "Bill it in Money →" navigated the user to the page they
    // had just come from — a link whose only effect was to close the thing they were reading.
    return (
      <div className="jmoney">
        <span>{billError ? billError : "✓ Work done — not billed yet"}</span>
        <button type="button" className="linklike" onClick={onBill} disabled={billing}>
          {billing ? "Creating invoice…" : "Create the invoice →"}
        </button>
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
    <FieldGroup label="Type" style={{ margin: "0" }} groupClassName="chips">
      {TYPE_CHIPS.map(({ t, lbl, sub }) => {
        const sel = (t === "estimate") === isEst;
        return (
            <button
              key={t}
              className={`chip ${sel ? "sel" : ""}`}
              onClick={() => onSetSvc(t)}
              title={sub}
              aria-pressed={sel}
            >
              <span
                style={{
                  display: "inline-block",
                  width: 8,
                  height: 8,
                  borderRadius: "var(--radius-2xs)",
                  background: svcEdge(t),
                  marginRight: "var(--space-2)",
                  verticalAlign: "middle",
                }}
              />
              {lbl}
            </button>
        );
      })}
    </FieldGroup>
  );
}

// ---- the modal body --------------------------------------------------------

export function JobModalContent() {
  const activeModal = useActiveModal();
  const close = useCloseModal();
  const openModal = useOpenModal();
  const pushModal = usePushModal();
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
  const rooms = useAppStore((s) => (jobId ? s.roomsByJob[jobId] : undefined)) ?? [];
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

  const [billError, setBillError] = useState<string | null>(null);
  const utils = api.useUtils();
  const createInvoice = api.v1.invoicing.createFromJob.useMutation();

  /**
   * Turn finished work into an invoice, here, and open it.
   *
   * Replaces a link to /money. This modal is opened FROM the Money ledger's "ready to bill" rows,
   * so that link navigated to the page the user had just come from — its only real effect was to
   * close what they were reading.
   */
  function bill() {
    if (!job || createInvoice.isPending) return;
    setBillError(null);
    createInvoice.mutate(
      { jobId: job.id },
      {
        onSuccess: (inv: { id: string }) => {
          void utils.v1.invoicing.list.invalidate();
          close();
          openModal(MODAL.INVOICE, { invoiceId: inv.id });
        },
        // Named in place rather than as a toast: the sentence sits where the action was, so the
        // user is not left wondering whether the invoice exists.
        onError: (e: unknown) => setBillError(userMessage(e)),
      },
    );
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
  const noteCount = jobNoteEntries(job).length;
  const hasLines = (job.lines ?? []).length > 0;
  const priceValue = hasLines
    ? fmt$(jobTotal(job))
    : job.sourceEstimateId
      ? "from quote"
      : "Add";
  const scheduleValue =
    visits.length > 0
      ? `${visits.length} visit${visits.length === 1 ? "" : "s"}`
      : "Add";

  return (
    <>
      {/* Sticky header — the job as an h2 over one calm meta line
          (status pill · customer · phone). */}
      <div className="sheet-head">
        <h2>{job.title?.trim() || custName}</h2>
        <div className="sheet-meta">
          <span className="stpill" style={{ color: status.c, background: status.bg }}>
            {status.l}
          </span>
          {lead ? (
            <button
              type="button"
              className="linklike"
              onClick={() => {
                close();
                openModal(MODAL.LEAD, { leadId: lead.id });
              }}
            >
              {custName} →
            </button>
          ) : (
            <span>{custName}</span>
          )}
          {phone && <span>{phone}</span>}
        </div>
      </div>

      {/* Quiet peer actions — Call/Text stay TAPPABLE when a customer is
          linked; the call sheet / thread each prompt to add a number in-flow
          when none is on file. They disable only with NO linked customer (there
          is nobody to call). */}
      <div className="sheet-secrow">
        <button
          className="sheet-sec"
          disabled={!lead}
          title={!lead ? "No linked customer" : undefined}
          onClick={() => {
            if (lead) pushModal(MODAL.CALL, { leadId: lead.id });
          }}
        >
          Call
        </button>
        <button
          className="sheet-sec"
          disabled={!lead}
          title={!lead ? "No linked customer" : undefined}
          onClick={() => {
            if (lead) pushModal(MODAL.THREAD, { leadId: lead.id });
          }}
        >
          Text
        </button>
      </div>

      <div className="sheet-rows">
        {/* Customer phone — only when there's no linked lead to carry one. */}
        {!lead && (
          <SheetRow
            label="Customer phone"
            value={job.phone?.trim() ? job.phone : "Add"}
            valueIsHint={!job.phone?.trim()}
            expandable
          >
            <Field label="Customer phone" style={{ margin: "0" }}>
              <input
                type="tel"
                defaultValue={job.phone || ""}
                placeholder="so you can call/text from the job"
                onBlur={(e) => updateJob(job.id, { phone: e.target.value.trim() })}
              />
            </Field>
          </SheetRow>
        )}

        <SheetRow
          label="Job"
          value={job.title?.trim() ? job.title : "Add"}
          valueIsHint={!job.title?.trim()}
          expandable
        >
          <Field label="Job" style={{ margin: "0" }}>
            <input
              type="text"
              defaultValue={job.title}
              onBlur={(e) => updateJob(job.id, { title: e.target.value.trim() })}
            />
          </Field>
        </SheetRow>

        <SheetRow
          label="Type"
          value={job.svc === "estimate" ? "Estimate" : "Job"}
          expandable
        >
          <TypeField job={job} onSetSvc={(svc) => setJobSvc(job.id, svc)} />
        </SheetRow>

        <SheetRow
          label="Service address"
          value={job.addr?.trim() ? job.addr : "Add"}
          valueIsHint={!job.addr?.trim()}
          expandable
        >
          <Field label="Service address" style={{ margin: "0" }}>
            <input
              type="text"
              defaultValue={job.addr || ""}
              placeholder={lead?.address || "add the address"}
              onBlur={(e) => updateJob(job.id, { addr: e.target.value.trim() })}
            />
          </Field>
        </SheetRow>

        {/* Price — PRICE + Total only, never cost/margin/profit (LOCKED rule).
            PriceSummary renders nothing for estimate-type jobs, so hide the row. */}
        {jobMode(job) !== "estimate" && (
          <SheetRow
            label="Price"
            value={priceValue}
            valueIsHint={priceValue === "Add"}
            expandable
          >
            <PriceSummary
              job={job}
              onBuildPrice={() => pushModal(MODAL.PRICE_BUILDER, { jobId: job.id })}
              onViewQuote={(estId) => { close(); openModal(MODAL.EST, { estId }); }}
            />
          </SheetRow>
        )}

        {/* Schedule — the visit editor kept intact inside the accordion. */}
        <SheetRow
          label="Schedule"
          value={scheduleValue}
          valueIsHint={visits.length === 0}
          expandable
        >
          {visits.length ? (
            visits.map((v) => (
              <VisitRow
                key={v.id}
                job={job}
                visit={v}
                techs={techs}
                conflict={conflictsWith(v)}
                loadOf={(techId) =>
                  v.date != null ? dayLoad(jobs, techId, v.date) : 0
                }
                onUpdate={(patch) => updateVisit(job.id, v.id, patch)}
                onRemove={() => removeVisit(job.id, v.id)}
                onGoToSchedule={goToSchedule}
              />
            ))
          ) : (
            <div className="empty-att" style={{ marginBottom: "var(--space-2)" }}>
              Not scheduled yet.
            </div>
          )}
          <button className="btn sm" onClick={() => addVisit(job.id)}>
            {visits.length ? "+ Add a visit" : "+ Add a visit — set the length"}
          </button>
        </SheetRow>

        {/* Notes — read-only feed, only when there is something to read. */}
        {noteCount > 0 && (
          <SheetRow label="Notes" value={String(noteCount)} expandable>
            <NoteFeed job={job} />
          </SheetRow>
        )}

        {/* Checklist — the template picker + create form kept intact inside. */}
        <SheetRow
          label="Checklist"
          value={job.checklist?.name?.trim() ? job.checklist.name : "Add"}
          valueIsHint={!job.checklist?.name?.trim()}
          expandable
        >
          <JobChecklistBlock job={job} />
        </SheetRow>

        {/* Measurements — room captures (RoomPlan scans or manual rooms).
            Rooms hydrate lazily inside JobMeasureBlock (useJobRooms), so this
            row's count reflects whatever the store already has for this job
            until the accordion is opened. */}
        <SheetRow
          label="Measurements"
          value={rooms.length > 0 ? `${rooms.length} room${rooms.length === 1 ? "" : "s"}` : "Add"}
          valueIsHint={rooms.length === 0}
          expandable
        >
          <JobMeasureBlock jobId={job.id} />
        </SheetRow>
      </div>

      {/* Money pointer — ONE anchored pointer, never the P&L. */}
      <MoneyPointer
        job={job}
        invoice={invoice}
        onBill={bill}
        billing={createInvoice.isPending}
        billError={billError}
        onOpenInvoice={(invId) => { close(); openModal(MODAL.INVOICE, { invoiceId: invId }); }}
      />

      {/* Sticky footer — Done is THE primary; Delete stays quiet and red. */}
      <div className="sheet-foot">
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "stretch" }}>
          <button
            className="btn ghost"
            style={{
              color: "var(--red)",
              borderColor: deleteArmed ? "var(--red)" : undefined,
              flexShrink: 0,
            }}
            onClick={confirmDelete}
          >
            {deleteArmed ? "Yes, delete job" : "Delete job"}
          </button>
          <button className="sheet-pri" onClick={close}>
            Done
          </button>
        </div>
      </div>
    </>
  );
}
