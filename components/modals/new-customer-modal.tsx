/**
 * components/modals/new-customer-modal.tsx
 * Faithful port of prototype ovQuick / openQuickAdd (lines 1106-1143).
 * Exact field order: Name, Phone (with dup-hint), Service address (autocomplete),
 * Customer type (Person/Biz chip toggle), Business name (hidden when Person), Lead source (chip dropdown),
 * Book a visit reveal, More details reveal, footer.
 * NO subtitle. Button label: "Add customer" → "Create job" / "Create estimate visit".
 *
 * Sheet frame (#253 grammar): sticky .sheet-head holds the title; the terminal
 * create is THE .sheet-pri docked in a sticky .sheet-foot with Cancel quiet
 * beside it. The foot lives inside the <form> so type="submit" keeps working —
 * the form spans the whole sheet, so the sticky maths are unchanged.
 */

"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "./modal";
import { useCloseModal, useOpenModal, useActiveModal, useAppStore } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { api, type RouterOutputs } from "@/lib/trpc/client";
import { AddressInput } from "@/components/ui/address-input";
import { DisclosureRow } from "@/components/ui/disclosure-row";
import { DEFAULT_SOURCES, mergeSources } from "@/features/customers/merge-sources";
import { toStoreLead } from "@/features/customers/leads-hydrator";
import { Field, FieldGroup } from "@/components/ui/input";
import { phoneFieldError } from "@/lib/phone";
import { userMessage } from "@/lib/trpc/error-map";

/**
 * Book a visit alongside the new customer, or not. ONE booking shape — an unpriced job
 * (kind "estimate": someone goes out, the price comes after) — because the Job/Estimate
 * fork is gone everywhere: kind derives from whether a price is committed, and nothing
 * in this modal commits one. The priced path from here is "✦ Build the price →", which
 * deliberately goes to the COMPOSER (customer alone + a quote; the job is born when the
 * quote is accepted).
 */
type VisitPurpose = "book" | null;

/** The staged (below-the-essentials) rows — one open at a time. */
type RowKey = "type" | "source" | "book" | "more";

/** Clip a collapsed-row summary to the row word budget. */
function clip(s: string, max = 28): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** The create mutation's success payload (leadDTO + the dedup `created` flag). */
type CreatedCustomer = RouterOutputs["v1"]["customers"]["create"];

/** Default estimate-visit length in hours (mirrors new-job-modal's NJ_HOURS.estimate). */
const ESTIMATE_VISIT_HOURS = 0.5;

