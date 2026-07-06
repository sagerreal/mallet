/**
 * components/modals/new-customer-modal.tsx
 * Faithful port of prototype ovQuick / openQuickAdd (lines 1106-1143).
 * Exact field order: Name, Phone (with dup-hint), Customer type (Person/Biz chip toggle),
 * Business name (hidden when Person), Lead source (chip dropdown),
 * Book a visit reveal, More details reveal, footer.
 * NO subtitle. Button label: "Add customer" → "Create job" / "Create estimate visit".
 */

"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "./modal";
import { useCloseModal, useOpenModal, useActiveModal, useAppStore } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import type { Job, Lead } from "@/lib/store/types";

const SOURCES = [
  "Google",
  "Referral",
  "Nextdoor / FB",
  "Repeat customer",
  "Yard sign",
  "Angi",
  "Thumbtack",
  "Yelp",
] as const;

type VisitPurpose = "job" | "look" | null;

export function NewCustomerModal({ open }: { open: boolean }) {
  const close = useCloseModal();
  const openModal = useOpenModal();
  const activeModal = useActiveModal();
  const addLead = useAppStore((s) => s.addLead);
  const addJob = useAppStore((s) => s.addJob);
  const companies = useAppStore((s) => s.companies);
  const addCompany = useAppStore((s) => s.addCompany);

  // Core fields
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [isBiz, setIsBiz] = useState(false);
  const [bizName, setBizName] = useState("");

  // Opened "for" a company (from the company modal) → pre-select Business and
  // seed the business name so the new customer links to it (prototype quickAddForCo).
  const paramCompanyId = activeModal?.params?.companyId as number | undefined;
  useEffect(() => {
    if (!open || paramCompanyId == null) return;
    const co = companies.find((c) => c.id === paramCompanyId);
    if (!co) return;
    setIsBiz(true);
    setBizName(co.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, paramCompanyId]);

  // Source picker state
  const [source, setSource] = useState<string>("");
  const [sourceOpen, setSourceOpen] = useState(false);

  // Book a visit reveal
  const [bookOpen, setBookOpen] = useState(false);
  const [jobDesc, setJobDesc] = useState("");
  const [visitPurpose, setVisitPurpose] = useState<VisitPurpose>(null);
  const [serviceAddr, setServiceAddr] = useState("");

  // More details reveal
  const [moreOpen, setMoreOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [customFields, setCustomFields] = useState<{ label: string; value: string }[]>([]);
  const [cfLabel, setCfLabel] = useState("");
  const [cfValue, setCfValue] = useState("");
  const [showAddField, setShowAddField] = useState(false);

  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setPhone("");
    setIsBiz(false);
    setBizName("");
    setSource("");
    setSourceOpen(false);
    setBookOpen(false);
    setJobDesc("");
    setVisitPurpose(null);
    setServiceAddr("");
    setMoreOpen(false);
    setEmail("");
    setNotes("");
    setCustomFields([]);
    setCfLabel("");
    setCfValue("");
    setShowAddField(false);
    setError(null);
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

  /** Create a job for the new lead (mirrors the New job modal's createJob). */
  function createJobForLead(lead: Lead): Job {
    return addJob({
      leadId: lead.id,
      svc: "service",
      origin: "manual",
      title: jobDesc.trim() || lead.name,
      addr: serviceAddr.trim() || lead.address || "",
      phone: phone.trim(),
      status: "unscheduled",
      archived: false,
      lines: [],
      addons: [],
      photos: [],
      notes: notes.trim(),
      acts: [],
      visits: [],
    });
  }

  /** Validate + create the lead (and a Job when the purpose is "job").
   *  Returns the created Job so "Build the price" can hand off to the builder. */
  /** Business path: link (or create) the company — a typed business name is never
   *  silently dropped (prototype saveQuickAdd). Case-insensitive bidirectional
   *  match ("Crestview" ↔ "Crestview Property Mgmt"), create-if-missing. */
  function resolveCompanyId(): number | undefined {
    if (!isBiz) return undefined;
    const nm = bizName.trim() || name.trim();
    if (!nm) return undefined;
    const k = nm.toLowerCase();
    const match = companies.find((c) => {
      const cn = c.name.toLowerCase();
      return cn.includes(k) || k.includes(cn);
    });
    return (match ?? addCompany(nm)).id;
  }

  function commit(): { ok: boolean; job: Job | null } {
    if (!name.trim()) {
      setError("Name is required.");
      return { ok: false, job: null };
    }
    const companyId = resolveCompanyId();
    const lead = addLead({
      name: name.trim(),
      phone: phone.trim(),
      job: jobDesc.trim() || "New customer",
      source: source || "Direct",
      stage: "New customer",
      email: email.trim() || undefined,
      address: serviceAddr.trim() || undefined,
      companyId,
      role: companyId != null ? "Contact" : undefined,
      notes: notes.trim() || undefined,
      custom: customFields.length
        ? Object.fromEntries(customFields.map((f) => [f.label, f.value]))
        : undefined,
    });
    const job = visitPurpose === "job" ? createJobForLead(lead) : null;
    return { ok: true, job };
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!commit().ok) return;
    reset();
    close();
  }

  /** "✦ Build the price →" — create the customer + job, then open the same
   *  price builder the crew uses (prototype saveNewJob(true) → jobBuildPrice). */
  function handleBuildPrice() {
    const { ok, job } = commit();
    if (!ok) return;
    reset();
    close();
    if (job) openModal(MODAL.PRICE_BUILDER, { jobId: job.id });
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

        {/* 3. Customer type chip toggle */}
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

        {/* 4. Business name — hidden when Person */}
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

        {/* 5. Lead source — full-width field-style dropdown (prototype qa-srcbtn) */}
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
              {SOURCES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`qa-srcopt${source === s ? " on" : ""}`}
                  onClick={() => selectSource(s)}
                >
                  <span>{s}</span>
                  {source === s ? <span className="qa-srcok">✓</span> : null}
                </button>
              ))}
              <button
                type="button"
                className="qa-srcopt add"
                onClick={() => {
                  const custom = prompt("New source name:");
                  if (custom?.trim()) selectSource(custom.trim());
                }}
              >
                + Add a new source…
              </button>
            </div>
          )}
        </div>

        {/* 6. Book a visit reveal */}
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

        {/* 7. More details reveal */}
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

        {/* 8. Footer */}
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost" onClick={handleClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary">
            {submitLabel()}
          </button>
        </div>
      </form>
    </Modal>
  );
}
