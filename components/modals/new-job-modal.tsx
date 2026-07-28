/**
 * components/modals/new-job-modal.tsx
 * Faithful port of the prototype's openNewJob / saveNewJob (elas-crm-prototype.html
 * lines 4381-4502): a clean job-creation form that mirrors the New-customer modal.
 *
 * Field order (exact): What's the job? · Type chips (Estimate | Job) · Customer
 * (datalist over live leads) + Phone · Service address · Price (optional, Job only) ·
 * Visits (unplaced hours rows + "Add a visit") · Before-you-leave checklist picker
 * (Job type only; collapsed summary that expands in-flow) · ▸ More reveal (Notes) ·
 * footer.
 *
 * Type model (per product memory): two user-facing types — Estimate and Job — mapped
 * to njType 'estimate' / 'service'. NJ_HOURS defaults the visit length per type.
 * Visits are created UNPLACED (date/techId/start null) — dragged onto the Schedule
 * board later, so there is NO date/crew picker at creation.
 *
 * Create behavior:
 *  - Estimate → a LEAD + unplaced evisit(s) (a scoping visit), NOT a job.
 *  - Job (service) → addJob(...) + addVisit(...) per visit row + the picked
 *    checklist attached via updateJob AFTER jobPersisted resolves (origin 'db').
 *
 * Deferred (surfaces / data not in the store yet):
 *  - "Build the price →" opens the tech quote builder in the prototype; here it just
 *    creates the job then closes. See handleBuildPrice.
 */

"use client";

import { useRef, useState, type FormEvent } from "react";
import { useCloseModal, useOpenModal, usePushModal, useLeads, useAppStore } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { DisclosureRow } from "@/components/ui/disclosure-row";
import type { ChecklistItem, Job, Lead, Visit } from "@/lib/store/types";
import { Field, FieldGroup } from "@/components/ui/input";

// A custom-checklist line mentioning a photo becomes a photo step (shared heuristic).
const CHK_PHOTO_RE = /photo|picture/i;

// ---- constants (mirror prototype NJ_HOURS + SVC_META dot colors) ------------

/** njType → default visit length in hours (prototype NJ_HOURS). */
const NJ_HOURS: Record<NjType, number> = {
  estimate: 0.5,
  service: 1.5,
} as const;

/** The set of visit-hour defaults, used to detect an untouched single visit. */
const NJ_HOURS_VALUES: readonly number[] = Object.values(NJ_HOURS);

/** njType → chip dot color (prototype SVC_META[t].edge). */
const TYPE_DOT: Record<NjType, string> = {
  estimate: "var(--amber)",
  service: "#9C5B34",
} as const;

type NjType = "estimate" | "service";

/** The staged (below-the-essentials) disclosure rows — one open at a time. */
type RowKey = "visits" | "chk" | "notes";

/** A visit row while composing — hours only, placed later on the Schedule. */
interface VisitRow {
  h: number;
}

/** Clip a collapsed-row summary to the row word budget. */
function clip(s: string, max = 28): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}


/** Round to the nearest quarter-hour, floored at 0.25 (prototype clamp). */
function clampHours(h: number): number {
  return Math.max(0.25, Math.round(h * 4) / 4);
}

// ---- component --------------------------------------------------------------

