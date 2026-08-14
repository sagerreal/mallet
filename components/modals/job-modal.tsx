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
 * Two note rows, deliberately apart. "Job notes" is this job's own feed (office
 * note, field notes, found work, completion). "Customer notes" is the CUSTOMER
 * record's trail, read-only — the gate code lives on the customer, and until it
 * was mirrored here it was reachable only from the customer sheet ("I had notes
 * on Cole, why aren't they here on the job?"). Editing stays on the customer
 * record; the name link in the header is the way there.
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

import { useEffect, useState } from "react";
import { isUnpricedEstimateJob } from "@/features/jobs/job-status-meta";
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
import { isVisitPlaced } from "@/lib/store/visit-placement";
import { fmt$ } from "@/lib/format";
import { SignatureRecord } from "@/components/shared/signature-record";
import { todayISO } from "@/lib/clock";
import { DurField } from "./dur-field";
import { SheetRow } from "./sheet-row";
import { EditableSheetTitle } from "./editable-sheet-title";
import { Trail } from "./trail";
import { latestNoteSnippet } from "./lead-modal/lead-notes";
import { NoteRow, gatherNotes } from "./lead-modal/note-row";
import { dtoLeadNoteToStore } from "@/lib/store/dto-mapper";
import { JobChecklistBlock } from "./job-checklist-block";
import { skillHintFor } from "./skill-hint";
import { meetsRequirement, missingCerts } from "@mallet/shared/dispatch/skill-gate";
import { dayLoad } from "@/features/jobs/jobs-helpers";
import { Field } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { ModalLoading } from "./modal-loading";
import { MoneyPointer } from "./money-pointer";

// ---- helpers ported 1:1 from the prototype --------------------------------

const JST: Record<string, { l: string; c: string; bg: string }> = {
  unscheduled: { l: "Unscheduled", c: "var(--amber)", bg: "var(--amber-bg)" },
  scheduled: { l: "Scheduled", c: "var(--ink-2)", bg: "var(--paper)" },
  enroute: { l: "On the way", c: "var(--ink-2)", bg: "var(--paper)" },
  onsite: { l: "On site", c: "var(--green-700)", bg: "var(--green-50)" },
  done: { l: "Done", c: "var(--ink-3)", bg: "var(--paper)" },
};

function jobTotal(j: Job): number {
  return (j.lines ?? []).reduce((s, l) => s + (l.q ?? 1) * (l.r ?? 0), 0);
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

// ---- invoice helpers (invPaid / invDue) live in ./tech-job-modal/helpers ----

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

/**
 * The crew list for a picker.
 *
 * When the job requires certifications: qualified techs first (roster order within each group),
 * unqualified suffixed with what they are missing. A tech who cannot legally do the work is still
 * PICKABLE, just visibly flagged — the shop decides, the app does not block. No requirement means
 * plain roster order.
 */
function crewOptions(techs: Tech[], req: readonly string[] | null): { value: string; label: string }[] {
  if (req == null || req.length === 0) return techs.map((t) => ({ value: t.id, label: t.name }));
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
}

function VisitRow({ job, visit, techs, conflict, loadOf, onUpdate, onRemove, onGoToSchedule }: VisitRowProps) {
  // UNPLACED — dashed row with a "Not placed" pill, Length, and where-to-next hint.
  if (!isVisitPlaced(visit)) {
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
            options={crewOptions(techs, job.requiredCerts ?? null)}
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
          {visit.date ? colLabel(visit.date) : "that day"} — <b>Artie flagged the clash</b> — nudge the time.
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
  /** Raise a quote that adds work to THIS job — a change order the customer signs for. */
  onAddWork: () => void;
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

export function PriceSummary({ job, onBuildPrice, onViewQuote, onAddWork }: PriceSummaryProps) {
  const estimates = useAppStore((s) => s.estimates);

  // Unpriced estimate → nothing to show. But ONLY unpriced: a quote signed at the door writes
  // priced lines onto this job, and the old svc-based gate hid the price of a job with a
  // signature behind it — the one record that most certainly has a price.
  if (isUnpricedEstimateJob(job)) return null;
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
        {/* Extra work can be found on ANY job, not only one that already carries its own lines.
            This branch — a job priced from its quote — is the common case for sold work, and it
            was the one branch with no way to raise a change order. */}
        <span className="linklike" style={{ fontSize: "var(--type-sm)" }} onClick={onAddWork}>
          + More work
        </span>
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
        <span style={{ display: "flex", gap: "var(--space-3)" }}>
          {/* MORE WORK FOUND ON SITE. A change order is not a special object — it is a quote that
              belongs to this job, priced and SIGNED the same way, which is what turns extra work
              into authorised work instead of a surprise on the bill. */}
          <span className="linklike" style={{ fontSize: "var(--type-sm)" }} onClick={onAddWork}>
            + More work
          </span>
          {/* NO Edit on signed lines. A signature is evidence of what the customer agreed to —
              Build-the-price replaces the lines while the signature record stays on screen, and
              billing would then invoice a total the customer never signed. Changes to signed work
              go through "+ More work", which re-presents and re-signs. */}
          {!job.signature && (
            <span className="linklike" style={{ fontSize: "var(--type-sm)" }} onClick={onBuildPrice}>
              Edit
            </span>
          )}
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

// ---- money pointer: extracted to ./money-pointer (unpriced-estimate gate +
// unit tests live there) -----------------------------------------------------

// ---- type chips: REMOVED. The kind derives from whether a price is committed (the New job
// foot at create; Build the price's save thereafter) — a manual Type toggle here was the same
// Estimate/Flat-rate fork the create form dropped, surfaced post-create.

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
  const addVisit = useAppStore((s) => s.addVisit);
  const updateVisit = useAppStore((s) => s.updateVisit);
  const removeVisit = useAppStore((s) => s.removeVisit);
  const deleteJob = useAppStore((s) => s.deleteJob);
  const adoptLeadNotes = useAppStore((s) => s.adoptLeadNotes);

  const [deleteArmed, setDeleteArmed] = useState(false);
  // Billing hooks live ABOVE the fetch-on-miss early returns below — hook order must be
  // identical across the loading → loaded transition of one mount.
  const [billError, setBillError] = useState<string | null>(null);
  const utils = api.useUtils();
  const createInvoice = api.v1.invoicing.createFromJob.useMutation();

  const jobId = activeModal?.params?.jobId as string | undefined;
  const adoptJob = useAppStore((s) => s.adoptJob);
  const job = jobs.find((j) => j.id === jobId);

  // The Jobs list is served by the DATABASE a page at a time, so it shows jobs the store
  // never hydrated (the hydrator holds one page). Opening one of those used to render an
  // EMPTY sheet (`return null` under an open shell). Fetch-on-miss: pull the job by id and
  // adopt it into the store; loading/not-found render honestly meanwhile.
  const missing = Boolean(jobId) && !job;
  const jobQ = api.v1.jobs.get.useQuery(
    { jobId: jobId ?? "" },
    { enabled: missing, staleTime: 30_000, refetchOnWindowFocus: false },
  );
  useEffect(() => {
    if (missing && jobQ.data) adoptJob(jobQ.data as unknown as Parameters<typeof adoptJob>[0]);
  }, [missing, jobQ.data, adoptJob]);

  // THE CUSTOMER'S TRAIL, from the database — the same fetch the customer sheet runs, with the
  // same input and the same options, so the two share ONE react-query entry (identical key →
  // identical query; the client's 30s staleTime means opening both costs one request).
  //
  // Without it this row would only ever show `lead.notes`, the single field the hydrator rides
  // along on the list — every note logged since (calls, texts, the gate code typed into the
  // customer sheet) lives in the lead_notes trail and would be missing exactly when the office
  // opens the job to read it.
  const custLeadId = job?.leadId ?? "";
  const custNotesQ = api.v1.customers.listNotes.useQuery(
    { leadId: custLeadId },
    { enabled: Boolean(custLeadId), refetchOnWindowFocus: false },
  );
  // Keyed off the id STRING, never the lead object: adoptLeadNotes returns a fresh lead every
  // call, so a lead-object dep would re-fire itself forever.
  useEffect(() => {
    const items = custNotesQ.data?.items;
    if (!items || !custLeadId) return;
    adoptLeadNotes(custLeadId, items.map(dtoLeadNoteToStore));
  }, [custNotesQ.data, custLeadId, adoptLeadNotes]);

  const lead: Lead | undefined = leads.find((l) => l.id === job?.leadId);

  if (!job) {
    if (missing && jobQ.isError) {
      return (
        <div className="sheet-head">
          <h2>Job not found</h2>
          <p className="muted" style={{ fontSize: "var(--type-base)", marginTop: "var(--space-2)" }}>
            This job no longer exists — it may have been removed.
          </p>
        </div>
      );
    }
    // Full-height skeleton, same as the chunk loader — a head-only sliver made every
    // fetch-on-miss open flash a collapsed card before snapping to size.
    return <ModalLoading size="lg" />;
  }

  // NEVER the job title. This was `lead?.name ?? job.title`, so a job whose customer had not been
  // loaded printed its own title where the name belongs — twice on one screen — and, because the
  // link below was gated on `lead`, the only route to the customer vanished at the same moment.
  // `job.cust` is the name the SERVER resolved for the row; job.leadId is always on the record.
  const custName = lead?.name ?? job.cust ?? "Customer";
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
    if (!isVisitPlaced(v)) return false;
    return visits.some(
      (o) =>
        o.id !== v.id &&
        isVisitPlaced(o) &&
        o.techId === v.techId &&
        o.date === v.date &&
        (v.start ?? 0) < (o.start ?? 0) + o.dur &&
        (o.start ?? 0) < (v.start ?? 0) + v.dur
    );
  }

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
  // The latest customer note on the CLOSED row — the whole point of the row. A count would say
  // "3" to a plumber standing at a gate who needs "Gate code 4482". Reused from the customer
  // sheet, which is where that reasoning was written down.
  const custNoteSnippet = lead ? latestNoteSnippet(lead) : null;
  const hasLines = (job.lines ?? []).length > 0;
  // The row says there is SCOPE inside it, not just a number. "$730" reads as the whole story and
  // gives no reason to open the row — so the line items, and the "+ More work" that raises a
  // change order, sat behind a tap nobody had a reason to make. Owen asked twice where they were.
  const lineCount = (job.lines ?? []).length;
  const priceValue = hasLines
    ? `${fmt$(jobTotal(job))} · ${lineCount} ${lineCount === 1 ? "item" : "items"}`
    : job.sourceEstimateId
      ? "from quote"
      : "Add";
  const scheduleValue =
    visits.length > 0
      ? `${visits.length} visit${visits.length === 1 ? "" : "s"}`
      : "Add";

  // WHO IS ON THIS JOB. Assignment lives on the visit — a job can have several, each with its own
  // crew — but it was reachable only by expanding Schedule and then a visit, so the one question a
  // dispatcher asks most ("who's got this?") could not be answered from this screen at all, let
  // alone changed. Named crew, deduped, in visit order.
  const assignedNames = [
    ...new Set(
      visits
        .map((v) => techs.find((t) => t.id === v.techId)?.name)
        .filter((n): n is string => Boolean(n)),
    ),
  ];
  const assignedValue =
    visits.length === 0 ? "No visit yet" : assignedNames.length ? assignedNames.join(", ") : "Unassigned";

  return (
    <>
      {/* Sticky header — the job as an h2 over one calm meta line
          (status pill · customer · phone). */}
      <div className="sheet-head">
        {/* The heading IS the job name. It used to be a plain h2 with a "Job" row further down
            holding the same string, so renaming meant scrolling past the name to find the row that
            edits it. An untitled job still reads as the customer's name — that is the display
            fallback, not the value being edited. */}
        <EditableSheetTitle
          value={job.title ?? ""}
          display={job.title?.trim() || custName}
          onCommit={(title) => updateJob(job.id, { title })}
          label="Job name"
          placeholder="Name this job"
        />
        <div className="sheet-meta">
          <span className="stpill" style={{ color: status.c, background: status.bg }}>
            {status.l}
          </span>
          {/* customer > quote > job > invoice. Replaces a hand-rolled name link that only worked
              when the store happened to hold the lead, and reached none of the other records. */}
          <Trail kind="job" id={job.id} />
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

        {/* No Type row. The kind DERIVES from whether a price is committed — the New job
            foot decides it at create, and Build the price's save flips an unpriced job to
            booked work. A manual toggle here was the same fork the create form dropped. */}

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
            Hidden only for UNPRICED estimates: one signed at the door has real lines to show. */}
        {!isUnpricedEstimateJob(job) && (
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
              // MORE WORK IS PRICED AND SIGNED IN PLACE, not composed as a fresh quote.
              //
              // This used to push to /composer — a blank full quote builder, a page navigation
              // away, to add one line. Wrong shape for the job: a change order is "found another
              // $400 of work, customer says yes, sign here", and the surface for exactly that
              // already existed. TECH_QUOTE seeds from this job's current lines, lets you add to
              // them, presents the new total, and captures a signature on glass — and
              // SetJobLinesUseCase writes the lines and that signature in ONE transaction, so a
              // signature can never outlive the prices it refers to.
              onAddWork={() => pushModal(MODAL.TECH_QUOTE, { jobId: job.id })}
            />
          </SheetRow>
        )}

        {/* Assigned to — the crew picker, lifted out of the visit editor.
            One row per visit, because that is where assignment actually lives: a two-visit job can
            genuinely have two different technicians, and collapsing that to a single picker would
            silently reassign work nobody asked to move. */}
        {visits.length > 0 && (
          <SheetRow
            label="Assigned to"
            value={assignedValue}
            valueIsHint={assignedNames.length === 0}
            expandable
          >
            {visits.map((v, i) => (
              <Field
                key={v.id}
                label={visits.length === 1 ? "Crew" : `Visit ${i + 1}${v.date ? ` · ${v.date}` : ""}`}
                style={{ margin: "0 0 var(--space-2)" }}
              >
                <SelectMenu
                  value={v.techId ?? ""}
                  onChange={(val) => updateVisit(job.id, v.id, { techId: val || null })}
                  options={[{ value: "", label: "Unassigned" }, ...crewOptions(techs, job.requiredCerts ?? null)]}
                  aria-label={visits.length === 1 ? "Assigned crew" : `Crew for visit ${i + 1}`}
                  compact
                />
              </Field>
            ))}
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

        {/* Job notes — read-only feed, only when there is something to read. Named "Job"
            now that Customer notes sits beside it: two rows both called "Notes" would
            leave nobody able to tell which record they were reading. */}
        {noteCount > 0 && (
          <SheetRow label="Job notes" value={String(noteCount)} expandable>
            <NoteFeed job={job} />
          </SheetRow>
        )}

        {/* Customer notes — the customer record's own trail, READ-ONLY, and only when the
            customer has one. No composer on purpose: one record, one edit path, and that
            path is the customer link in the header above (the same read-only-provenance
            shape as the invoice modal's "From job" row). */}
        {lead && custNoteSnippet && (
          <SheetRow label="Customer notes" value={custNoteSnippet} expandable>
            <div className="nfeed">
              {gatherNotes(lead).map((entry) => (
                <NoteRow key={entry.key} entry={entry} />
              ))}
            </div>
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

        {/* Measurements (rooms AND satellite traces) deliberately have NO rows
            here: measuring is an ESTIMATING feature, so both live on the quote
            page's Measure section (app/(office)/composer) — room cards and
            saved captures open from there. The tech field Quote tab keeps its
            scan row for measuring on site. */}
      </div>

      {/* What the customer signed on site, when they did. Renders only when a signature exists —
          a job priced in the office correctly shows nothing rather than an empty evidence block. */}
      {job.signature && <SignatureRecord signature={job.signature} />}

      {/* Money pointer — ONE anchored pointer, never the P&L. */}
      <MoneyPointer
        job={job}
        invoice={invoice}
        onBill={bill}
        billing={createInvoice.isPending}
        billError={billError}
        onOpenInvoice={(invId) => { close(); openModal(MODAL.INVOICE, { invoiceId: invId }); }}
      />

      {/* Sticky footer — Done is THE primary; Delete stays quiet and red.
          Two-button foot (#362): `.sheet-pri` is width:100% at the class level,
          so beside Delete it takes flex:1 / width:auto and Delete keeps its
          intrinsic width — otherwise the flex line is over-constrained and the
          primary crushes into its sibling. */}
      <div className="sheet-foot">
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "stretch" }}>
          <button
            className="btn ghost"
            style={{
              color: "var(--red)",
              borderColor: deleteArmed ? "var(--red)" : undefined,
              flexShrink: 0,
              minHeight: 44,
            }}
            onClick={confirmDelete}
          >
            {deleteArmed ? "Yes, delete job" : "Delete job"}
          </button>
          <button className="sheet-pri" style={{ flex: 1, width: "auto" }} onClick={close}>
            Done
          </button>
        </div>
      </div>
    </>
  );
}
