/**
 * components/modals/lead-modal/more-details.tsx
 * Faithful port of prototype "More details" reveal + footer.
 * .reveal collapsible: Email + Service address inputs, Business input,
 * custom fields, + Add custom field.
 * Footer: "Clean up — mark Lost or Archive" (ghost, left) + "Delete" (red, right).
 */

"use client";

import { useState } from "react";
import type { Lead } from "@/lib/store/types";
import { useAppStore, useOpenModal, useCloseModal } from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { Field } from "@/components/ui/input";

interface MoreDetailsProps {
  lead: Lead;
}

interface CustomField {
  key: string;
  label: string;
  value: string;
}

export function MoreDetails({ lead }: MoreDetailsProps) {
  const updateLead = useAppStore((s) => s.updateLead);
  const deleteLead = useAppStore((s) => s.deleteLead);
  const openModal = useOpenModal();
  const closeModal = useCloseModal();

  const [open, setOpen] = useState(false);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [showAddField, setShowAddField] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);

  // "Delete" here ARCHIVES the customer (deleteLead → archiveLead, a soft-delete): they're
  // recoverable from the Archived filter, never hard-deleted. Two-step arm-then-confirm (matches the
  // job modal) instead of a native browser dialog, with copy that tells the truth about what happens.
  function handleDelete() {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    deleteLead(lead.id);
    closeModal();
  }

  function addCustomField() {
    const label = newFieldLabel.trim();
    if (!label) return;
    setCustomFields((prev) => [
      ...prev,
      { key: `cf-${Date.now()}`, label, value: "" },
    ]);
    setNewFieldLabel("");
    setShowAddField(false);
  }

  function updateCustomField(key: string, value: string) {
    setCustomFields((prev) =>
      prev.map((f) => (f.key === key ? { ...f, value } : f))
    );
  }

  return (
    <>
      {/* More details reveal */}
      <div className={`reveal${open ? " open" : ""}`} style={{ marginBottom: "var(--space-5)" }}>
        <div
          className="reveal-head"
          onClick={() => setOpen((o) => !o)}
          role="button"
          aria-expanded={open}
        >
          <span className="caret">&#9658;</span>
          More details — email, business
        </div>
        <div className="reveal-body">
          {/* Email (service address now lives up top in the header) */}
          <Field label="Email">
            <input
              key={lead.email ?? ""}
              type="email"
              placeholder="customer@email.com"
              defaultValue={lead.email ?? ""}
              onBlur={(e) => updateLead(lead.id, { email: e.target.value })}
            />
          </Field>

          {/* Business / company */}
          <Field label="Business">
            <input
              type="text"
              placeholder="Company name (if applicable)"
              defaultValue=""
            />
          </Field>

          {/* Membership pill (if applicable) */}
          {lead.card && (
            <div style={{ marginBottom: "var(--space-3)" }}>
              <span className="pill green">
                {lead.card.brand} ···{lead.card.last4} — on file via {lead.card.via}
              </span>
            </div>
          )}

          {/* Custom fields */}
          {/* Field uses useId(), so one per row inside a .map() is safe. */}
          {customFields.map((f) => (
            <Field label={f.label} key={f.key}>
              <input
                type="text"
                value={f.value}
                onChange={(e) => updateCustomField(f.key, e.target.value)}
                placeholder={f.label}
              />
            </Field>
          ))}

          {/* Add custom field */}
          {showAddField ? (
            <div className="cfrow" style={{ marginTop: "var(--space-1)" }}>
              <input
                type="text"
                placeholder="Field name"
                value={newFieldLabel}
                onChange={(e) => setNewFieldLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addCustomField();
                  if (e.key === "Escape") {
                    setShowAddField(false);
                    setNewFieldLabel("");
                  }
                }}
                autoFocus
              />
              <button
                className="btn sm primary"
                onClick={addCustomField}
                disabled={!newFieldLabel.trim()}
              >
                Add
              </button>
            </div>
          ) : (
            <button
              className="btn ghost sm"
              style={{ fontSize: "var(--type-sm)", marginTop: "var(--space-1)" }}
              onClick={() => setShowAddField(true)}
            >
              + Add a custom field
            </button>
          )}
        </div>
      </div>

      {/* Footer — both "get rid of it" paths grouped on the LEFT, away from the
          bottom-right corner where the eye expects a confirm/primary action.
          "Clean up" opens the Lost/Archive picker; "Delete" is a de-emphasized red
          link that ARCHIVES (soft-delete, recoverable) after a two-step confirm. */}
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-4)", paddingTop: "var(--space-2)", borderTop: "1px solid var(--line-2)" }}>
        <button
          className="btn ghost sm"
          onClick={() => openModal(MODAL.CLEAN_UP, { leadId: lead.id })}
        >
          Clean up — mark Lost or Archive
        </button>
        {/* Same shape and size as "Clean up" beside it — one grammar for the two
            get-rid-of-it paths, with red carrying the difference in meaning. It was a
            <span role="button"> styled as bare red text next to a bordered button, so
            two destructive actions read as two unrelated kinds of thing, and the
            keyboard handling had to be hand-rolled. A real <button> gets Enter/Space,
            focus and disabled semantics for free. */}
        <button
          type="button"
          className="btn ghost sm"
          aria-label={deleteArmed ? `Confirm — archive ${lead.name}` : `Delete ${lead.name}`}
          style={{ color: "var(--red)", fontWeight: deleteArmed ? 700 : undefined }}
          onClick={handleDelete}
        >
          {deleteArmed ? "Confirm — archives, recoverable" : "Delete"}
        </button>
      </div>
    </>
  );
}
