/**
 * components/modals/new-customer-modal.tsx
 * Faithful port of prototype ovQuick / openQuickAdd (lines 1106-1143).
 * Exact field order: Name, Phone (with dup-hint), Service address (autocomplete),
 * Customer type (Person/Biz chip toggle), Business name (hidden when Person), Lead source (chip dropdown),
 * Book a visit reveal, More details reveal, footer.
 * NO subtitle. Button label: "Add customer" → "Create job" / "Create estimate visit".
 */

"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Modal } from "./modal";
import { useCloseModal, useOpenModal, useActiveModal, useAppStore } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { api, type RouterOutputs } from "@/lib/trpc/client";
import type { Job, Visit } from "@/lib/store/types";
import { AddressInput } from "@/components/ui/address-input";
import { DEFAULT_SOURCES, mergeSources } from "@/features/customers/merge-sources";
import { toStoreLead } from "@/features/customers/leads-hydrator";

type VisitPurpose = "job" | "look" | null;

/** The create mutation's success payload (leadDTO + the dedup `created` flag). */
type CreatedCustomer = RouterOutputs["v1"]["customers"]["create"];

/** Default estimate-visit length in hours (mirrors new-job-modal's NJ_HOURS.estimate). */
const ESTIMATE_VISIT_HOURS = 0.5;

