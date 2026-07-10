/**
 * components/modals/new-job-modal.tsx
 * Faithful port of the prototype's openNewJob / saveNewJob (elas-crm-prototype.html
 * lines 4381-4502): a clean job-creation form that mirrors the New-customer modal.
 *
 * Field order (exact): What's the job? · Type chips (Estimate | Job) · Customer
 * (datalist over live leads) + Phone · Service address · Price (optional, Job only) ·
 * Visits (unplaced hours rows + "Add a visit") · Before-you-leave / Visit checklist
 * picker (collapsed summary that expands in-flow) · ▸ More reveal (Notes) · footer.
 *
 * Type model (per product memory): two user-facing types — Estimate and Job — mapped
 * to njType 'estimate' / 'service'. NJ_HOURS defaults the visit length per type.
 * Visits are created UNPLACED (date/techId/start null) — dragged onto the Schedule
 * board later, so there is NO date/crew picker at creation.
 *
 * Create behavior:
 *  - Estimate → a LEAD + unplaced evisit(s) (a scoping visit), NOT a job.
 *  - Job (service) → addJob(...) + addVisit(...) per visit row.
 *
 * Deferred (surfaces / data not in the store yet):
 *  - "Build the price →" opens the tech quote builder in the prototype; here it just
 *    creates the job then closes. See handleBuildPrice.
 *  - Checklist templates: the picker markup is faithful, but there is no checklist
 *    template data in the store, so the chosen template is not persisted onto the
 *    job/lead. See CHECKLIST comment below.
 */

"use client";

import { useState, type FormEvent } from "react";
import { useCloseModal, useOpenModal, useLeads, useAppStore } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { Job, Lead, Visit } from "@/lib/store/types";

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

/** A visit row while composing — hours only, placed later on the Schedule. */
interface VisitRow {
  h: number;
}


/** Round to the nearest quarter-hour, floored at 0.25 (prototype clamp). */
function clampHours(h: number): number {
  return Math.max(0.25, Math.round(h * 4) / 4);
}

// ---- component --------------------------------------------------------------

