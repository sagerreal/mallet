/**
 * components/modals/job-modal.tsx
 * Faithful port of the prototype's openJob office/owner body (lines 4699-4729)
 * plus its per-visit visitRow (4677-4698) and helpers jobPriceSummary (4513),
 * jobNoteFeed (6364), moneyPointer (6379) — re-housed in the sheet grammar:
 * sticky .sheet-head (job title · status · customer), Call/Text as a
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
 * NOTES ARE ONE CHAPTER. The job's own feed and the customer record's trail used to be two
 * sibling rows, and the second one appeared only when the customer happened to have notes — so
 * the same sheet had a row on one job and simply not on the next. They now sit as two labelled
 * halves of one "Notes" chapter: "This job", which is writable, and "On the customer", which is
 * read-only because the customer record is the one place to edit it.
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
import { fmt$, fmtPhone } from "@/lib/format";
import { SignatureRecord } from "@/components/shared/signature-record";
import { todayISO } from "@/lib/clock";
import { DurField } from "./dur-field";
import { PhoneCell } from "./lead-modal/lead-header";
import { EmailBody } from "./lead-modal/more-details";
import { JobFilesBody, JOB_ATTACH_ACCEPT } from "./job-files";
import { uploadJobFile } from "@/lib/store/upload-job-file";
import { NoteComposer } from "@/components/shared/note-composer";
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
import { Field, FieldGroup } from "@/components/ui/input";
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
/**
 * "Unassigned" is the FIRST option, always. Taking a technician off a visit while keeping its day
 * and time is an ordinary dispatch move — somebody calls in sick and the slot is held while the
 * office finds cover — and the picker inside the visit editor could not express it: it was fed
 * bare technician options, so once a visit had a crew there was no way to give it back. The row
 * that used to carry an empty option was deleted with the "Assigned to" chapter, which is what
 * turned a working path into a dead end.
 */