export function NewJobModalContent() {
  const close = useCloseModal();
  const openModal = useOpenModal();
  const pushModal = usePushModal();
  const leads = useLeads();
  const addJob = useAppStore((s) => s.addJob);
  const addVisit = useAppStore((s) => s.addVisit);
  const addLead = useAppStore((s) => s.addLead);
  const updateLead = useAppStore((s) => s.updateLead);
  const updateJob = useAppStore((s) => s.updateJob);
  const checklists = useAppStore((s) => s.checklists);

  // Saved before-you-leave checklists feed the picker (hydrated from the DB).
  const jobChecklists = checklists.filter((c) => c.stage === "job");

  // Only live (non-archived) leads feed the customer picker (prototype liveLeads()).
  const liveLeads = leads.filter((l) => !l.archived);

  // Core fields
  const [title, setTitle] = useState("");
  const [njType, setNjType] = useState<NjType>("service");
  const [customer, setCustomer] = useState("");
  const [phone, setPhone] = useState("");
  const [addr, setAddr] = useState("");
  const [notes, setNotes] = useState("");

  // Visits (unplaced hours rows) — default one row at the type's NJ_HOURS.
  const [visits, setVisits] = useState<VisitRow[]>([{ h: NJ_HOURS.service }]);

  // The staged rows (list-first accordion): one open at a time, front-desk
  // RuleRow precedent. The collapsed value is the summary.
  const [openRow, setOpenRow] = useState<RowKey | null>(null);
  const toggleRow = (k: RowKey) => setOpenRow((prev) => (prev === k ? null : k));

  // Checklist picker (lives in the checklist row).
  const [chkTpl, setChkTpl] = useState<string | null>(null);
  const [chkItems, setChkItems] = useState<string[]>([]);
  const [chkDraft, setChkDraft] = useState("");

  const [error, setError] = useState<string | null>(null);

  // Set when a submit created the job but the checklist attach failed — a retry
  // re-attaches to THIS job instead of minting a duplicate (mirrors
  // job-checklist-block's createdRef). The modal unmounts on close, so the ref
  // cannot leak into the next open.
  const chkRetryJobRef = useRef<Job | null>(null);

  // ---- type + visit helpers (mirror njSetType / njNudge / njAddVisit) -------

  function selectType(t: NjType) {
    setNjType(t);
    // Reset the checklist pick + collapse its row (templates differ by type;
    // for estimates the row unmounts entirely).
    setChkTpl(null);
    setChkItems([]);
    setOpenRow((prev) => (prev === "chk" ? null : prev));
    // If the visits are still a single untouched default, retune to the new type.
    setVisits((prev) =>
      prev.length === 1 && prev[0] !== undefined && NJ_HOURS_VALUES.includes(prev[0].h)
        ? [{ h: NJ_HOURS[t] }]
        : prev,
    );
  }

  function nudgeVisit(i: number, d: number) {
    setVisits((prev) =>
      prev.map((v, vi) => (vi === i ? { h: clampHours(v.h + d) } : v)),
    );
  }

  function setVisitHours(i: number, val: string) {
    const parsed = Number.parseFloat(val);
    const next = clampHours(Number.isFinite(parsed) ? parsed : 0.25);
    setVisits((prev) => prev.map((v, vi) => (vi === i ? { h: next } : v)));
  }

  function addVisitRow() {
    setVisits((prev) => [...prev, { h: NJ_HOURS[njType] }]);
  }

  function removeVisitRow(i: number) {
    setVisits((prev) => (prev.length <= 1 ? prev : prev.filter((_, vi) => vi !== i)));
  }

  // ---- customer picker (mirror njCustFill / njMatchLead) --------------------

  /** Resolve the typed name to a live lead by exact (case-insensitive) name. */
  function matchLead(name: string): Lead | undefined {
    const n = name.trim().toLowerCase();
    if (!n) return undefined;
    return liveLeads.find((l) => l.name.toLowerCase() === n);
  }

  /** On picking an existing customer, prefill phone/address (don't clobber typed). */
  function fillFromCustomer(name: string) {
    const l = matchLead(name);
    if (!l) return;
    if (!phone && l.phone && l.phone !== "—") setPhone(l.phone);
    if (!addr && l.address) setAddr(l.address);
  }

  // ---- checklist picker (mirror njPickChk / njAddChkItem) -------------------

  function pickChecklist(tpl: string) {
    const next = tpl === "" ? null : tpl;
    setChkTpl(next);
    if (next !== "blank") {
      // Picking a template (or none) completes the row — collapse to summary.
      setChkItems([]);
      setOpenRow(null);
    }
    // "blank" keeps the row open: the from-scratch builder needs the space.
  }

  function addChkItem() {
    const t = chkDraft.trim();
    if (!t) return;
    setChkItems((prev) => [...prev, t]);
    setChkDraft("");
  }

  function removeChkItem(idx: number) {
    setChkItems((prev) => prev.filter((_, i) => i !== idx));
  }

  /** The picked checklist as a job snapshot — null when none picked. */
  function checklistSnapshot(): { name: string; items: ChecklistItem[] } | null {
    if (chkTpl === "blank") {
      // A typed-but-not-added item row must not be silently dropped — fold it in.
      const texts = chkDraft.trim() ? [...chkItems, chkDraft.trim()] : chkItems;
      if (texts.length === 0) return null;
      return {
        name: "Checklist",
        items: texts.map((text, i) => ({
          id: crypto.randomUUID(),
          text,
          type: CHK_PHOTO_RE.test(text) ? ("photo" as const) : ("check" as const),
          required: true,
          position: i,
        })),
      };
    }
    const saved = jobChecklists.find((c) => c.id === chkTpl);
    return saved ? { name: saved.name, items: saved.items } : null;
  }

  // ---- create (mirror saveNewJob) -------------------------------------------

  /** The list of visits to create — always at least one, clamped to quarters. */
  function resolvedVisits(): VisitRow[] {
    const rows = visits.length ? visits : [{ h: NJ_HOURS[njType] }];
    return rows.map((v) => ({ h: clampHours(v.h) }));
  }

  /** Returns true on success, false if the server create failed (error already set). */
  async function createEstimate(job: string): Promise<boolean> {
    const rows = resolvedVisits();
    const custName = customer.trim();
    const match = matchLead(custName);

    // Resolve the matched lead, or create a new one and AWAIT the server id.
    // addLead returns { lead, persisted }; the evisit must attach to the
    // reconciled (server-assigned) id, so we await before patching.
    let lead: Lead;
    if (match) {
      lead = match;
    } else {
      const { persisted } = addLead({
        name: custName || "New customer",
        phone: phone.trim(),
        source: "Added manually",
        stage: "Contacted",
        job,
        address: addr.trim() || undefined,
      });
      try {
        lead = await persisted;
      } catch {
        setError("Couldn't save the customer — check your connection and try again.");
        return false;
      }
    }

    // Merge fill-ins onto an existing lead without clobbering (prototype behavior).
    const existing = lead.evisits ?? [];
    const patch: Partial<Lead> = {
      job,
      evisits: [
        ...existing,
        ...rows.map<Visit>((v) => ({
          id: crypto.randomUUID(),
          date: null,
          techId: null,
          start: null,
          dur: v.h,
          status: "scheduled",
        })),
      ],
    };
    if (phone.trim() && (!lead.phone || lead.phone === "—")) patch.phone = phone.trim();
    if (addr.trim() && !lead.address) patch.address = addr.trim();
    if (notes.trim()) patch.notes = notes.trim();

    updateLead(lead.id, patch);
    // No checklist on estimates — leads carry no checklist; the section only
    // renders for the Job type.
    return true;
  }

  /** Create a new Job and persist it (along with its visits) to the database.
   *
   *  For the "new customer" path (typed name with no matching lead), we first
   *  create the lead and await the server-assigned id — the job requires a
   *  non-null lead FK, so we must use the reconciled (server) id, not the
   *  optimistic one.  This mirrors createEstimate's addLead → await persisted
   *  pattern from Phase 1.
   *
   *  Visit persistence depends on the job having origin === "db" (addVisit guards
   *  on this before firing v1.visits.createVisit).  addJob now returns
   *  { job, persisted } — we await persisted (which resolves after v1.jobs.create
   *  reconciles with origin "db") before calling addVisit so the visits are
   *  persisted along with the job, not silently dropped.
   *
   *  Returns false on failure (error already set via setError).
   */
  async function createJob(job: string): Promise<{ ok: boolean; createdJob: Job | null }> {
    // Retry after a failed checklist attach: the job (and its visits) already
    // persisted — only the attach is outstanding, so don't create a duplicate.
    if (chkRetryJobRef.current) return attachPickedChecklist(chkRetryJobRef.current);

    const rows = resolvedVisits();
    const custName = customer.trim();
    const match = matchLead(custName);

    // Resolve the lead — either an existing match (already in the DB) or a newly
    // created one.  For a new lead we MUST await the server-assigned id before
    // creating the job, because the job's lead_id FK must reference a real row.
    let lead: Lead;
    if (match) {
      lead = match;
    } else {
      const { persisted: leadPersisted } = addLead({
        name: custName || "New customer",
        phone: phone.trim(),
        source: "Added manually",
        stage: "Contacted",
        job,
        address: addr.trim() || undefined,
      });
      try {
        lead = await leadPersisted;
      } catch {
        setError("Couldn't save the customer — check your connection and try again.");
        return { ok: false, createdJob: null };
      }
    }

    const { job: created, persisted: jobPersisted } = addJob({
      leadId: lead.id,
      svc: njType, // 'service'
      origin: "manual",
      title: job,
      addr: addr.trim() || (lead.address ?? ""),
      phone: phone.trim() || (lead.phone && lead.phone !== "—" ? lead.phone : ""),
      status: "unscheduled",
      archived: false,
      lines: [],
      addons: [],
      photos: [],
      notes: notes.trim(),
      acts: [],
      visits: [],
    });

    // Await the job reconcile (origin flips to "db") before adding visits so that
    // addVisit sees origin === "db" and fires v1.visits.createVisit.  Without this
    // await, visits are added while the job is still "manual" and are silently
    // skipped by addVisit's origin guard — they would be lost on a page refresh.
    try {
      await jobPersisted;
    } catch {
      setError("Couldn't save the job — check your connection and try again.");
      return { ok: false, createdJob: null };
    }

    // Each visit is created UNPLACED (hours only) — dragged onto the Schedule later.
    rows.forEach((v) => addVisit(created.id, v.h));

    return attachPickedChecklist(created);
  }

  /** Attach the picked before-you-leave checklist to the created job. Must run
   *  AFTER jobPersisted — updateJob only persists once the job is DB-origin.
   *  AWAITED: updateJob resolves { ok:false } on a failed persist (the slice
   *  rolls back with a dev-only log), so a fire-and-forget here would ship the
   *  job with its checklist silently missing. */
  async function attachPickedChecklist(created: Job): Promise<{ ok: boolean; createdJob: Job | null }> {
    const checklist = checklistSnapshot();
    if (checklist) {
      const { ok } = await updateJob(created.id, { checklist });
      if (!ok) {
        chkRetryJobRef.current = created;
        setError("The job was saved, but the checklist wasn't — try again.");
        return { ok: false, createdJob: null };
      }
    }
    chkRetryJobRef.current = null;
    return { ok: true, createdJob: created };
  }

  /** Validate + create the job/estimate. For estimates the create is async
   *  (awaits the persisted lead before attaching the evisit); returns a promise
   *  resolving to { ok, job }. */
  async function commit(): Promise<{ ok: boolean; job: Job | null }> {
    const job = title.trim();
    if (!job) {
      setError("Add what the job is.");
      return { ok: false, job: null };
    }
    if (njType === "estimate") {
      const ok = await createEstimate(job);
      return { ok, job: null };
    }
    const { ok, createdJob } = await createJob(job);
    return { ok, job: createdJob };
  }

  /**
   * ONE guarded entry point for both submit buttons.
   *
   * `commit()` is two awaited round trips — create the customer, then the job, then its visit —
   * roughly a second before the modal closes, and every one of those calls mints a fresh UUID.
   * Unguarded, three impatient clicks produced three customers, three jobs and three visits (seen
   * in production: v1.customers.create → v1.jobs.create → v1.visits.createVisit, ×3, all 200).
   * Server idempotency cannot save this — customers.create takes no client id and dedupes only on
   * a non-null phone — so the guard has to be here.
   *
   * The ref is checked synchronously because `disabled` only takes effect on the next render: a
   * same-tick second click is dispatched before that. Same reasoning, and the same shape, as
   * new-customer-modal.tsx.
   */
  const inFlightRef = useRef(false);
  const [saving, setSaving] = useState(false);

  async function submitCreate(openBuilder: boolean): Promise<void> {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setSaving(true);
    try {
      const { ok, job } = await commit();
      if (!ok) return;
      close();
      if (openBuilder && job) {
        // Land the builder ON the new job: ✕ / Done pop back to the job modal.
        openModal(MODAL.JOB, { jobId: job.id });
        pushModal(MODAL.PRICE_BUILDER, { jobId: job.id });
      }
    } finally {
      // Released in `finally`, never only on success: commit() deliberately supports retry (the
      // checklist-attach path re-enters with the job already created), and a stuck guard would
      // leave the modal permanently unable to submit.
      inFlightRef.current = false;
      setSaving(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await submitCreate(false);
  }

  async function handleBuildPrice() {
    // Create the job, then hand off to the price builder (prototype saveNewJob(true)).
    await submitCreate(true);
  }

  // ---- collapsed row summaries (the value IS the state) ---------------------

  const chkIsBlank = chkTpl === "blank";
  const chkPicked = jobChecklists.find((c) => c.id === chkTpl);
  const chkCurName = !chkTpl
    ? "No checklist"
    : chkIsBlank
      ? "Custom checklist"
      : (chkPicked?.name ?? "No checklist");

  const visitsTotalH = visits.reduce((s, v) => s + v.h, 0);
  const visitsSummary = `${visits.length} visit${visits.length > 1 ? "s" : ""} · ${visitsTotalH}h`;
  const notesSummary = notes.trim() ? clip(notes) : "—";

  // ---- render ---------------------------------------------------------------

  return (
    <div>
      <h2 style={{ marginBottom: "var(--space-4)" }}>New job</h2>

      <form onSubmit={handleSubmit}>
        {/* What's the job? */}
        <Field label="What's the job?">
          <input
            type="text"
            placeholder="e.g. water heater repair"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </Field>

        {/* Type chips — Estimate | Job */}
        <FieldGroup label="Type" groupClassName="chips">
          {(
            [
              ["estimate", "Estimate"],
              ["service", "Job"],
            ] as const
          ).map(([t, lbl]) => (
              <button
                key={t}
                type="button"
                className={`chip${njType === t ? " sel" : ""}`}
                onClick={() => selectType(t)}
                aria-pressed={njType === t}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: "var(--radius-2xs)",
                    background: TYPE_DOT[t],
                    marginRight: "var(--space-2)",
                    verticalAlign: "middle",
                  }}
                />
                {lbl}
              </button>
          ))}
        </FieldGroup>

        {/* Customer (datalist picker) + Phone */}
        <div
          className="row2"
          style={{ gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)", marginBottom: "var(--space-4)" }}
        >
          <Field label="Customer" style={{ marginBottom: "0" }}>
            <input
              type="text"
              list="njCustList"
              placeholder="search or add"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              onBlur={(e) => fillFromCustomer(e.target.value)}
            />
            <datalist id="njCustList">
              {liveLeads.map((l) => (
                <option key={l.id} value={l.name} />
              ))}
            </datalist>
          </Field>
          <Field label="Phone" style={{ marginBottom: "0" }}>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(925) 555-0123"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
        </div>

        {/* Service address */}
        <Field label="Service address">
          <input
            type="text"
            placeholder="add the address"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
          />
        </Field>

        {/* The staged details — a definition list of disclosure rows (front-desk
            RuleRow pattern): label · current value, one editor open at a time,
            everything in-flow. Title/type/customer/address above are the whole
            90% intake; these rows are the "one level down". Price is a terminal
            action, so it lives in the footer, not here. */}
        <div style={{ borderTop: "1px solid var(--line-2)", margin: "var(--space-2) 0 0" }}>
          <DisclosureRow
            label="Visits"
            value={visitsSummary}
            open={openRow === "visits"}
            onToggle={() => toggleRow("visits")}
          >
            <div>
              {visits.map((v, i) => (
                <div className="njvisit" key={i}>
                  <span className="njvisit-t">Visit {i + 1}</span>
                  <div className="njstepper">
                    <button type="button" onClick={() => nudgeVisit(i, -0.5)} aria-label="less time">
                      −
                    </button>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={0.25}
                      step={0.25}
                      value={v.h}
                      onChange={(e) => setVisitHours(i, e.target.value)}
                    />
                    <span className="u">h</span>
                    <button type="button" onClick={() => nudgeVisit(i, 0.5)} aria-label="more time">
                      +
                    </button>
                  </div>
                  {visits.length > 1 && (
                    <button
                      type="button"
                      className="njvisit-x"
                      onClick={() => removeVisitRow(i)}
                      aria-label="remove visit"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "var(--space-3)",
                marginTop: "var(--space-1)",
              }}
            >
              <span
                className="linklike"
                style={{ fontSize: "var(--type-base)", fontWeight: 700 }}
                onClick={addVisitRow}
              >
                + Add a visit
              </span>
              <span className="muted" style={{ fontSize: "var(--type-sm)" }}>
                drag onto the Schedule to book
              </span>
            </div>
          </DisclosureRow>

          {/* Jobs only: estimates attach to the lead, which carries no checklist. */}
          {njType === "service" && (
            <DisclosureRow
              label="Before-you-leave checklist"
              value={chkCurName}
              open={openRow === "chk" || chkIsBlank}
              onToggle={() => toggleRow("chk")}
            >
              <div className="njchklist">
                <button
                  type="button"
                  className={`njchk-row${!chkTpl ? " sel" : ""}`}
                  onClick={() => pickChecklist("")}
                >
                  <span className="njchk-dot">✓</span>
                  <span style={{ flex: 1 }}>No checklist</span>
                </button>
                {jobChecklists.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`njchk-row${chkTpl === c.id ? " sel" : ""}`}
                    onClick={() => pickChecklist(c.id)}
                  >
                    <span className="njchk-dot">✓</span>
                    <span style={{ flex: 1 }}>{c.name}</span>
                    <span className="muted" style={{ fontSize: "var(--type-sm)" }}>{c.items.length} items</span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                className={`njchk-build${chkIsBlank ? " sel" : ""}`}
                onClick={() => pickChecklist("blank")}
              >
                <span className="plus">+</span>Build from scratch
              </button>

              {chkIsBlank && (
                <div className="njbuilder">
                  {chkItems.map((t, i) => (
                    <div className="njbi" key={i}>
                      <span style={{ flex: 1 }}>{t}</span>
                      <span
                        className="linklike"
                        style={{ color: "var(--ink-3)", fontWeight: 800 }}
                        onClick={() => removeChkItem(i)}
                      >
                        ✕
                      </span>
                    </div>
                  ))}
                  <div
                    className="cfrow"
                    style={{ marginTop: chkItems.length ? 8 : 0 }}
                  >
                    <input
                      placeholder="e.g. Photo: dry under the sink"
                      style={{ flex: 2 }}
                      value={chkDraft}
                      onChange={(e) => setChkDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addChkItem();
                        }
                      }}
                    />
                    <button type="button" className="btn sm primary" onClick={addChkItem}>
                      Add item
                    </button>
                  </div>
                </div>
              )}
            </DisclosureRow>
          )}

          <DisclosureRow
            label="Notes"
            value={notesSummary}
            open={openRow === "notes"}
            onToggle={() => toggleRow("notes")}
          >
            <Field label="Notes" style={{ marginBottom: "0" }}>
              <input
                type="text"
                placeholder="gate code, what to bring…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
          </DisclosureRow>
        </div>

        {error && (
          <p style={{ color: "var(--red)", fontSize: "var(--type-base)", margin: "var(--space-3) 0 0" }}>{error}</p>
        )}

        {/* Footer — Build-the-price is a terminal action (creates the job, then
            opens the builder), so it belongs here beside Create, not as a form
            field. Jobs only: estimates are quoted by the office after the visit. */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)", marginTop: "var(--space-5)" }}>
          <button type="button" className="btn ghost" onClick={close} disabled={saving}>
            Cancel
          </button>
          {njType !== "estimate" && (
            <button type="button" className="btn" onClick={handleBuildPrice} disabled={saving}>
              ✦ Build the price →
            </button>
          )}
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "Creating…" : "Create job"}
          </button>
        </div>
      </form>
    </div>
  );
}
