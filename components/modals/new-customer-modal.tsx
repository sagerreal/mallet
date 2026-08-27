/**
 * components/modals/new-customer-modal.tsx
 * Faithful port of prototype ovQuick / openQuickAdd (lines 1106-1143).
 * Field order: Name, Phone (with dup-hint), Service address (autocomplete), Customer type
 * (Person/Biz chip toggle), Business name (hidden when Person), Tags, More details, footer.
 * NO subtitle. Button label: "Add customer", always.
 *
 * IT CREATES A CUSTOMER AND NOTHING ELSE. A "Book a visit" reveal used to sit between Tags and
 * More details, carrying a job description, a yes/no booking and "✦ Build the price →" — so this
 * one form could mint a customer, a job, an unplaced visit and a composer hand-off. All of it is
 * gone: intake is intake. Jobs are booked from the job surfaces and priced from the composer,
 * where a schedule and a price actually live.
 *
 * Sheet frame (#253 grammar): sticky .sheet-head holds the title; the terminal
 * create is THE .sheet-pri docked in a sticky .sheet-foot with Cancel quiet
 * beside it. The foot lives inside the <form> so type="submit" keeps working —
 * the form spans the whole sheet, so the sticky maths are unchanged.
 */

"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Modal } from "./modal";
import { useCloseModal, useOpenModal, useActiveModal, useAppStore } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { api, type RouterOutputs } from "@/lib/trpc/client";
import { AddressInput } from "@/components/ui/address-input";
import { DisclosureRow } from "@/components/ui/disclosure-row";
import { TagPicker } from "@/features/customers/tag-picker";
import { Field } from "@/components/ui/input";
import { phoneFieldError } from "@/lib/phone";
import { userMessage } from "@/lib/trpc/error-map";
import { StagedAttachControl, useStagedAttachment, attachErrorMessage } from "@/components/shared/staged-attachment";
import { uploadLeadNoteFile } from "@/lib/store/upload-lead-note-file";

/** The staged (below-the-essentials) rows — one open at a time. */
type RowKey = "type" | "tags" | "more";

/** Clip a collapsed-row summary to the row word budget. */
function clip(s: string, max = 28): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** The create mutation's success payload (leadDTO + the dedup `created` flag). */
type CreatedCustomer = RouterOutputs["v1"]["customers"]["create"];

export function NewCustomerModal({ open, instant }: { open: boolean; instant?: boolean }) {
  const close = useCloseModal();
  const openModal = useOpenModal();
  const activeModal = useActiveModal();
  const companies = useAppStore((s) => s.companies);
  const addCompany = useAppStore((s) => s.addCompany);
  const addLeadNote = useAppStore((s) => s.addLeadNote);

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

  // Tag picker state. A SET — the office files one customer under several labels.
  const [tags, setTags] = useState<readonly string[]>([]);

  // More details row
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const staged = useStagedAttachment();
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
    setTags([]);
    setOpenRow(null);
    setEmail("");
    setNotes("");
    staged.clear();
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
      // Omitted when empty so the create input carries no key rather than an empty array —
      // the column default already writes the empty set.
      tags: tags.length > 0 ? [...tags] : undefined,
      companyId: companyId ?? undefined,
      // Prototype default: contacts linked to a company carry role "Contact".
      role: companyId != null ? "Contact" : undefined,
      // WITH A FILE, THE SENTENCE GOES ON THE NOTE, not here. A note carries one attachment
      // (#574) and the point of that is that a photo and the words explaining it stay one entry;
      // writing the text to `leads.notes` as well would show it twice in the customer's trail.
      notes: staged.file ? undefined : notes.trim() || undefined,
      address: address.trim() || undefined,
    };
  }

  /**
   * Create-success handler: dedup guard → refresh → close.
   *
   * A dedup hit (data.created === false) surfaces the existing record instead of closing
   * silently, which would leave the user wondering why nothing appeared.
   *
   * This modal creates a CUSTOMER and nothing else. It used to also book a visit and offer
   * "✦ Build the price →" from the same submit; both went with the Book-a-visit row. Work is
   * created from the job and quote surfaces, which is where a schedule and a price live.
   */
  async function handleCreated(data: CreatedCustomer): Promise<void> {
    if (!data.created) {
      // A dedup hit is someone else's record — do NOT hang this file or note on it.
      setDedupLeadId(data.id);
      return;
    }
    if (staged.file && !(await attachStagedNote(data.id))) {
      // The customer IS saved; only the attachment failed. Refresh the list so they appear, and
      // keep the modal open with the reason — closing here would lose the file silently and leave
      // the office believing it went with them.
      utils.v1.customers.invalidate();
      return;
    }
    utils.v1.customers.invalidate();
    reset();
    close();
  }

  /**
   * Upload the staged file against the now-real lead id and write the note that points at it.
   * Returns false when it failed, with the reason already on screen.
   */
  async function attachStagedNote(leadId: string): Promise<boolean> {
    const file = staged.file;
    if (!file) return true;
    try {
      const att = await uploadLeadNoteFile(leadId, file);
      addLeadNote(leadId, {
        type: "note",
        when: "Just now",
        // Absent rather than "" when the note is only a file, so the collapsed row keeps showing
        // the last sentence anybody actually wrote.
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        att,
      });
      return true;
    } catch (err: unknown) {
      staged.setError(attachErrorMessage(err));
      return false;
    }
  }

  /**
   * The "Add customer" submit. One create per click: inFlightRef rejects re-entry synchronously,
   * and the submission id drops responses that land after the form was reset (see the ref
   * comments above).
   */
  async function submitCreate(): Promise<void> {
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
      await handleCreated(data);
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
    void submitCreate();
  }

  function handleOpenExisting() {
    if (!dedupLeadId) return;
    const id = dedupLeadId;
    reset();
    close();
    openModal(MODAL.LEAD, { leadId: id });
  }

  function addCustomField() {
    const label = cfLabel.trim();
    if (!label) return;
    setCustomFields((prev) => [...prev, { label, value: cfValue.trim() }]);
    setCfLabel("");
    setCfValue("");
    setShowAddField(false);
  }

  // ---- collapsed row summaries (the value IS the state) ---------------------
  const typeSummary = isBiz
    ? bizName.trim()
      ? `Business · ${clip(bizName)}`
      : "Business"
    : "Person";
  const tagsSummary = tags.length > 0 ? clip(tags.join(", ")) : "Add";
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
    <Modal open={open} onClose={handleClose} instant={instant}>
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
        <div className="fdd-group" style={{ margin: "var(--space-4) 0 var(--space-5)" }}>
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
            label="Tags"
            value={tagsSummary}
            open={openRow === "tags"}
            onToggle={() => toggleRow("tags")}
          >
            {/* The same picker the existing-customer modal uses, so the list behaves identically
                wherever tags are applied — including adding and removing while standing in it.

                The row deliberately stays OPEN after a pick. Its single-select ancestor collapsed
                on choose, which was right when there was one answer and is wrong now: the second
                tag is the common case, and re-opening the row for it is a step for nothing. */}
            <TagPicker value={tags} onChange={setTags} />
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
            <Field label="Notes" style={{ marginBottom: "var(--space-2)" }}>
              <input
                type="text"
                placeholder="gate code, best time to call…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
            {/* The file is only STAGED here. Its upload URL is scoped to a lead id that does not
                exist until this form is submitted, so the bytes go up in handleCreated and the
                note that points at them is written there too. */}
            <StagedAttachControl staged={staged} busy={busy} />

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
            {busy ? "Saving…" : "Add customer"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
