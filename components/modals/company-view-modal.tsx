/**
 * components/modals/company-view-modal.tsx
 * Faithful port of the prototype's openCo (lines 3034-3088) — the company-detail
 * view. Header + "New customer for {first}" action, revenue/pipeline KPIs, a
 * two-column body: linked leads + work history on the left, editable Details on
 * the right. Details fields commit on blur via updateCompany (immutable patch).
 *
 * Raw store arrays are selected via hooks; all derivations happen in the component
 * body (NEVER inside a useAppStore selector).
 */

"use client";

import {
  useActiveModal,
  useCompanies,
  useLeads,
  useEstimates,
  usePushModal,
  useCloseModal,
  useAppStore,
} from "@/lib/store/app-store";
import { MODAL } from "@/lib/store/modal-ids";
import { StagePill } from "@/components/shared/stage-pill";
import type { Company, Estimate, Lead } from "@/lib/store/types";
import { fmt$ } from "@/lib/format";
import { pipeSum } from "@/lib/estimates";
import { Field } from "@/components/ui/input";


function firstName(name: string): string {
  return name.split(" ")[0] ?? name;
}

interface LinkedLeadsCardProps {
  contacts: Lead[];
  onOpenLead: (id: string) => void;
}

function LinkedLeadsCard({ contacts, onOpenLead }: LinkedLeadsCardProps) {
  return (
    <div className="card">
      <h3>
        Linked leads <span className="pill gray">{contacts.length}</span>
      </h3>
      {contacts.length > 0 ? (
        contacts.map((l) => (
          <div
            key={l.id}
            className="att-item clickable"
            onClick={() => onOpenLead(l.id)}
          >
            <div className="att-ico" style={{ background: "var(--green-50)" }} />
            <div className="att-body">
              <b style={{ fontWeight: 600 }}>{l.name}</b>
              <div className="why">
                {l.role ? `${l.role} · ` : ""}
                {l.job || l.last || ""}
              </div>
            </div>
            <StagePill stage={l.stage} />
          </div>
        ))
      ) : (
        <div className="empty-att">
          No customers yet — hit + New customer above, or tag any customer with
          this business name. They link automatically.
        </div>
      )}
    </div>
  );
}

function WorkHistoryCard({ contacts }: { contacts: Lead[] }) {
  return (
    <div className="card" style={{ marginBottom: "0" }}>
      <h3>Work history</h3>
      {contacts.length > 0 ? (
        contacts.map((l) => (
          <div key={l.id} className="att-item">
            <div className="att-ico" style={{ background: "var(--blue-bg)" }} />
            <div className="att-body">
              <b style={{ fontWeight: 600 }}>{l.job || l.name}</b>
              <div className="why">
                {l.name} · {l.last || ""}
              </div>
            </div>
            <StagePill stage={l.stage} />
          </div>
        ))
      ) : (
        <div className="empty-att">No work yet.</div>
      )}
    </div>
  );
}

interface DetailsCardProps {
  company: Company;
  onSave: (patch: Partial<Company>) => void;
}

function DetailsCard({ company, onSave }: DetailsCardProps) {
  return (
    <div className="card">
      <h3>Details</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-3)" }}>
        <Field label="Phone" style={{ marginBottom: "0" }}>
          <input
            type="text"
            defaultValue={company.phone}
            placeholder="—"
            onBlur={(e) => onSave({ phone: e.target.value.trim() })}
          />
        </Field>
        <Field label="Email" style={{ marginBottom: "0" }}>
          <input
            type="text"
            defaultValue={company.email}
            placeholder="—"
            onBlur={(e) => onSave({ email: e.target.value.trim() })}
          />
        </Field>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "var(--space-3)",
          marginTop: "var(--space-3)",
        }}
      >
        <Field label="Website" style={{ marginBottom: "0" }}>
          <input
            type="text"
            defaultValue={company.website ?? ""}
            placeholder="—"
            onBlur={(e) => onSave({ website: e.target.value.trim() })}
          />
        </Field>
        <Field label="Office address" style={{ marginBottom: "0" }}>
          <input
            type="text"
            defaultValue={company.address ?? ""}
            placeholder="—"
            onBlur={(e) => onSave({ address: e.target.value.trim() })}
          />
        </Field>
      </div>
      <Field label="About this account" style={{ marginTop: "var(--space-3)", marginBottom: "0" }}>
        <textarea
          rows={2}
          defaultValue={company.notes ?? ""}
          placeholder="how you know them, who runs it…"
          onBlur={(e) => onSave({ notes: e.target.value.trim() })}
        />
      </Field>
    </div>
  );
}

export function CompanyViewModalContent() {
  const activeModal = useActiveModal();
  const companies = useCompanies();
  const leads = useLeads();
  const estimates = useEstimates();
  const pushModal = usePushModal();
  const closeModal = useCloseModal();
  const updateCompany = useAppStore((s) => s.updateCompany);

  const companyId = activeModal?.params?.companyId as string | undefined;
  const company = companies.find((c) => c.id === companyId);

  if (!company) {
    // Titled like every other state. A bare sentence in a panel gave no indication
    // of what had been opened, which is worse precisely when something is wrong.
    return (
      <>
        <h2>Company</h2>
        <p className="muted">
          This company record is no longer available — it may have been archived.
        </p>
      </>
    );
  }

  const contacts = leads.filter(
    (l) => l.companyId === company.id && !l.archived,
  );
  const openPipe = pipeSum(contacts, estimates, "sent");
  const revenueWon = pipeSum(contacts, estimates, "accepted");

  const contactLine = [company.phone, company.email].filter(Boolean).join(" · ");

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-3)",
          marginBottom: "var(--space-2xs)",
          paddingRight: "var(--space-8)",
        }}
      >
        <h2>{company.name}</h2>
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
          {company.archived ? (
            <button className="btn ghost" onClick={() => updateCompany(company.id, { archived: false })}>
              Restore
            </button>
          ) : (
            <button
              className="btn ghost"
              onClick={() => {
                updateCompany(company.id, { archived: true });
                closeModal();
              }}
            >
              Archive
            </button>
          )}
          <button
            className="btn primary"
            // Pre-links the company: the New-customer modal seeds Business + the
            // company name from this param, so the lead lands in Linked leads.
            onClick={() => pushModal(MODAL.NEW_CUSTOMER, { companyId: company.id })}
          >
            + New customer for {firstName(company.name)}
          </button>
        </div>
      </div>

      {contactLine ? (
        <div className="muted" style={{ marginBottom: "var(--space-3)" }}>
          {contactLine}
        </div>
      ) : null}

      <div
        className="kpis"
        style={{
          gridTemplateColumns: "repeat(2,1fr)",
          maxWidth: 480,
          marginBottom: "var(--space-4)",
        }}
      >
        <div className="kpi">
          <div className="lbl">Revenue won</div>
          <div className="val">{fmt$(revenueWon)}</div>
          <div className="hint">from accepted quotes — nothing invented</div>
        </div>
        <div className="kpi">
          <div className="lbl">Open pipeline</div>
          <div className="val">{openPipe ? fmt$(openPipe) : "$0"}</div>
          <div className="hint">quotes awaiting answer</div>
        </div>
      </div>

      <div className="row2">
        <div>
          <LinkedLeadsCard
            contacts={contacts}
            onOpenLead={(id) => pushModal(MODAL.LEAD, { leadId: id })}
          />
          <WorkHistoryCard contacts={contacts} />
        </div>
        <div>
          <DetailsCard
            company={company}
            onSave={(patch) => updateCompany(company.id, patch)}
          />
        </div>
      </div>
    </>
  );
}
