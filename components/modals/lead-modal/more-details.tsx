/**
 * components/modals/lead-modal/more-details.tsx
 * Two accordion bodies for the sheet:
 *   DetailsBody — email, business, custom fields (+ add custom field)
 *   CleanUpBody — mark Lost / archive (opens the Clean-up picker) and Delete
 *                 (two-step, ARCHIVES — recoverable), the only red on the sheet.
 * The reveal chrome and the footer are gone; SheetRow owns the disclosure now.
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

export function DetailsBody({ lead }: MoreDetailsProps) {
  const updateLead = useAppStore((s) => s.updateLead);
  const companies = useAppStore((s) => s.companies);
  const addCompany = useAppStore((s) => s.addCompany);

  // Custom fields are PERSISTED on the lead (custom_fields jsonb) — they used to be
  // component state and vanished on close (Owen: "the custom field I added isn't saving").
  const persisted: CustomField[] = (lead.customFields ?? []).map((f, i) => ({ key: `cf-${i}`, label: f.label, value: f.value }));
  const [showAddField, setShowAddField] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");

  function persistFields(fields: CustomField[]) {
    void updateLead(lead.id, { customFields: fields.map((f) => ({ label: f.label, value: f.value })) });
  }

  function addCustomField() {
    const label = newFieldLabel.trim();
    if (!label) return;
    persistFields([...persisted, { key: `cf-${persisted.length}`, label, value: "" }]);
    setNewFieldLabel("");
    setShowAddField(false);
  }

  function commitCustomField(key: string, value: string) {
    persistFields(persisted.map((f) => (f.key === key ? { ...f, value } : f)));
  }

  function removeCustomField(key: string) {
    persistFields(persisted.filter((f) => f.key !== key));
  }

  // Business = the lead's linked company. Committing a name finds-or-creates the
  // company and links it; clearing unlinks. (The input used to be wired to nothing.)
  const linkedCompany = companies.find((c) => c.id === lead.companyId);
  function commitBusiness(raw: string) {
    const name = raw.trim();
    if (!name) {
      if (lead.companyId) void updateLead(lead.id, { companyId: null });
      return;
    }
    if (linkedCompany && linkedCompany.name.trim().toLowerCase() === name.toLowerCase()) return;
    const existing = companies.find((c) => c.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      void updateLead(lead.id, { companyId: existing.id });
      return;
    }
    const { company } = addCompany(name);
    void updateLead(lead.id, { companyId: company.id });
  }

  return (
    <>
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

          {/* Business / company — linked to the real Companies book (find-or-create). */}
          <Field label="Business">
            <input
              key={linkedCompany?.name ?? "none"}
              type="text"
              placeholder="Company name (if applicable)"
              defaultValue={linkedCompany?.name ?? ""}
              onBlur={(e) => commitBusiness(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitBusiness(e.currentTarget.value);
                  e.currentTarget.blur();
                }
              }}
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
          {persisted.map((f) => (
            <div key={f.key} style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-end" }}>
              <div style={{ flex: 1 }}>
                <Field label={f.label}>
                  <input
                    key={f.value}
                    type="text"
                    defaultValue={f.value}
                    onBlur={(e) => { if (e.target.value !== f.value) commitCustomField(f.key, e.target.value); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        commitCustomField(f.key, e.currentTarget.value);
                        e.currentTarget.blur();
                      }
                    }}
                    placeholder={f.label}
                  />
                </Field>
              </div>
              <button
                className="btn sm ghost"
                aria-label={`Remove ${f.label}`}
                style={{ marginBottom: "var(--space-3)" }}
                onClick={() => removeCustomField(f.key)}
              >
                ✕
              </button>
            </div>
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
    </>
  );
}

/**
 * The Clean-up accordion body. The level-0 row above it is NEUTRAL ink — the
 * hierarchy critic found a red row label was the second-loudest thing on the sheet,
 * shouting about a rare end-of-relationship action. Red lives here, on Delete only,
 * which is also the truthful place: "Delete" ARCHIVES (deleteLead → archiveLead,
 * recoverable), two-step arm-then-confirm.
 */
export function CleanUpBody({ lead }: MoreDetailsProps) {
  const deleteLead = useAppStore((s) => s.deleteLead);
  const openModal = useOpenModal();
  const closeModal = useCloseModal();
  const [deleteArmed, setDeleteArmed] = useState(false);

  function handleDelete() {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    deleteLead(lead.id);
    closeModal();
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
      <button
        className="btn"
        style={{ minHeight: 44 }}
        onClick={() => openModal(MODAL.CLEAN_UP, { leadId: lead.id })}
      >
        Mark Lost or archive
      </button>
      <button
        type="button"
        className="btn ghost"
        style={{ minHeight: 44, color: "var(--red)", fontWeight: deleteArmed ? 700 : undefined }}
        aria-label={deleteArmed ? `Confirm — archive ${lead.name}` : `Delete ${lead.name}`}
        onClick={handleDelete}
      >
        {deleteArmed ? "Confirm — archives, recoverable" : "Delete"}
      </button>
    </div>
  );
}