function crewOptions(techs: Tech[], req: readonly string[] | null): { value: string; label: string }[] {
  const none = { value: "", label: "Unassigned" };
  if (req == null || req.length === 0) return [none, ...techs.map((t) => ({ value: t.id, label: t.name }))];
  const qualified: Tech[] = [];
  const unqualified: Tech[] = [];
  for (const t of techs) {
    if (meetsRequirement(t.skills, req)) qualified.push(t);
    else unqualified.push(t);
  }
  return [
    none,
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
        {/* CREW, ON AN UNPLACED VISIT TOO. Only the placed branch below carried a picker, so the
            one visit that most often has nobody on it — the one still waiting for a slot — was the
            one you could not put anybody on. It did not show while "Assigned to" existed as a row
            of its own, because that row listed EVERY visit; deleting the row is what exposed it.
            Assigning here does not place the visit: it still needs a day and a time, which is what
            the sentence beside this says and what the board link is for. */}
        <Field label="Crew" style={{ margin: "0", minWidth: 150 }}>
          <SelectMenu
            value={visit.techId ?? ""}
            onChange={(v) => onUpdate({ techId: v || null })}
            options={crewOptions(techs, job.requiredCerts ?? null)}
            aria-label="Crew"
            compact
          />
        </Field>
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
  const appendJobNote = useAppStore((s) => s.appendJobNote);
  const attachJobFile = useAppStore((s) => s.attachJobFile);
  const leads = useAppStore((s) => s.leads);
  const techs = useAppStore((s) => s.techs);
  const invoices = useAppStore((s) => s.invoices);
  const updateJob = useAppStore((s) => s.updateJob);
  const updateLead = useAppStore((s) => s.updateLead);
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
  // The chapters, both shut on arrival. Call/Text with no number on file open Contact rather than
  // doing nothing — the Phone field is typed IN PLACE inside it, so unlike before there is no
  // second row underneath to open. Same shape, and the same reasoning, as the customer sheet.
  const [contactOpen, setContactOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

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
  // Same gate the field uses: the server refuses a note once the job is done, so say so here
  // rather than letting the office type into a field that will be rejected.
  const jobIsDone = job.status === "done";
  const noteCount = jobNoteEntries(job).length;
  const fileCount = (job.files ?? []).length;
  // The collapsed row says what is actually in there. "3 · 1 file" beats a bare count, because a
  // job whose only attachment is a permit should not read as empty.
  const notesRowValue = [
    noteCount > 0 ? String(noteCount) : null,
    fileCount > 0 ? (fileCount === 1 ? "1 file" : `${fileCount} files`) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // The latest customer note on the CLOSED row — the whole point of the row. A count would say
  // "3" to a plumber standing at a gate who needs "Gate code 4482". Reused from the customer
  // sheet, which is where that reasoning was written down.
  const custNoteSnippet = lead ? latestNoteSnippet(lead) : null;
  // The closed Notes line. The job's own count leads because it is what this sheet is about; the
  // customer's latest sentence stands in when the job has nothing yet, because a plumber at a gate
  // needs "Gate code 4482" whichever record it happens to be filed under — a bare "Add" over a
  // customer with three notes on file would be a lie about what is inside.
  const notesSummary = notesRowValue || custNoteSnippet || "Add";
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

  // WHO IS ON THIS JOB, on the CLOSED Schedule row. Assignment lives on the visit — a job can have
  // several, each with its own crew — and it had been lifted into a row of its own so a dispatcher
  // could answer "who's got this?" without opening anything. That row duplicated the Crew picker
  // the visit editor already carries, so the row is gone and the answer moved into this summary:
  // one chapter, and the collapsed line still says it.
  const assignedNames = [
    ...new Set(
      visits
        .map((v) => techs.find((t) => t.id === v.techId)?.name)
        .filter((n): n is string => Boolean(n)),
    ),
  ];
  // A visit with nobody on it is named, even when a sibling visit HAS a crew: "2 visits · Rosa
  // Boyd" over one crewed and one bare visit reads as a fully staffed job, and the unstaffed half
  // is the half somebody has to act on.
  const someUnassigned = visits.some((v) => !v.techId);
  const crewSummary = assignedNames.length
    ? someUnassigned
      ? `${assignedNames.join(", ")}, Unassigned`
      : assignedNames.join(", ")
    : "Unassigned";
  const scheduleSummary =
    visits.length === 0
      ? "Add"
      : `${visits.length} visit${visits.length === 1 ? "" : "s"} · ${crewSummary}`;

  // The closed Contact line carries the thing the row exists for — the number. Email and then the
  // address stand in when there is none, so the chapter only reads "Add" when it is genuinely bare.
  const contactSummary = phone.trim()
    ? fmtPhone(phone)
    : lead?.email?.trim()
      ? lead.email
      : job.addr?.trim()
        ? job.addr
        : "Add";

  return (
    <>
      {/* Sticky header — the job as an h2 over one calm meta line (status pill · record trail).
          NO phone here: it rendered raw E.164 jammed against the trail, and only when a number
          existed — the same two-homes split the customer sheet already removed. Call and Text sit
          directly below, which is what the number was in the header for. */}
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
        </div>
      </div>

      {/* Quiet peer actions. They disable only with NO linked customer — there is nobody to call.
          With a customer but NO NUMBER they open the CONTACT chapter below, where the Phone field
          is typed in place, rather than stacking a sheet whose whole job is one field: the chapter
          is a few inches down, and that sheet is titled with the customer's name, so it reads as
          having started something else. Same behaviour as the customer sheet. */}
      <div className="sheet-secrow">
        <button
          className="sheet-sec"
          disabled={!lead}
          title={!lead ? "No linked customer" : undefined}
          onClick={() => {
            if (!lead) return;
            if (phone.trim()) pushModal(MODAL.CALL, { leadId: lead.id });
            else setContactOpen(true);
          }}
        >
          Call
        </button>
        <button
          className="sheet-sec"
          disabled={!lead}
          title={!lead ? "No linked customer" : undefined}
          onClick={() => {
            if (!lead) return;
            if (phone.trim()) pushModal(MODAL.THREAD, { leadId: lead.id });
            else setContactOpen(true);
          }}
        >
          Text
        </button>
      </div>

      <div className="sheet-rows">
        {/* ONE REGISTER FOR ALL FIVE. Every row on this sheet is a chapter — a named group with a
            summary and a block inside — so they all read at the same level. A mix of chapter heads
            and quiet config rows put two type registers in one column and the emphasis landed on
            whichever happened to be uppercase, which is emphasis without meaning. The customer
            sheet is uniform for the same reason.

            CONTACT — how to reach the customer and where the work is. Four sibling rows before
            this, each with its own chevron, which is most of what made this sheet a wall: they are
            REFERENCE — the facts you check, not the job you came to work — so they collapse to one
            line carrying the number, and the sheet opens on the job itself.

            NO SECOND LAYER OF CHEVRONS. Opening a chapter IS the request to see what is inside it;
            a chevron on each field asks the same question twice, and it cost two opens to reach a
            keyboard. Every field in here is laid out flat, exactly as the customer sheet does it.

            Phone and Email write to the CUSTOMER, not the job — a phone number is a fact about the
            person, and a per-job copy would drift the moment they changed it. The address is the
            job's own: one customer can have work at two places. */}
        <SheetRow
          variant="section"
          label="Contact"
          value={contactSummary}
          valueIsHint={contactSummary === "Add"}
          expandable
          open={contactOpen}
          onOpenChange={setContactOpen}
        >
          <div className="sheet-inline">
            {/* No linked customer — the number lives on the job, because there is nowhere else
                for it to live. */}
            {!lead && (
              <Field label="Customer phone" style={{ margin: "0" }}>
                <input
                  type="tel"
                  defaultValue={job.phone || ""}
                  placeholder="so you can call/text from the job"
                  onBlur={(e) => updateJob(job.id, { phone: e.target.value.trim() })}
                />
              </Field>
            )}

            {lead && (
              <>
                <PhoneCell
                  label="Phone"
                  value={lead.phone ?? ""}
                  onCommit={(v: string) => updateLead(lead.id, { phone: v })}
                />
                <EmailBody lead={lead} />
              </>
            )}

            <Field label="Service address" style={{ margin: "0" }}>
              <input
                type="text"
                defaultValue={job.addr || ""}
                placeholder={lead?.address || "add the address"}
                onBlur={(e) => updateJob(job.id, { addr: e.target.value.trim() })}
              />
            </Field>
          </div>
        </SheetRow>

        {/* Price — PRICE + Total only, never cost/margin/profit (LOCKED rule).
            Hidden only for UNPRICED estimates: one signed at the door has real lines to show. */}
        {!isUnpricedEstimateJob(job) && (
          <SheetRow
            variant="section"
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

        {/* SCHEDULE — when the work happens and who is on it, one chapter. The visit editor is
            kept whole inside: unlike Contact's fields it is not a field but a block, one per
            visit, already carrying Day / Crew / Start / Length together. That is exactly why the
            separate "Assigned to" row is gone — it set the same visit.techId this does, so a job
            had two places to reassign a visit and no rule about which won. */}
        <SheetRow
          variant="section"
          label="Schedule"
          value={scheduleSummary}
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

        {/* NOTES — everything written about this job, and the customer's own trail beneath it.
            Two sibling rows before this, both about notes, one of them appearing only sometimes:
            the customer's history would show up under a row called "Customer notes" on one job and
            simply not exist on the next, which reads as a bug rather than as an empty record.

            THE FILE AND THE SENTENCE EXPLAINING IT STAY TOGETHER. A photo or a permit with no note
            beside it is a mystery six weeks later.

            ALWAYS RENDERED, with an "Add" hint when empty. It used to be gated on having content,
            which meant the only control that can attach a file to a job was invisible on every job
            that had none — you had to get a note on from the field first, just to see the row.

            The customer's notes are READ-ONLY here on purpose: one record, one edit path, and that
            path is the customer link in the header above. */}
        <SheetRow
          variant="section"
          label="Notes"
          value={notesSummary}
          valueIsHint={notesSummary === "Add"}
          expandable
          open={notesOpen}
          onOpenChange={setNotesOpen}
        >
          <div className="sheet-inline">
            <FieldGroup label="This job">
              <NoteFeed job={job} />
              {/* The paperclip goes IN the row, as on every other note surface. This sheet was
                  the one left behind: it kept JobFilesBody's own wide "Attach a file" button
                  sitting orphaned under [input][Add note] — the exact ragged shape the customer
                  sheet and both creation modals were fixed out of.

                  A file picked here is a JOB FILE, uploaded on pick and listed below, which is
                  what this sheet's attach always did. `listOnly` then stops JobFilesBody drawing
                  a second attach control for the same job. */}
              <NoteComposer
                placeholder="what happened, what's needed…"
                autoFocus={notesOpen}
                disabled={jobIsDone ? "This job is complete — its notes are closed." : false}
                attachAccept={JOB_ATTACH_ACCEPT}
                onAttachFile={async (file) => {
                  attachJobFile(job.id, await uploadJobFile(job.id, file));
                }}
                onSubmit={async (text) => (await appendJobNote(job.id, text)).ok}
              />
              <JobFilesBody
                jobId={job.id}
                files={job.files ?? []}
                listOnly
                onUploaded={(file) => attachJobFile(job.id, file)}
              />
            </FieldGroup>

            {lead && custNoteSnippet && (
              <FieldGroup label="On the customer">
                <div className="nfeed">
                  {gatherNotes(lead).map((entry) => (
                    <NoteRow key={entry.key} entry={entry} />
                  ))}
                </div>
              </FieldGroup>
            )}
          </div>
        </SheetRow>

        {/* Checklist — the template picker + create form kept intact inside. */}
        <SheetRow
          variant="section"
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
