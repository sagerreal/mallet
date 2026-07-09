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

  function handleDelete() {
    if (!confirm(`Delete ${lead.name}? This cannot be undone.`)) return;
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
      <div className={`reveal${open ? " open" : ""}`} style={{ marginBottom: 20 }}>
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
          <div className="field">
            <label>Email</label>
            <input
              key={lead.email ?? ""}
              type="email"
              placeholder="customer@email.com"
              defaultValue={lead.email ?? ""}
              onBlur={(e) => updateLead(lead.id, { email: e.target.value })}
            />
          </div>

          {/* Business / company */}
          <div className="field">
            <label>Business</label>
            <input
              type="text"
              placeholder="Company name (if applicable)"
              defaultValue=""
            />
          </div>

          {/* Membership pill (if applicable) */}
          {lead.card && (
            <div style={{ marginBottom: 10 }}>
              <span className="pill green">
                {lead.card.brand} ···{lead.card.last4} — on file via {lead.card.via}
              </span>
            </div>
          )}

          {/* Custom fields */}
          {customFields.map((f) => (
            <div className="field" key={f.key}>
              <label>{f.label}</label>
              <input
                type="text"
                value={f.value}
                onChange={(e) => updateCustomField(f.key, e.target.value)}
                placeholder={f.label}
              />
            </div>
          ))}

          {/* Add custom field */}
          {showAddField ? (
            <div className="cfrow" style={{ marginTop: 4 }}>
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
              style={{ fontSize: 12, marginTop: 4 }}
              onClick={() => setShowAddField(true)}
            >
              + Add a custom field
            </button>
          )}
        </div>
      </div>

      {/* Footer — both "get rid of it" paths grouped on the LEFT, away from the
          bottom-right corner where the eye expects a confirm/primary action.
          Clean up (Lost/Archive, reversible) is the button; Delete (permanent)
          is a de-emphasized red link beside it. */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, paddingTop: 8, borderTop: "1px solid var(--line-2)" }}>
        <button
          className="btn ghost sm"
          onClick={() => openModal(MODAL.CLEAN_UP, { leadId: lead.id })}
        >
          Clean up — mark Lost or Archive
        </button>
        <span
          className="linklike"
          role="button"
          style={{ color: "var(--red)", fontSize: 12.5, cursor: "pointer" }}
          onClick={handleDelete}
        >
          Delete
        </span>
      </div>
    </>
  );
}