export function NewCustomerModal({ open }: { open: boolean }) {
  const close = useCloseModal();
  const openModal = useOpenModal();
  const activeModal = useActiveModal();
  const addJob = useAppStore((s) => s.addJob);
  const addVisit = useAppStore((s) => s.addVisit);
  const companies = useAppStore((s) => s.companies);
  const addCompany = useAppStore((s) => s.addCompany);
  const storeSources = useAppStore((s) => s.sources);
  const addSource = useAppStore((s) => s.addSource);
  const mergedSources = mergeSources(DEFAULT_SOURCES, storeSources);

  const utils = api.useUtils();
  const createMutation = api.v1.customers.create.useMutation();

  // Double-submit + stale-response guards. isPending only flips on re-render,
  // so a same-tick second click (double-fire on "Create job" or "Build the
  // price") slips past the disabled props — inFlightRef blocks synchronously.
  // The submission id makes a late create response (e.g. a slow dedup result
  // landing after the form was reset/closed) a no-op instead of re-arming
  // stale state on the next open. reset() bumps the id.
  const inFlightRef = useRef(false);
  const submitSeqRef = useRef(0);

  // Dedup message shown when the submitted phone matches an existing customer.
  const [dedupLeadId, setDedupLeadId] = useState<string | null>(null);

  // Core fields
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [isBiz, setIsBiz] = useState(false);
  const [bizName, setBizName] = useState("");

  // Opened "for" a company (from the company modal) → pre-select Business and
  // seed the business name so the new customer links to it (prototype quickAddForCo).
  const paramCompanyId = activeModal?.params?.companyId as string | undefined;
  useEffect(() => {
    if (!open || paramCompanyId == null) return;
    const co = companies.find((c) => c.id === paramCompanyId);
    if (!co) return;
    setIsBiz(true);
    setBizName(co.name);
  }, [open, paramCompanyId]);

  // Source picker state
  const [source, setSource] = useState<string>("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSourceValue, setNewSourceValue] = useState("");

  // Book a visit reveal
  const [bookOpen, setBookOpen] = useState(false);
  const [jobDesc, setJobDesc] = useState("");
  const [visitPurpose, setVisitPurpose] = useState<VisitPurpose>(null);
  const [serviceAddr, setServiceAddr] = useState("");

  // More details reveal
  const [moreOpen, setMoreOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [address, setAddress] = useState("");
  const [customFields, setCustomFields] = useState<{ label: string; value: string }[]>([]);
  const [cfLabel, setCfLabel] = useState("");
  const [cfValue, setCfValue] = useState("");
  const [showAddField, setShowAddField] = useState(false);

  const [error, setError] = useState<string | null>(null);

  function reset() {
    // Invalidate any in-flight create's late response (see submitSeqRef above).
    submitSeqRef.current += 1;
    setName("");
    setPhone("");
    setIsBiz(false);
    setBizName("");
    setSource("");
    setSourceOpen(false);
    setShowAddSource(false);
    setNewSourceValue("");
    setBookOpen(false);
    setJobDesc("");
    setVisitPurpose(null);
    setServiceAddr("");
    setMoreOpen(false);
    setEmail("");
    setNotes("");
    setAddress("");
    setCustomFields([]);
    setCfLabel("");
    setCfValue("");
    setShowAddField(false);
    setError(null);
    setDedupLeadId(null);
  }

  function handleClose() {
    reset();
    close();
  }

  // Button label
  function submitLabel(): string {
    if (visitPurpose === "job") return "Create job";
    if (visitPurpose === "look") return "Create estimate visit";
    return "Add customer";
  }

  /**
   * Resolves the company id for a business customer.
   *
   * For an existing (already-persisted) company match, returns { companyId, persisted: null }.
   * For a brand-new company, returns { companyId, persisted: Promise<void> } — callers MUST
   * await `persisted` before firing the lead insert to avoid an FK violation.
   */
  function resolveCompany(): { companyId: string; persisted: Promise<void> | null } | null {
    if (!isBiz) return null;
    const nm = bizName.trim() || name.trim();
    if (!nm) return null;
    const k = nm.toLowerCase();
    const match = companies.find((c) => {
      const cn = c.name.toLowerCase();
      return cn.includes(k) || k.includes(cn);
    });
    if (match) return { companyId: match.id, persisted: null };
    const { company, persisted } = addCompany(nm);
    return { companyId: company.id, persisted };
  }

  /** Build the create-customer payload. Requires the companyId to be pre-resolved. */
  function buildCreateInput(companyId: string | undefined) {
    return {
      name: name.trim(),
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      source: source || undefined,
      companyId: companyId ?? undefined,
      // Prototype default: contacts linked to a company carry role "Contact".
      role: companyId != null ? "Contact" : undefined,
      notes: notes.trim() || undefined,
      address: address.trim() || undefined,
    };
  }

  /**
   * Create the booked work for a just-created customer — shared by the submit
   * button ("Create job" / "Create estimate visit") and "✦ Build the price →".
   * Returns { ok, job } — job is the created job for the "job" purpose (so
   * Build-price can open the price builder on it), null otherwise. ok:false
   * means the job persist failed: the error is surfaced and the modal must
   * stay open (no silent failures on interactive paths).
   */
  async function createBookedWork(data: CreatedCustomer): Promise<{ ok: boolean; job: Job | null }> {
    if (visitPurpose === "job") {
      // addJob returns { job, persisted }; the lead (data.id) is already
      // persisted by createMutation, so addJob fires v1.jobs.create immediately.
      const { job: created, persisted } = addJob({
        leadId: data.id,
        svc: "service",
        origin: "manual",
        title: jobDesc.trim() || data.name,
        addr: serviceAddr.trim() || "",
        phone: data.phone ?? "",
        status: "unscheduled",
        archived: false,
        lines: [],
        addons: [],
        photos: [],
        notes: notes.trim(),
        acts: [],
        visits: [],
      });
      // Await the job persist BEFORE closing — a v1.jobs.create failure only
      // rolls back the store with a dev log, so closing here would swallow it.
      // Mirrors new-job-modal's awaited jobPersisted.
      try {
        await persisted;
      } catch {
        setError("The customer was saved, but the job wasn't — check your connection and try again.");
        return { ok: false, job: null };
      }
      // Every job starts with one editable unplaced visit (same default as
      // quote-created jobs and the other manual-create flows). addVisit only
      // persists once the job is DB-origin, so it must run after the reconcile.
      addVisit(created.id);
      return { ok: true, job: created };
    }
    if (visitPurpose === "look") {
      // "Create estimate visit" — attach a schedulable estimate visit to the
      // lead, mirroring new-job-modal's createEstimate. evisits are store-local
      // (the leads hydrator resets them), so the lead must exist in the store:
      // the customer was created via the react-query mutation (not addLead),
      // so insert the row first if the hydrator hasn't caught up yet.
      const evisit: Visit = {
        id: crypto.randomUUID(),
        date: null,
        techId: null,
        start: null,
        dur: ESTIMATE_VISIT_HOURS,
        status: "scheduled",
      };
      const { leads, updateLead, setLeads } = useAppStore.getState();
      const existing = leads.find((l) => l.id === data.id);
      if (existing) {
        updateLead(data.id, {
          job: jobDesc.trim(),
          evisits: [...(existing.evisits ?? []), evisit],
        });
      } else {
        setLeads([
          { ...toStoreLead(data), job: jobDesc.trim(), evisits: [evisit] },
          ...leads,
        ]);
      }
    }
    return { ok: true, job: null };
  }

  /**
   * Shared create-success handler: dedup guard → booked work → refresh/close.
   * A dedup hit (data.created === false) surfaces the existing record and MUST
   * NOT create work — a job would attach to someone else's customer.
   */
  async function handleCreated(data: CreatedCustomer, openBuilder: boolean): Promise<void> {
    if (!data.created) {
      // Dedup hit — the phone matched an existing customer. Surface it instead of
      // silently closing, which would leave the user wondering why nothing appeared.
      setDedupLeadId(data.id);
      return;
    }
    const { ok, job } = await createBookedWork(data);
    if (!ok) {
      // The customer row persisted even though the job didn't — refresh the
      // list so it shows up; the error keeps the modal open for a retry.
      utils.v1.customers.list.invalidate();
      return;
    }
    // The "look" path skips the list invalidate: the refetch would rehydrate the
    // store and wipe the just-attached store-local evisit. createBookedWork
    // already inserted the lead into the store, so the list stays current.
    if (visitPurpose !== "look") utils.v1.customers.list.invalidate();
    reset();
    close();
    if (openBuilder && job) openModal(MODAL.PRICE_BUILDER, { jobId: job.id });
  }

  /**
   * Shared submit for "Add customer"/"Create job"/"Create estimate visit" and
   * "✦ Build the price →". One create per click: inFlightRef rejects re-entry
   * synchronously, and the submission id drops responses that land after the
   * form was reset (see the ref comments above).
   */
  async function submitCreate(openBuilder: boolean): Promise<void> {
    if (inFlightRef.current || createMutation.isPending) return;
    if (!name.trim()) { setError("Name is required."); return; }

    inFlightRef.current = true;
    const submission = submitSeqRef.current;
    try {
      const resolved = resolveCompany();
      // Await company persistence before inserting the lead to avoid FK race.
      if (resolved?.persisted) {
        try {
          await resolved.persisted;
        } catch {
          setError("Couldn't save the business — check your connection and try again.");
          return;
        }
      }
      if (submission !== submitSeqRef.current) return; // form reset mid-flight
      const data = await createMutation.mutateAsync(buildCreateInput(resolved?.companyId));
      if (submission !== submitSeqRef.current) return; // stale response — drop it
      await handleCreated(data, openBuilder);
    } catch (err) {
      if (submission === submitSeqRef.current) {
        setError(err instanceof Error ? err.message : "Couldn't save the customer — try again.");
      }
    } finally {
      inFlightRef.current = false;
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void submitCreate(false);
  }

  function handleOpenExisting() {
    if (!dedupLeadId) return;
    const id = dedupLeadId;
    reset();
    close();
    openModal(MODAL.LEAD, { leadId: id });
  }

  /** "✦ Build the price →" — create the customer + job, then open the price builder. */
  function handleBuildPrice() {
    void submitCreate(true);
  }

  function addCustomField() {
    const label = cfLabel.trim();
    if (!label) return;
    setCustomFields((prev) => [...prev, { label, value: cfValue.trim() }]);
    setCfLabel("");
    setCfValue("");
    setShowAddField(false);
  }

  function selectSource(s: string) {
    setSource(s);
    setSourceOpen(false);
    setShowAddSource(false);
    setNewSourceValue("");
  }

  function commitNewSource() {
    const val = newSourceValue.trim().slice(0, 100);
    if (val) {
      addSource(val);
      selectSource(val);
    } else {
      setShowAddSource(false);
      setNewSourceValue("");
    }
  }

  return (
    <Modal open={open} onClose={handleClose}>
      <h2>New customer</h2>
      {/* NO subtitle — prototype has none */}

      <form onSubmit={handleSubmit}>
        {/* 1. Name */}
        <div className="field">
          <label>Name</label>
          <input
            type="text"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        {/* 2. Phone + dup-hint */}
        <div className="field">
          <label>Phone</label>
          <input
            type="tel"
            placeholder="(925) 555-0123"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <div className="muted" id="qaDupHint" style={{ fontSize: 12, marginTop: 4 }} />
        </div>

        {/* 3. Service address — right under Phone; field service lives or dies on it */}
        <div className="field">
          <label>Service address</label>
          <AddressInput
            value={address}
            onChange={setAddress}
            placeholder="123 Main St, Oakland CA 94601"
            aria-label="Service address"
            className="w-full"
          />
        </div>

        {/* 4. Customer type chip toggle */}
        <div className="field">
          <label>Customer type</label>
          <div className="chips">
            <button
              type="button"
              className={`chip${!isBiz ? " sel" : ""}`}
              onClick={() => setIsBiz(false)}
            >
              Person
            </button>
            <button
              type="button"
              className={`chip${isBiz ? " sel" : ""}`}
              onClick={() => setIsBiz(true)}
            >
              Business
            </button>
          </div>
        </div>

        {/* 5. Business name — hidden when Person */}
        {isBiz && (
          <div className="field">
            <label>Business name</label>
            <input
              type="text"
              placeholder="Crestview Property Mgmt"
              value={bizName}
              onChange={(e) => setBizName(e.target.value)}
            />
          </div>
        )}

        {/* 6. Lead source — full-width field-style dropdown (prototype qa-srcbtn) */}
        <div className="field">
          <label>Lead source</label>
          <button
            type="button"
            className={`qa-srcbtn${sourceOpen ? " open" : ""}`}
            onClick={() => setSourceOpen((o) => !o)}
          >
            <span className={source ? "" : "ph"}>{source || "Select a source"}</span>
            <span className="qa-srccaret">{sourceOpen ? "▲" : "▼"}</span>
          </button>
          {sourceOpen && (
            <div className="qa-srclist">
              {mergedSources.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  className={`qa-srcopt${source === s.label ? " on" : ""}`}
                  onClick={() => selectSource(s.label)}
                >
                  <span>{s.label}</span>
                  {source === s.label ? <span className="qa-srcok">✓</span> : null}
                </button>
              ))}
              {showAddSource ? (
                <div className="cfrow" style={{ padding: "6px 12px" }}>
                  <input
                    type="text"
                    placeholder="Source name"
                    value={newSourceValue}
                    maxLength={100}
                    autoFocus
                    onChange={(e) => setNewSourceValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); commitNewSource(); }
                      if (e.key === "Escape") { setShowAddSource(false); setNewSourceValue(""); }
                    }}
                  />
                  <button type="button" className="btn sm primary" onClick={commitNewSource}>
                    Add
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="qa-srcopt add"
                  onClick={() => setShowAddSource(true)}
                >
                  + Add a new source…
                </button>
              )}
            </div>
          )}
        </div>


        {/* 7. Book a visit reveal */}
        <div className={`reveal${bookOpen ? " open" : ""}`} style={{ marginBottom: 14 }}>
          <div
            className="reveal-head"
            onClick={() => setBookOpen((o) => !o)}
            role="button"
            aria-expanded={bookOpen}
          >
            <span className="caret">&#9658;</span>
            Book a visit
          </div>
          <div className="reveal-body">
            {/* Job description */}
            <div className="field">
              <label>Job</label>
              <input
                type="text"
                placeholder="water heater making noise"
                value={jobDesc}
                onChange={(e) => setJobDesc(e.target.value)}
              />
            </div>

            {/* Purpose toggle: Job / Estimate visit */}
            <div className="chips" style={{ marginBottom: 14 }}>
              <button
                type="button"
                className={`chip${visitPurpose === "job" ? " sel" : ""}`}
                onClick={() =>
                  setVisitPurpose((p) => (p === "job" ? null : "job"))
                }
              >
                Job
              </button>
              <button
                type="button"
                className={`chip${visitPurpose === "look" ? " sel" : ""}`}
                onClick={() =>
                  setVisitPurpose((p) => (p === "look" ? null : "look"))
                }
              >
                Estimate visit
              </button>
            </div>

            {/* Conditional book panel */}
            {visitPurpose !== null && (
              <div>
                {visitPurpose === "job" && (
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
                      disabled={createMutation.isPending || Boolean(dedupLeadId)}
                    >
                      ✦ Build the price →
                    </button>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                      Same builder your crew uses — or price later.
                    </div>
                  </div>
                )}
                <div className="field">
                  <label>Service address</label>
                  <input
                    type="text"
                    placeholder="leave blank and we'll text for it"
                    value={serviceAddr}
                    onChange={(e) => setServiceAddr(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 8. More details reveal */}
        <div className={`reveal${moreOpen ? " open" : ""}`} style={{ marginBottom: 20 }}>
          <div
            className="reveal-head"
            onClick={() => setMoreOpen((o) => !o)}
            role="button"
            aria-expanded={moreOpen}
          >
            <span className="caret">&#9658;</span>
            More details
          </div>
          <div className="reveal-body">
            <div className="field">
              <label>Email</label>
              <input
                type="email"
                placeholder="otherwise asked at first quote"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Notes</label>
              <input
                type="text"
                placeholder="gate code, best time to call…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {customFields.map((f, i) => (
              <div className="cfrow" key={i}>
                <input className="ro" readOnly value={f.label} />
                <input
                  value={f.value}
                  placeholder="value"
                  onChange={(e) =>
                    setCustomFields((prev) =>
                      prev.map((x, xi) => (xi === i ? { ...x, value: e.target.value } : x)),
                    )
                  }
                />
              </div>
            ))}
            {showAddField ? (
              <div className="cfrow">
                <input
                  type="text"
                  placeholder="field name"
                  value={cfLabel}
                  onChange={(e) => setCfLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); addCustomField(); }
                    if (e.key === "Escape") { setShowAddField(false); setCfLabel(""); setCfValue(""); }
                  }}
                  autoFocus
                />
                <input
                  type="text"
                  placeholder="value"
                  value={cfValue}
                  onChange={(e) => setCfValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustomField(); } }}
                />
                <button type="button" className="btn sm primary" onClick={addCustomField}>
                  Add
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn ghost sm"
                style={{ fontSize: 12 }}
                onClick={() => setShowAddField(true)}
              >
                + Add a custom field
              </button>
            )}
          </div>
        </div>

        {error && (
          <p style={{ color: "var(--red)", fontSize: 13, margin: "0 0 12px" }}>{error}</p>
        )}

        {/* Dedup notice — shown when the submitted phone already belongs to an existing customer */}
        {dedupLeadId && (
          <div style={{
            background: "var(--surface-2, #f5f5f5)",
            border: "1px solid var(--border, #e0e0e0)",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 12,
            fontSize: 13,
          }}>
            <p style={{ margin: "0 0 8px", color: "var(--text-1, #111)" }}>
              A customer with that phone already exists.
            </p>
            <button
              type="button"
              className="btn primary sm"
              onClick={handleOpenExisting}
            >
              Open their record
            </button>
          </div>
        )}

        {/* 9. Footer */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost" onClick={handleClose} disabled={createMutation.isPending}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={createMutation.isPending || Boolean(dedupLeadId)}>
            {createMutation.isPending ? "Saving…" : submitLabel()}
          </button>
        </div>
      </form>
    </Modal>
  );
}
