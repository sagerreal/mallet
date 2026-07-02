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
          More details — email, address, business
        </div>
        <div className="reveal-body">
          {/* 2-col grid: Email + Service address */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "0 14px",
            }}
          >
            <div className="field">
              <label>Email</label>
              <input
                type="email"
                placeholder="customer@email.com"
                defaultValue={lead.email ?? ""}
                onBlur={(e) => updateLead(lead.id, { email: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Service address</label>
              <input
                type="text"
                placeholder="123 Main St, City"
                defaultValue={lead.address ?? ""}
                onBlur={(e) => updateLead(lead.id, { address: e.target.value })}
              />
            </div>
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

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 8, borderTop: "1px solid var(--line-2)" }}>
        <button
          className="btn ghost sm"
          onClick={() => openModal(MODAL.CLEAN_UP, { leadId: lead.id })}
        >
          Clean up — mark Lost or Archive
        </button>
        <button
          className="btn sm"
          style={{ color: "var(--red)", borderColor: "var(--red)" }}
          onClick={handleDelete}
        >
          Delete
        </button>
      </div>
    </>
  );
}