export function NewCustomerModal({ open }: { open: boolean }) {
  const router = useRouter();
  const close = useCloseModal();
  const openModal = useOpenModal();
  const activeModal = useActiveModal();
  const addJob = useAppStore((s) => s.addJob);
  const addVisit = useAppStore((s) => s.addVisit);
  const adoptLead = useAppStore((s) => s.adoptLead);
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
  // Released the moment the phone is edited (see the phone input's onChange) —
  // the notice describes a submission that no longer exists once the number changes.
  const [dedupLeadId, setDedupLeadId] = useState<string | null>(null);

  // Render-visible mirror of inFlightRef, spanning the WHOLE submit (customer
  // create + any booked-work persist). createMutation.isPending only covers the
  // first round trip, so the buttons read idle during the job persist — this
  // keeps them in their pending state until the flow actually finishes.
  const [submitting, setSubmitting] = useState(false);

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

  // The staged rows (list-first accordion): one open at a time, front-desk
  // RuleRow precedent. The collapsed value is the summary.
  const [openRow, setOpenRow] = useState<RowKey | null>(null);
  const toggleRow = (k: RowKey) => setOpenRow((prev) => (prev === k ? null : k));

  // Source picker state
  const [source, setSource] = useState<string>("");
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSourceValue, setNewSourceValue] = useState("");

  // Book a visit row
  const [jobDesc, setJobDesc] = useState("");
  const [visitPurpose, setVisitPurpose] = useState<VisitPurpose>(null);

  // More details row
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [address, setAddress] = useState("");
  const [customFields, setCustomFields] = useState<{ label: string; value: string }[]>([]);
  const [cfLabel, setCfLabel] = useState("");
  const [cfValue, setCfValue] = useState("");
  const [showAddField, setShowAddField] = useState(false);

  const [error, setError] = useState<string | null>(null);
  // Inline, field-level error — set before any network round trip so a bad
  // number never reaches the server just to learn it's bad.
  const [phoneError, setPhoneError] = useState<string | null>(null);

  function reset() {
    // Invalidate any in-flight create's late response (see submitSeqRef above).
    submitSeqRef.current += 1;
    setName("");
    setPhone("");
    setIsBiz(false);
    setBizName("");
    setSource("");
    setOpenRow(null);
    setShowAddSource(false);
    setNewSourceValue("");
    setJobDesc("");
    setVisitPurpose(null);
    setEmail("");
    setNotes("");
    setAddress("");
    setCustomFields([]);
    setCfLabel("");
    setCfValue("");
    setShowAddField(false);
    setError(null);
    setPhoneError(null);
    setDedupLeadId(null);
  }

  function handleClose() {
    reset();
    close();
  }

  // Button label
  function submitLabel(): string {
    if (visitPurpose === "book") return "Create job";
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
   * Create the booked visit for a just-created customer — the submit button's
   * "Create job" path. ONE shape: an unpriced job (kind "estimate") with an
   * unplaced visit — a REAL job, never a client-store-only evisit (those were
   * gone on refresh and invisible to the schedule window / crew-load / conflict
   * checks). Returns false when the job persist failed: the error is surfaced
   * and the modal must stay open (no silent failures on interactive paths).
   */
  async function createBookedWork(data: CreatedCustomer): Promise<boolean> {
    if (visitPurpose !== "book") return true;
    // addJob returns { job, persisted }; the lead (data.id) is already
    // persisted by createMutation, so addJob fires v1.jobs.create immediately.
    const { job: created, persisted } = addJob({
      leadId: data.id,
      kind: "estimate",
      svc: "",
      origin: "manual",
      title: jobDesc.trim() || data.name,
      // The single top-level Service address IS the job site (one-off ICP:
      // customer address == job site). Mirrors new-job-modal's addr fallback.
      addr: address.trim() || "",
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
    } catch (err) {
      setError(userMessage(err, "The customer was saved, but the job wasn't — check your connection and try again."));
      return false;
    }
    // Unplaced, at the unpriced default length — dragged onto the Schedule later.
    // addVisit only persists once the job is DB-origin, so it runs after the reconcile.
    addVisit(created.id, ESTIMATE_VISIT_HOURS);
    return true;
  }

  /**
   * Shared create-success handler: dedup guard → booked work → refresh/close.
   * A dedup hit (data.created === false) surfaces the existing record and MUST
   * NOT create work — a job would attach to someone else's customer.
   *
   * toComposer ("✦ Build the price →") is a quoting intent, not a booking:
   * the customer is created ALONE and the office lands in the composer — the
   * job is born when the quote is ACCEPTED (CreateJobFromEstimateUseCase),
   * exactly like every other composer quote. Nothing unpriced reaches the
   * board if pricing is abandoned. This modal books no schedule (its jobs are
   * created unscheduled with an unplaced visit), so skipping the job here can
   * never drop a chosen time — booked work stays on the "Create job" submit.
   * If a schedule picker is ever added, a picked time must go back through
   * createBookedWork.
   */
  async function handleCreated(data: CreatedCustomer, toComposer: boolean): Promise<void> {
    if (!data.created) {
      // Dedup hit — the phone matched an existing customer. Surface it instead of
      // silently closing, which would leave the user wondering why nothing appeared.
      setDedupLeadId(data.id);
      return;
    }
    if (toComposer) {
      // Adopt the persisted lead into the store (no network re-write) so the
      // composer's customer selector resolves it the moment the route lands.
      adoptLead(toStoreLead(data));
      utils.v1.customers.invalidate();
      // Carry the typed job description into the composer's describe-the-job
      // lane; captured before reset() for clarity (reset clears the field).
      const desc = jobDesc.trim();
      reset();
      close();
      router.push(
        desc
          ? `/composer?lead=${data.id}&desc=${encodeURIComponent(desc)}`
          : `/composer?lead=${data.id}`,
      );
      return;
    }
    const ok = await createBookedWork(data);
    if (!ok) {
      // The customer row persisted even though the job didn't — refresh the
      // list so it shows up; the error keeps the modal open for a retry.
      utils.v1.customers.invalidate();
      return;
    }
    // Always refresh the customers list. The old "look"-path skip existed to protect a
    // store-local evisit from the refetch — evisits are long dead (bookings are REAL
    // jobs), so the guard only left the list stale.
    utils.v1.customers.invalidate();
    reset();
    close();
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
    // Client-side mirror of the server's Phone.parse rule — catch a bad number
    // here, before it round-trips to the server just to bounce with a
    // misleading "check your connection" message.
    const badPhone = phoneFieldError(phone);
    if (badPhone) { setPhoneError(badPhone); return; }

    inFlightRef.current = true;
    setSubmitting(true);
    const submission = submitSeqRef.current;
    try {
      const resolved = resolveCompany();
      // Await company persistence before inserting the lead to avoid FK race.
      if (resolved?.persisted) {
        try {
          await resolved.persisted;
        } catch (err) {
          setError(userMessage(err, "Couldn't save the business — check your connection and try again."));
          return;
        }
      }
      if (submission !== submitSeqRef.current) return; // form reset mid-flight
      const data = await createMutation.mutateAsync(buildCreateInput(resolved?.companyId));
      if (submission !== submitSeqRef.current) return; // stale response — drop it
      await handleCreated(data, openBuilder);
    } catch (err) {
      if (submission === submitSeqRef.current) {
        setError(userMessage(err, "Couldn't save the customer — check your connection and try again."));
      }
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
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

  /**
   * "✦ Build the price →" — create the CUSTOMER only, then hand off to the
   * composer (?lead=, plus ?desc= when a job description was typed). The job
   * is created when the quote is accepted, never before (see handleCreated).
   */
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
    // Picking a source completes the row — collapse it back to its summary.
    setOpenRow(null);
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

  // ---- collapsed row summaries (the value IS the state) ---------------------
  const typeSummary = isBiz
    ? bizName.trim()
      ? `Business · ${clip(bizName)}`
      : "Business"
    : "Person";
  const bookSummary =
    visitPurpose === null ? "No" : `Visit${jobDesc.trim() ? ` · ${clip(jobDesc)}` : ""}`;
  const moreParts = [
    email.trim() ? "email" : null,
    notes.trim() ? "notes" : null,
    customFields.length > 0 ? `${customFields.length} custom` : null,
  ].filter(Boolean);
  const moreSummary = moreParts.length ? moreParts.join(" · ") : "Add";

  // The create buttons key off the FULL flight (customer create + booked-work
  // persist), not just the mutation's own round trip — see `submitting` above.
  const busy = submitting || createMutation.isPending;

  return (
    <Modal open={open} onClose={handleClose}>
      {/* Sticky sheet header — the shell renders the ✕; .sheet-head's own
          padding clears it. NO subtitle — prototype has none. */}
      <div className="sheet-head">
        <h2>New customer</h2>
      </div>

      <form onSubmit={handleSubmit}>
        {/* 1. Name */}
        <Field label="Name">
          <input
            type="text"
            placeholder="Full name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>

        {/* 2. Phone + dup-hint */}
        <Field label="Phone">
          <input
            type="tel"
            placeholder="(925) 555-0123"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              if (phoneError) setPhoneError(null);
              // A dedup notice belongs to the phone that was SUBMITTED — once
              // the number changes, that submission no longer exists, so the
              // notice clears and the submit buttons unlock.
              if (dedupLeadId) setDedupLeadId(null);
            }}
          />
          {phoneError && (
            <p style={{ color: "var(--red)", fontSize: "var(--type-sm)", margin: "var(--space-1) 0 0" }}>
              {phoneError}
            </p>
          )}
          <div className="muted" id="qaDupHint" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-1)" }} />
        </Field>

        {/* 3. Service address — right under Phone; field service lives or dies on it */}
        {/* The aria-label is gone on purpose: it outranks a label element in the
            accessible-name computation, so keeping it would have made the newly
            associated <label> dead weight and left getByLabelText unable to
            resolve the control. */}
        <Field label="Service address">
          <AddressInput
            value={address}
            onChange={setAddress}
            placeholder="123 Main St, Oakland CA 94601"
          />
        </Field>

        {/* 4-7. The staged details — a definition list of disclosure rows
            (front-desk RuleRow pattern): label · current value, one editor open
            at a time, everything in-flow. The three fields above are the whole
            90% intake; these rows are the "one level down". */}
        <div style={{ borderTop: "1px solid var(--line-2)", margin: "var(--space-2) 0 var(--space-5)" }}>
          <DisclosureRow
            label="Customer type"
            value={typeSummary}
            open={openRow === "type"}
            onToggle={() => toggleRow("type")}
          >
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
            {isBiz && (
              <Field label="Business name" style={{ margin: "var(--space-3) 0 0" }}>
                <input
                  type="text"
                  placeholder="Crestview Property Mgmt"
                  value={bizName}
                  onChange={(e) => setBizName(e.target.value)}
                />
              </Field>
            )}
          </DisclosureRow>

          <DisclosureRow
            label="Lead source"
            value={source || "Add"}
            open={openRow === "source"}
            onToggle={() => toggleRow("source")}
          >
            <div className="qa-srclist" style={{ marginTop: "0" }}>
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
                <div className="cfrow" style={{ padding: "var(--space-2) var(--space-3)" }}>
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
          </DisclosureRow>

          <DisclosureRow
            label="Book a visit"
            value={bookSummary}
            open={openRow === "book"}
            onToggle={() => toggleRow("book")}
          >
            {/* Job description */}
            <Field label="Job">
              <input
                type="text"
                placeholder="water heater making noise"
                value={jobDesc}
                onChange={(e) => setJobDesc(e.target.value)}
              />
            </Field>

            {/* ONE yes/no, no Job/Estimate fork — the booking is an unpriced job either
                way (kind derives from the price, and nothing in this modal commits one;
                pricing from here is "✦ Build the price →", the composer's quote). */}
            <div className="chips" style={{ marginBottom: "0" }}>
              <button
                type="button"
                className={`chip${visitPurpose === null ? " sel" : ""}`}
                onClick={() => setVisitPurpose(null)}
                aria-pressed={visitPurpose === null}
              >
                No
              </button>
              <button
                type="button"
                className={`chip${visitPurpose === "book" ? " sel" : ""}`}
                onClick={() => setVisitPurpose("book")}
                aria-pressed={visitPurpose === "book"}
              >
                Yes — book a visit
              </button>
            </div>

            {/* Conditional book panel — the job uses the single top-level
                Service address, so there is no second address field here.

                A caption over a button, not a form field: the button names itself
                ("Build the price"), so htmlFor would name it twice and say nothing
                about the hint beneath. The caption names a group instead. */}
            {visitPurpose === "book" && (
              <FieldGroup
                label="Price"
                style={{ margin: "var(--space-4) 0 0" }}
                hint={
                  <span
                    className="muted"
                    style={{ fontWeight: 500, textTransform: "none", letterSpacing: 0 }}
                  >
                    (optional)
                  </span>
                }
              >
                <button
                  type="button"
                  className="btn"
                  style={{ width: "100%", justifyContent: "center" }}
                  onClick={handleBuildPrice}
                  disabled={busy || Boolean(dedupLeadId)}
                >
                  {busy ? "Creating…" : "✦ Build the price →"}
                </button>
                <div className="muted" style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-2)" }}>
                  Same builder your crew uses — or price later.
                </div>
              </FieldGroup>
            )}
          </DisclosureRow>

          <DisclosureRow
            label="More details"
            value={moreSummary}
            open={openRow === "more"}
            onToggle={() => toggleRow("more")}
          >
            <Field label="Email">
              <input
                type="email"
                placeholder="otherwise asked at first quote"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Notes">
              <input
                type="text"
                placeholder="gate code, best time to call…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>

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
                style={{ fontSize: "var(--type-sm)" }}
                onClick={() => setShowAddField(true)}
              >
                + Add a custom field
              </button>
            )}
          </DisclosureRow>
        </div>

        {error && (
          <p style={{ color: "var(--red)", fontSize: "var(--type-base)", margin: "0 0 var(--space-3)" }}>{error}</p>
        )}

        {/* Dedup notice — shown when the submitted phone already belongs to an existing customer */}
        {dedupLeadId && (
          <div style={{
            background: "var(--surface-2, #f5f5f5)",
            border: "1px solid var(--border, #e0e0e0)",
            borderRadius: "var(--radius-sm)",
            padding: "var(--space-3) var(--space-4)",
            marginBottom: "var(--space-3)",
            fontSize: "var(--type-base)",
          }}>
            <p style={{ margin: "0 0 var(--space-2)", color: "var(--text-1, #111)" }}>
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

        {/* 9. Sticky foot — ONE filled primary (the terminal create), Cancel
            quiet beside it. Stays inside the form so type="submit" keeps
            submit-on-Enter and the shared submit path intact. Two-button foot
            (#362): `.sheet-pri` is width:100% at the class level, so beside
            Cancel it takes flex:1 / width:auto and Cancel keeps its intrinsic
            width — otherwise the flex line is over-constrained and the primary
            crushes into Cancel. */}
        <div className="sheet-foot" style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
          <button
            type="button"
            className="btn ghost"
            style={{ flexShrink: 0, minHeight: 44 }}
            onClick={handleClose}
            disabled={createMutation.isPending}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="sheet-pri"
            style={{ flex: 1, width: "auto" }}
            disabled={busy || Boolean(dedupLeadId)}
          >
            {busy ? "Saving…" : submitLabel()}
          </button>
        </div>
      </form>
    </Modal>
  );
}