export function NewJobModalContent() {
  const close = useCloseModal();
  const openModal = useOpenModal();
  const leads = useLeads();
  const addJob = useAppStore((s) => s.addJob);
  const addVisit = useAppStore((s) => s.addVisit);
  const addLead = useAppStore((s) => s.addLead);
  const updateLead = useAppStore((s) => s.updateLead);

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

  // Checklist picker (collapsed in-flow summary that expands).
  const [chkTpl, setChkTpl] = useState<string | null>(null);
  const [chkItems, setChkItems] = useState<string[]>([]);
  const [chkOpen, setChkOpen] = useState(false);
  const [chkDraft, setChkDraft] = useState("");

  // ▸ More reveal
  const [moreOpen, setMoreOpen] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // ---- type + visit helpers (mirror njSetType / njNudge / njAddVisit) -------

  function selectType(t: NjType) {
    setNjType(t);
    // Reset the checklist pick + collapse it (templates differ by type).
    setChkTpl(null);
    setChkItems([]);
    setChkOpen(false);
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
      setChkItems([]);
      setChkOpen(false);
    } else {
      setChkOpen(true);
    }
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

  // ---- create (mirror saveNewJob) -------------------------------------------

  /** The list of visits to create — always at least one, clamped to quarters. */
  function resolvedVisits(): VisitRow[] {
    const rows = visits.length ? visits : [{ h: NJ_HOURS[njType] }];
    return rows.map((v) => ({ h: clampHours(v.h) }));
  }

  function createEstimate(job: string) {
    const rows = resolvedVisits();
    const custName = customer.trim();
    const match = matchLead(custName);

    // Resolve the matched lead, or add a new one (Estimate = a scoping visit on a lead).
    // addLead returns { lead, persisted } — destructure so `lead` is the optimistic Lead.
    const lead =
      match ??
      addLead({
        name: custName || "New customer",
        phone: phone.trim(),
        source: "Added manually",
        stage: "Contacted",
        job,
        address: addr.trim() || undefined,
      }).lead;

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
    // CHECKLIST: chosen scope template would attach to lead.scope here — deferred
    // (no checklist template data in the store yet).
  }

  function createJob(job: string) {
    const rows = resolvedVisits();
    const match = matchLead(customer.trim());
    const created = addJob({
      leadId: match ? match.id : "",
      svc: njType, // 'service'
      origin: "manual",
      title: job,
      addr: addr.trim() || (match?.address ?? ""),
      phone:
        phone.trim() || (match && match.phone && match.phone !== "—" ? match.phone : ""),
      status: "unscheduled",
      archived: false,
      lines: [],
      addons: [],
      photos: [],
      notes: notes.trim(),
      acts: [],
      visits: [],
    });
    // Each visit is created UNPLACED (hours only) — dragged onto the Schedule later.
    rows.forEach((v) => addVisit(created.id, v.h));
    // CHECKLIST: chosen before-you-leave template would attach to the job here —
    // deferred (no checklist template data in the store yet).
    return created;
  }

  /** Validate + create the job/estimate; returns the created Job (job types) or
   *  null (estimate types create a lead+evisit; nothing to price). */
  function commit(): { ok: boolean; job: Job | null } {
    const job = title.trim();
    if (!job) {
      setError("Add what the job is.");
      return { ok: false, job: null };
    }
    if (njType === "estimate") {
      createEstimate(job);
      return { ok: true, job: null };
    }
    return { ok: true, job: createJob(job) };
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (commit().ok) close();
  }

  function handleBuildPrice() {
    // Create the job, then hand off to the price builder (prototype saveNewJob(true)).
    const { ok, job } = commit();
    if (!ok) return;
    close();
    if (job) openModal(MODAL.PRICE_BUILDER, { jobId: job.id });
  }

  // ---- checklist summary label ----------------------------------------------

  const chkLabel: string =
    njType === "estimate" ? "Visit checklist" : "Before-you-leave checklist";
  const chkIsBlank = chkTpl === "blank";
  const chkExpanded = chkOpen || chkIsBlank;
  const chkCurName = !chkTpl ? "No checklist" : chkIsBlank ? "Custom checklist" : "Checklist";

  // ---- render ---------------------------------------------------------------

  return (
    <div>
      <h2 style={{ marginBottom: 14 }}>New job</h2>

      <form onSubmit={handleSubmit}>
        {/* What's the job? */}
        <div className="field">
          <label>What&apos;s the job?</label>
          <input
            type="text"
            placeholder="e.g. water heater repair"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>

        {/* Type chips — Estimate | Job */}
        <div className="field">
          <label>Type</label>
          <div className="chips">
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
              >
                <span
                  style={{
                    display: "inline-block",
                    width: 8,
                    height: 8,
                    borderRadius: 2,
                    background: TYPE_DOT[t],
                    marginRight: 6,
                    verticalAlign: "middle",
                  }}
                />
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {/* Customer (datalist picker) + Phone */}
        <div
          className="row2"
          style={{ gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}
        >
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Customer</label>
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
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Phone</label>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="(925) 555-0123"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
        </div>

        {/* Service address */}
        <div className="field">
          <label>Service address</label>
          <input
            type="text"
            placeholder="add the address"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
          />
        </div>

        {/* Price (optional) — Job only (estimates are quoted by the office after the visit) */}
        {njType !== "estimate" && (
          <div className="field">
            <label>
              Price{" "}
              <span
                className="muted"
                style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}
              >
                (optional)
              </span>
            </label>
            <button
              type="button"
              className="btn"
              style={{ width: "100%", justifyContent: "center" }}
              onClick={handleBuildPrice}
            >
              ✦ Build the price →
            </button>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
              Same builder your crew uses — or price later.
            </div>
          </div>
        )}

        {/* Visits — unplaced hours rows */}
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Visits</label>
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
              gap: 10,
              marginTop: 4,
            }}
          >
            <span
              className="linklike"
              style={{ fontSize: 13, fontWeight: 700 }}
              onClick={addVisitRow}
            >
              + Add a visit
            </span>
            <span className="muted" style={{ fontSize: 11.5 }}>
              drag onto the Schedule to book
            </span>
          </div>
        </div>

        {/* Checklist picker — collapsed in-flow summary that expands */}
        <div className="field" style={{ marginTop: 14, marginBottom: 0 }}>
          <label>
            {chkLabel}{" "}
            <span
              className="muted"
              style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}
            >
              (optional)
            </span>
          </label>
          <div>
            <button
              type="button"
              className={`njchk-toggle${chkExpanded ? " open" : ""}`}
              onClick={() => setChkOpen((o) => !o)}
            >
              <span className="caret">▸</span>
              <span style={{ flex: 1, fontWeight: chkTpl ? 700 : 500 }}>{chkCurName}</span>
              <span className="chg">{chkExpanded ? "" : "change"}</span>
            </button>

            {chkExpanded && (
              <>
                <div className="njchklist" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className={`njchk-row${!chkTpl ? " sel" : ""}`}
                    onClick={() => pickChecklist("")}
                  >
                    <span className="njchk-dot">✓</span>
                    <span style={{ flex: 1 }}>No checklist</span>
                  </button>
                  {/* deferred: checklist templates — no template data in the store yet */}
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
              </>
            )}
          </div>
        </div>

        {/* ▸ More reveal — Notes */}
        <div className={`reveal${moreOpen ? " open" : ""}`} style={{ marginTop: 14 }}>
          <div
            className="reveal-head"
            onClick={() => setMoreOpen((o) => !o)}
            role="button"
            aria-expanded={moreOpen}
          >
            <span className="caret">▸</span> More
          </div>
          <div className="reveal-body">
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Notes</label>
              <input
                type="text"
                placeholder="gate code, what to bring…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
        </div>

        {error && (
          <p style={{ color: "var(--red)", fontSize: 13, margin: "12px 0 0" }}>{error}</p>
        )}

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 18 }}>
          <button type="button" className="btn ghost" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            Create job
          </button>
        </div>
      </form>
    </div>
  );
}
